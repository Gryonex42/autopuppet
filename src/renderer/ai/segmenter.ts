/**
 * SAM ONNX Part Segmentation
 *
 * High-level segmentation pipeline that runs in the renderer process.
 * Image preprocessing and mask post-processing happen here (pure JS).
 * Actual ONNX inference runs in the main process via IPC.
 */

import type { KeypointMap } from './keypoint'

/** Opaque handle to a loaded SAM model session in the main process */
export interface SAMSession {
  /** Session ID used to reference the loaded model across IPC */
  sessionId: string
  /** Cached image embedding (set after encodeImage) */
  embedding: Float32Array | null
  /** Original image dimensions used during encoding */
  imageSize: { width: number; height: number } | null
}

/** Result of exporting a part texture */
export interface PartTextureInfo {
  path: string
  offset: [number, number]
}

/** Maps keypoint names to the character part they identify */
const KEYPOINT_TO_PART: Record<string, string> = {
  face_center: 'face',
  eye_left: 'eye_left',
  eye_right: 'eye_right',
  mouth_center: 'mouth',
  nose_tip: 'nose',
  ear_left: 'ear_left',
  ear_right: 'ear_right',
  torso_center: 'body',
  shoulder_left: 'arm_upper_left',
  shoulder_right: 'arm_upper_right',
}

/** Priority order for overlap resolution (highest priority first) */
export const PART_PRIORITY: string[] = [
  'eye_left',
  'eye_right',
  'mouth',
  'nose',
  'ear_left',
  'ear_right',
  'face',
  'hair',
  'arm_upper_left',
  'arm_upper_right',
  'body',
]

/** SAM input image size (fixed by model architecture) */
const SAM_INPUT_SIZE = 1024

/**
 * Create an ImageData-like object. Works in both browser (uses native constructor)
 * and Node test environment (creates a plain object).
 */
function createImageData(width: number, height: number): ImageData {
  if (typeof ImageData !== 'undefined') {
    return new ImageData(width, height)
  }
  // Node.js fallback for tests
  return {
    data: new Uint8ClampedArray(width * height * 4),
    width,
    height,
    colorSpace: 'srgb',
  } as ImageData
}

/**
 * Load SAM encoder + decoder ONNX models in the main process.
 * Returns a session handle for subsequent inference calls.
 */
export async function loadSAMModel(
  encoderPath: string,
  decoderPath: string,
): Promise<SAMSession> {
  const sessionId = await window.api.samLoadModel(encoderPath, decoderPath)
  return { sessionId, embedding: null, imageSize: null }
}

/**
 * Preprocess image and encode it through the SAM encoder.
 * Stores the embedding in the session for reuse across multiple prompts.
 */
export async function encodeImage(
  session: SAMSession,
  imageData: ImageData,
): Promise<Float32Array> {
  // Preprocess: resize to 1024x1024, normalize to [0, 1], convert to CHW float tensor
  const inputTensor = preprocessImage(imageData)

  // Run encoder in main process via IPC
  const tensorBuffer = new ArrayBuffer(inputTensor.byteLength)
  new Float32Array(tensorBuffer).set(inputTensor)
  const embeddingBuffer = await window.api.samEncode(session.sessionId, tensorBuffer)
  const embedding = new Float32Array(embeddingBuffer)

  session.embedding = embedding
  session.imageSize = { width: imageData.width, height: imageData.height }

  return embedding
}

/**
 * Run SAM decoder with point/box prompts to produce a binary mask.
 */
export async function segmentWithPrompt(
  session: SAMSession,
  embedding: Float32Array,
  points: [number, number][],
  labels: number[],
  box?: [number, number, number, number],
): Promise<ImageData> {
  if (!session.imageSize) {
    throw new Error('Image not encoded yet — call encodeImage first')
  }

  // Scale point coordinates from original image space to SAM input space (1024x1024)
  const { width, height } = session.imageSize
  const scaledPoints = points.map(([x, y]): [number, number] => [
    (x / width) * SAM_INPUT_SIZE,
    (y / height) * SAM_INPUT_SIZE,
  ])

  const scaledBox = box
    ? ([
        (box[0] / width) * SAM_INPUT_SIZE,
        (box[1] / height) * SAM_INPUT_SIZE,
        (box[2] / width) * SAM_INPUT_SIZE,
        (box[3] / height) * SAM_INPUT_SIZE,
      ] as [number, number, number, number])
    : undefined

  // Run decoder in main process via IPC
  const embBuf = new ArrayBuffer(embedding.byteLength)
  new Float32Array(embBuf).set(embedding)
  const maskBuffer = await window.api.samDecode(
    session.sessionId,
    embBuf,
    scaledPoints,
    labels,
    scaledBox,
  )

  // Convert the raw mask (1024x1024 float) to a binary ImageData at original resolution
  const maskFloat = new Float32Array(maskBuffer)
  return postprocessMask(maskFloat, width, height)
}

