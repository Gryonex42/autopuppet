/**
 * SAM ONNX Part Segmentation
 *
 * Preprocessing and postprocessing run in the renderer.
 * ONNX inference runs in the main process via onnxruntime-node (IPC).
 */

import type { KeypointMap } from './keypoint'

/** SAM session — holds a main-process session ID and cached state */
export interface SAMSession {
  /** Main-process session ID (opaque string) */
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
 * Load SAM encoder + decoder ONNX models via IPC (main process, onnxruntime-node).
 */
export async function loadSAMModel(
  encoderPath: string,
  decoderPath: string,
): Promise<SAMSession> {
  console.log('SAM: loading models via IPC (onnxruntime-node)')
  const sessionId = await window.api.samLoadModel(encoderPath, decoderPath)
  console.log(`SAM: session ${sessionId} ready`)
  return { sessionId, embedding: null, imageSize: null }
}

/**
 * Preprocess image and encode it through the SAM encoder (via IPC).
 * Stores the embedding in the session for reuse across multiple prompts.
 */
export async function encodeImage(
  session: SAMSession,
  imageData: ImageData,
): Promise<Float32Array> {
  const inputData = preprocessImage(imageData)

  // Send preprocessed tensor to main process for inference
  const inputBuf = inputData.buffer as ArrayBuffer
  const resultBuf = await window.api.samEncode(session.sessionId, inputBuf)

  const embedding = new Float32Array(resultBuf)
  session.embedding = embedding
  session.imageSize = { width: imageData.width, height: imageData.height }

  return embedding
}

/**
 * Run SAM decoder with point/box prompts to produce a binary mask (via IPC).
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

  const numPoints = scaledPoints.length + (scaledBox ? 2 : 0)
  const coordsData = new Float32Array(numPoints * 2)
  const labelsData = new Float32Array(numPoints)

  let idx = 0
  for (let i = 0; i < scaledPoints.length; i++) {
    coordsData[idx * 2] = scaledPoints[i][0]
    coordsData[idx * 2 + 1] = scaledPoints[i][1]
    labelsData[idx] = labels[i]
    idx++
  }

  if (scaledBox) {
    coordsData[idx * 2] = scaledBox[0]
    coordsData[idx * 2 + 1] = scaledBox[1]
    labelsData[idx] = 2
    idx++
    coordsData[idx * 2] = scaledBox[2]
    coordsData[idx * 2 + 1] = scaledBox[3]
    labelsData[idx] = 3
  }

  // Send to main process for inference
  const embeddingBuf = embedding.buffer as ArrayBuffer
  const coordsBuf = coordsData.buffer as ArrayBuffer
  const labelsBuf = labelsData.buffer as ArrayBuffer

  const result = await window.api.samDecode(
    session.sessionId,
    embeddingBuf,
    coordsBuf,
    labelsBuf,
    numPoints,
  )

  // Pick the mask with highest IoU score
  const iouData = new Float32Array(result.iou)
  let bestIdx = 0
  for (let i = 1; i < iouData.length; i++) {
    if (iouData[i] > iouData[bestIdx]) bestIdx = i
  }

  const allMasks = new Float32Array(result.masks)
  const maskH = result.maskHeight
  const maskW = result.maskWidth
  const maskSize = maskH * maskW
  const bestMask = allMasks.slice(bestIdx * maskSize, (bestIdx + 1) * maskSize)

  return postprocessMask(bestMask, maskW, maskH, width, height)
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
 * Resize image to 1024x1024 and convert to HWC float tensor in [0, 255] range.
 * Returns a Float32Array of shape [1024, 1024, 3].
 *
 * The samexporter SAM encoder expects HWC layout with pixel values in [0, 255].
 * ImageNet normalization (mean/std) is baked into the ONNX graph.
 */
function preprocessImage(imageData: ImageData): Float32Array {
  // Use OffscreenCanvas to resize
  const canvas = new OffscreenCanvas(SAM_INPUT_SIZE, SAM_INPUT_SIZE)
  const ctx = canvas.getContext('2d')!

  const srcCanvas = new OffscreenCanvas(imageData.width, imageData.height)
  const srcCtx = srcCanvas.getContext('2d')!
  srcCtx.putImageData(imageData, 0, 0)

  ctx.drawImage(srcCanvas, 0, 0, SAM_INPUT_SIZE, SAM_INPUT_SIZE)
  const resized = ctx.getImageData(0, 0, SAM_INPUT_SIZE, SAM_INPUT_SIZE)

  // Convert RGBA HWC → RGB HWC float, values in [0, 255]
  const pixelCount = SAM_INPUT_SIZE * SAM_INPUT_SIZE
  const tensor = new Float32Array(3 * pixelCount)

  for (let i = 0; i < pixelCount; i++) {
    tensor[i * 3] = resized.data[i * 4]         // R
    tensor[i * 3 + 1] = resized.data[i * 4 + 1] // G
    tensor[i * 3 + 2] = resized.data[i * 4 + 2] // B
  }

  return tensor
}

/**
 * Convert a float mask from the SAM decoder to a binary ImageData
 * at the target resolution. The mask can be any size (depends on orig_im_size).
 */
function postprocessMask(
  maskFloat: Float32Array,
  maskWidth: number,
  maskHeight: number,
  targetWidth: number,
  targetHeight: number,
): ImageData {
  const out = createImageData(targetWidth, targetHeight)

  for (let y = 0; y < targetHeight; y++) {
    for (let x = 0; x < targetWidth; x++) {
      const srcX = Math.floor((x / targetWidth) * maskWidth)
      const srcY = Math.floor((y / targetHeight) * maskHeight)
      const srcIdx = srcY * maskWidth + srcX

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