/**
 * Segment a character image into named parts using keypoint-guided SAM prompts.
 */
export async function segmentCharacter(
  session: SAMSession,
  imageData: ImageData,
  keypoints: KeypointMap,
): Promise<Map<string, ImageData>> {
  // Encode image once
  const embedding = await encodeImage(session, imageData)

  const masks = new Map<string, ImageData>()

  for (const [keypointName, coords] of Object.entries(keypoints)) {
    const partName = KEYPOINT_TO_PART[keypointName]
    if (!partName) continue // skip keypoints that don't map to parts

    // Use the keypoint as a foreground prompt point
    const mask = await segmentWithPrompt(session, embedding, [coords], [1])
    masks.set(partName, mask)
  }

  return masks
}

/**
 * Resolve overlapping masks by priority.
 * Higher-priority parts win contested pixels. No pixel belongs to two masks.
 */
export function resolveOverlaps(
  masks: Map<string, ImageData>,
  priorityOrder: string[],
): Map<string, ImageData> {
  if (masks.size === 0) return new Map()

  // Get dimensions from first mask
  const first = masks.values().next().value!
  const width = first.width
  const height = first.height

  // Build ownership map: for each pixel, which part owns it
  // -1 = unowned
  const ownership = new Int8Array(width * height).fill(-1)

  // Priority indices: lower index = higher priority
  const orderedParts = priorityOrder.filter((name) => masks.has(name))
  // Also include any parts not in the priority list (appended at end, lowest priority)
  for (const name of masks.keys()) {
    if (!orderedParts.includes(name)) {
      orderedParts.push(name)
    }
  }

  // Assign ownership from lowest to highest priority
  // (highest priority overwrites, so process high-priority last)
  for (let pri = orderedParts.length - 1; pri >= 0; pri--) {
    const partName = orderedParts[pri]
    const mask = masks.get(partName)!
    const data = mask.data
    for (let i = 0; i < width * height; i++) {
      // Check alpha channel (pixel i has RGBA at indices i*4 .. i*4+3)
      if (data[i * 4 + 3] > 127) {
        ownership[i] = pri
      }
    }
  }

  // Build resolved masks from ownership map
  const resolved = new Map<string, ImageData>()
  for (let pri = 0; pri < orderedParts.length; pri++) {
    const partName = orderedParts[pri]
    const out = createImageData(width, height)
    for (let i = 0; i < width * height; i++) {
      if (ownership[i] === pri) {
        out.data[i * 4 + 3] = 255 // white pixel in alpha
      }
    }
    resolved.set(partName, out)
  }

  return resolved
}

/**
 * Export part textures: crop original image by each mask, save as RGBA PNGs.
 * Uses sharp in the main process via IPC.
 */
export async function exportPartTextures(
  originalImage: ImageData,
  masks: Map<string, ImageData>,
  outputDir: string,
): Promise<Map<string, PartTextureInfo>> {
  const result = new Map<string, PartTextureInfo>()

  for (const [partName, mask] of masks) {
    // Find tight bounding box of the mask
    const bbox = getMaskBbox(mask)
    if (!bbox) continue // empty mask

    const { x, y, w, h } = bbox

    // Extract the cropped RGBA pixels
    const cropped = new Uint8ClampedArray(w * h * 4)
    for (let row = 0; row < h; row++) {
      for (let col = 0; col < w; col++) {
        const srcX = x + col
        const srcY = y + row
        const srcIdx = (srcY * originalImage.width + srcX) * 4
        const dstIdx = (row * w + col) * 4

        // Only include pixels where the mask is active
        const maskIdx = (srcY * mask.width + srcX) * 4
        if (mask.data[maskIdx + 3] > 127) {
          cropped[dstIdx] = originalImage.data[srcIdx]
          cropped[dstIdx + 1] = originalImage.data[srcIdx + 1]
          cropped[dstIdx + 2] = originalImage.data[srcIdx + 2]
          cropped[dstIdx + 3] = originalImage.data[srcIdx + 3]
        }
        // else leave transparent (0,0,0,0)
      }
    }

    // Write via IPC (sharp in main process)
    const filePath = `${outputDir}/${partName}.png`
    await window.api.writeRgbaPng(filePath, cropped.buffer, w, h)

    result.set(partName, { path: filePath, offset: [x, y] })
  }

  return result
}

// --- Internal helpers ---

/**
 * Resize image to 1024x1024 and convert to CHW float tensor normalized to [0,1].
 * Returns a Float32Array of shape [1, 3, 1024, 1024].
 */
function preprocessImage(imageData: ImageData): Float32Array {
  // Use OffscreenCanvas to resize
  const canvas = new OffscreenCanvas(SAM_INPUT_SIZE, SAM_INPUT_SIZE)
  const ctx = canvas.getContext('2d')!

  // Create ImageBitmap from the input data
  // We need to draw the ImageData onto a temp canvas first, then resize
  const srcCanvas = new OffscreenCanvas(imageData.width, imageData.height)
  const srcCtx = srcCanvas.getContext('2d')!
  srcCtx.putImageData(imageData, 0, 0)

  ctx.drawImage(srcCanvas, 0, 0, SAM_INPUT_SIZE, SAM_INPUT_SIZE)
  const resized = ctx.getImageData(0, 0, SAM_INPUT_SIZE, SAM_INPUT_SIZE)

  // Convert RGBA HWC → RGB CHW float, normalized to [0, 1]
  const pixelCount = SAM_INPUT_SIZE * SAM_INPUT_SIZE
  const tensor = new Float32Array(3 * pixelCount)

  for (let i = 0; i < pixelCount; i++) {
    tensor[i] = resized.data[i * 4] / 255 // R channel
    tensor[pixelCount + i] = resized.data[i * 4 + 1] / 255 // G channel
    tensor[2 * pixelCount + i] = resized.data[i * 4 + 2] / 255 // B channel
  }

  return tensor
}

/**
 * Convert a 1024x1024 float mask from the SAM decoder to a binary ImageData
 * at the target resolution.
 */
function postprocessMask(
  maskFloat: Float32Array,
  targetWidth: number,
  targetHeight: number,
): ImageData {
  // Resize from 256x256 (SAM decoder output) to target size
  // SAM decoder actually outputs 256x256 masks
  const decoderSize = 256
  const out = createImageData(targetWidth, targetHeight)

  for (let y = 0; y < targetHeight; y++) {
    for (let x = 0; x < targetWidth; x++) {
      // Map target pixel to decoder mask pixel
      const srcX = Math.floor((x / targetWidth) * decoderSize)
      const srcY = Math.floor((y / targetHeight) * decoderSize)
      const srcIdx = srcY * decoderSize + srcX

      // Threshold at 0 (SAM outputs logits; positive = foreground)
      const isForeground = maskFloat[srcIdx] > 0
      const idx = (y * targetWidth + x) * 4
      out.data[idx] = isForeground ? 255 : 0
      out.data[idx + 1] = isForeground ? 255 : 0
      out.data[idx + 2] = isForeground ? 255 : 0
      out.data[idx + 3] = isForeground ? 255 : 0
    }
  }

  return out
}

/**
 * Get the tight bounding box of non-transparent pixels in a mask.
 */
function getMaskBbox(
  mask: ImageData,
): { x: number; y: number; w: number; h: number } | null {
  let minX = mask.width
  let minY = mask.height
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      if (mask.data[(y * mask.width + x) * 4 + 3] > 127) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }

  if (maxX < 0) return null // empty mask
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

export { preprocessImage, postprocessMask, getMaskBbox, SAM_INPUT_SIZE, KEYPOINT_TO_PART }
