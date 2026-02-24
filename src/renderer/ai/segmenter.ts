/**
 * Part Segmentation
 *
 * Two modes:
 * - Keypoint-geometry segmentation (default): elliptical masks derived from
 *   inter-keypoint distances, intersected with the original alpha channel.
 *   Fast, deterministic, works well for illustrated/anime characters.
 * - SAM-based segmentation (optional): ONNX inference for photographic images.
 *   Preprocessing and postprocessing run in the renderer; inference runs in
 *   the main process via onnxruntime-node (IPC).
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

/** Euclidean distance between two points */
function dist(a: [number, number], b: [number, number]): number {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2)
}

/**
 * Part region definition: an ellipse (cx, cy, rx, ry) that defines the mask area.
 */
interface PartRegion {
  cx: number
  cy: number
  rx: number
  ry: number
}

/**
 * Compute elliptical regions for each part from keypoint geometry.
 * All sizes scale proportionally to the character's inter-keypoint distances.
 *
 * Tuned for illustrated/anime characters where facial features are large
 * relative to inter-eye distance. Uses the alpha bounding box to constrain
 * body extent (avoids extending into transparent regions).
 */
function computePartRegions(
  keypoints: KeypointMap,
  width: number,
  height: number,
  alphaBbox?: { minY: number; maxY: number },
): Map<string, PartRegion> {
  const regions = new Map<string, PartRegion>()

  const eyeL = keypoints.eye_left
  const eyeR = keypoints.eye_right
  const interEye = eyeL && eyeR ? dist(eyeL, eyeR) : width * 0.15

  const faceCenter = keypoints.face_center
  const mouth = keypoints.mouth_center
  const nose = keypoints.nose_tip

  // Eye-to-mouth distance is a better face scale reference than interEye alone
  const eyeMid = eyeL && eyeR ? midpoint(eyeL, eyeR) : faceCenter
  const eyeToMouth = eyeMid && mouth ? dist(eyeMid, mouth) : interEye * 1.7
  // Face height ~ forehead to chin. Approximate as eye-to-mouth * 2.2
  const faceH = eyeToMouth * 2.2

  for (const [keypointName, coords] of Object.entries(keypoints)) {
    const partName = KEYPOINT_TO_PART[keypointName]
    if (!partName) continue

    const [cx, cy] = coords

    switch (partName) {
      case 'eye_left':
      case 'eye_right':
        // Anime eyes are large — roughly half the inter-eye distance wide,
        // and about 60% of that tall (more round than photographic eyes)
        regions.set(partName, { cx, cy, rx: interEye * 0.55, ry: interEye * 0.4 })
        break

      case 'mouth':
        // Wider than tall, but generous to capture the full lip area
        regions.set(partName, { cx, cy, rx: interEye * 0.55, ry: interEye * 0.35 })
        break

      case 'nose': {
        // Narrow vertically between eye line and mouth
        const noseH = nose && mouth ? dist(nose, mouth) * 0.7 : interEye * 0.4
        regions.set(partName, { cx, cy, rx: interEye * 0.3, ry: noseH })
        break
      }

      case 'face':
        // Full face ellipse — from hairline to chin, ear to ear
        regions.set(partName, { cx, cy, rx: interEye * 1.3, ry: faceH * 0.55 })
        break

      case 'ear_left':
      case 'ear_right':
        regions.set(partName, { cx, cy, rx: interEye * 0.35, ry: interEye * 0.5 })
        break

      case 'body': {
        // Body from shoulders down to the bottom of the character (not the image)
        const sL = keypoints.shoulder_left
        const sR = keypoints.shoulder_right
        const shoulderW = sL && sR ? dist(sL, sR) : interEye * 3
        const shoulderY = sL && sR ? Math.min(sL[1], sR[1]) : cy - shoulderW * 0.1
        // Use alpha bounding box bottom if available, otherwise estimate
        const contentBottom = alphaBbox ? alphaBbox.maxY : height * 0.9
        const bodyH = contentBottom - shoulderY
        const bodyCy = shoulderY + bodyH * 0.45
        regions.set(partName, { cx, cy: bodyCy, rx: shoulderW * 0.65, ry: bodyH * 0.55 })
        break
      }

      case 'arm_upper_left':
      case 'arm_upper_right': {
        // Arm from shoulder down to elbow area
        const elbowKey = partName === 'arm_upper_left' ? 'elbow_left' : 'elbow_right'
        const elbow = keypoints[elbowKey]
        const armLen = elbow ? dist(coords, elbow) : interEye * 2.5
        // Center between shoulder and elbow
        const armCy = elbow ? (cy + elbow[1]) / 2 : cy + armLen * 0.4
        const armCx = elbow ? (cx + elbow[0]) / 2 : cx
        regions.set(partName, { cx: armCx, cy: armCy, rx: interEye * 0.6, ry: armLen * 0.55 })
        break
      }
    }
  }

  return regions
}

/** Midpoint of two points */
function midpoint(a: [number, number], b: [number, number]): [number, number] {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
}

/**
 * Segment a character image into named parts using keypoint-derived elliptical masks.
 * Each part gets an ellipse centered on its keypoint, sized proportionally to
 * inter-keypoint distances, then intersected with the original alpha channel.
 *
 * No AI inference needed — just geometry + alpha.
 */
export function segmentByKeypoints(
  imageData: ImageData,
  keypoints: KeypointMap,
): Map<string, ImageData> {
  const { width, height } = imageData

  // Compute alpha bounding box to constrain body/arm regions
  let alphaMinY = height
  let alphaMaxY = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (imageData.data[(y * width + x) * 4 + 3] > 10) {
        if (y < alphaMinY) alphaMinY = y
        if (y > alphaMaxY) alphaMaxY = y
      }
    }
  }
  const alphaBbox = alphaMaxY > alphaMinY ? { minY: alphaMinY, maxY: alphaMaxY } : undefined

  const regions = computePartRegions(keypoints, width, height, alphaBbox)
  const masks = new Map<string, ImageData>()

  console.log(`segmentByKeypoints: image ${width}x${height}, alpha y-range: ${alphaBbox ? `${alphaBbox.minY}-${alphaBbox.maxY}` : 'none'}`)
  for (const [name, [x, y]] of Object.entries(keypoints)) {
    console.log(`  keypoint ${name}: (${Math.round(x)}, ${Math.round(y)})`)
  }
  for (const [name, r] of regions) {
    console.log(`  region ${name}: center=(${Math.round(r.cx)},${Math.round(r.cy)}) size=${Math.round(r.rx * 2)}x${Math.round(r.ry * 2)}`)
  }

  for (const [partName, region] of regions) {
    const mask = createImageData(width, height)
    const { cx, cy, rx, ry } = region

    // Skip degenerate regions
    if (rx < 1 || ry < 1) continue

    // Only iterate over the bounding rect of the ellipse (clamped to image)
    const startX = Math.max(0, Math.floor(cx - rx))
    const endX = Math.min(width - 1, Math.ceil(cx + rx))
    const startY = Math.max(0, Math.floor(cy - ry))
    const endY = Math.min(height - 1, Math.ceil(cy + ry))

    for (let y = startY; y <= endY; y++) {
      for (let x = startX; x <= endX; x++) {
        // Ellipse test: ((x-cx)/rx)^2 + ((y-cy)/ry)^2 <= 1
        const dx = (x - cx) / rx
        const dy = (y - cy) / ry
        if (dx * dx + dy * dy > 1) continue

        // Only include pixels that are visible in the original image
        const srcAlpha = imageData.data[(y * width + x) * 4 + 3]
        if (srcAlpha < 10) continue

        const idx = (y * width + x) * 4
        mask.data[idx] = 255
        mask.data[idx + 1] = 255
        mask.data[idx + 2] = 255
        mask.data[idx + 3] = 255
      }
    }

    masks.set(partName, mask)
  }

  return masks
}

// --- SAM-based segmentation (optional, for photographic images) ---

/** Euclidean distance between two points */
// (dist already defined above for geometry segmentation)

/** Clamp a bounding box to image dimensions */
function clampBox(
  box: [number, number, number, number],
  width: number,
  height: number,
): [number, number, number, number] {
  return [
    Math.max(0, box[0]),
    Math.max(0, box[1]),
    Math.min(width, box[2]),
    Math.min(height, box[3]),
  ]
}

/**
 * Estimate a bounding box and negative points for each part based on keypoint geometry.
 * Box sizes are derived from inter-keypoint distances so they scale with the character.
 */
function estimatePartPrompts(
  keypoints: KeypointMap,
  width: number,
  height: number,
): Map<string, { box: [number, number, number, number]; negPoints: [number, number][] }> {
  const prompts = new Map<string, { box: [number, number, number, number]; negPoints: [number, number][] }>()

  // Compute scale references from keypoints
  const eyeL = keypoints.eye_left
  const eyeR = keypoints.eye_right
  const interEye = eyeL && eyeR ? dist(eyeL, eyeR) : width * 0.15
  const faceCenter = keypoints.face_center
  const mouth = keypoints.mouth_center
  const nose = keypoints.nose_tip

  // Face height estimate (face_center to mouth, doubled for forehead)
  const faceH = faceCenter && mouth ? dist(faceCenter, mouth) * 2.5 : interEye * 2.5

  for (const [keypointName, coords] of Object.entries(keypoints)) {
    const partName = KEYPOINT_TO_PART[keypointName]
    if (!partName) continue

    const [cx, cy] = coords
    let box: [number, number, number, number]
    const negPoints: [number, number][] = []

    switch (partName) {
      case 'eye_left':
      case 'eye_right': {
        // Tight box around each eye, sized relative to inter-eye distance
        const ew = interEye * 0.45
        const eh = interEye * 0.3
        box = [cx - ew, cy - eh, cx + ew, cy + eh]
        // Negative point at the other eye and at face center
        if (partName === 'eye_left' && eyeR) negPoints.push(eyeR)
        if (partName === 'eye_right' && eyeL) negPoints.push(eyeL)
        if (faceCenter) negPoints.push(faceCenter)
        break
      }

      case 'mouth': {
        const mw = interEye * 0.5
        const mh = interEye * 0.35
        box = [cx - mw, cy - mh, cx + mw, cy + mh]
        if (nose) negPoints.push(nose)
        if (faceCenter) negPoints.push(faceCenter)
        break
      }

      case 'nose': {
        const nw = interEye * 0.3
        const nh = interEye * 0.35
        box = [cx - nw, cy - nh, cx + nw, cy + nh]
        if (mouth) negPoints.push(mouth)
        if (eyeL) negPoints.push(eyeL)
        if (eyeR) negPoints.push(eyeR)
        break
      }

      case 'face': {
        // Full face box from ear to ear, forehead to below chin
        const fw = interEye * 1.4
        box = [cx - fw, cy - faceH * 0.5, cx + fw, cy + faceH * 0.5]
        // Negative points at body/shoulders to separate face from body
        if (keypoints.torso_center) negPoints.push(keypoints.torso_center)
        if (keypoints.shoulder_left) negPoints.push(keypoints.shoulder_left)
        if (keypoints.shoulder_right) negPoints.push(keypoints.shoulder_right)
        break
      }

      case 'ear_left':
      case 'ear_right': {
        const earW = interEye * 0.35
        const earH = interEye * 0.5
        box = [cx - earW, cy - earH, cx + earW, cy + earH]
        if (faceCenter) negPoints.push(faceCenter)
        break
      }

      case 'body': {
        // Body: wide box from shoulders down
        const sL = keypoints.shoulder_left
        const sR = keypoints.shoulder_right
        const shoulderW = sL && sR ? dist(sL, sR) : interEye * 3
        const bw = shoulderW * 0.7
        box = [cx - bw, cy - shoulderW * 0.3, cx + bw, height]
        if (faceCenter) negPoints.push(faceCenter)
        break
      }

      case 'arm_upper_left':
      case 'arm_upper_right': {
        const armW = interEye * 0.6
        const armH = interEye * 1.5
        box = [cx - armW, cy - armW * 0.3, cx + armW, cy + armH]
        if (keypoints.torso_center) negPoints.push(keypoints.torso_center)
        break
      }

      default: {
        // Generic fallback: moderate box around the keypoint
        const s = interEye * 0.5
        box = [cx - s, cy - s, cx + s, cy + s]
        break
      }
    }

    prompts.set(partName, {
      box: clampBox(box, width, height),
      negPoints,
    })
  }

  return prompts
}

/**
 * Segment a character image into named parts using keypoint-guided SAM prompts.
 * Uses bounding boxes and negative points for precise part isolation.
 */
export async function segmentCharacter(
  session: SAMSession,
  imageData: ImageData,
  keypoints: KeypointMap,
): Promise<Map<string, ImageData>> {
  // Encode image once
  const embedding = await encodeImage(session, imageData)

  const masks = new Map<string, ImageData>()

  // Estimate per-part bounding boxes and negative points from keypoint geometry
  const partPrompts = estimatePartPrompts(keypoints, imageData.width, imageData.height)

  for (const [keypointName, coords] of Object.entries(keypoints)) {
    const partName = KEYPOINT_TO_PART[keypointName]
    if (!partName) continue

    const prompt = partPrompts.get(partName)
    if (!prompt) continue

    // Foreground point at the keypoint + negative points at neighboring parts
    const points: [number, number][] = [coords, ...prompt.negPoints]
    const labels: number[] = [1, ...prompt.negPoints.map(() => 0)]

    const mask = await segmentWithPrompt(session, embedding, points, labels, prompt.box)
    masks.set(partName, mask)
  }

  // Intersect all masks with the original alpha channel — only keep pixels
  // that are actually visible in the source image (removes white background leaks)
  for (const [partName, mask] of masks) {
    const data = mask.data
    for (let i = 0; i < mask.width * mask.height; i++) {
      const srcAlpha = imageData.data[i * 4 + 3]
      if (srcAlpha < 10) {
        // Transparent in original → transparent in mask
        data[i * 4] = 0
        data[i * 4 + 1] = 0
        data[i * 4 + 2] = 0
        data[i * 4 + 3] = 0
      }
    }
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
 *
 * Transparent pixels are composited onto a white background before encoding,
 * so SAM sees a clean separation between the character and background.
 */
function preprocessImage(imageData: ImageData): Float32Array {
  // Use OffscreenCanvas to resize, compositing onto white background
  const canvas = new OffscreenCanvas(SAM_INPUT_SIZE, SAM_INPUT_SIZE)
  const ctx = canvas.getContext('2d')!

  // Fill with white first — transparent areas become white, not black
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, SAM_INPUT_SIZE, SAM_INPUT_SIZE)

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

export { preprocessImage, postprocessMask, getMaskBbox, SAM_INPUT_SIZE, KEYPOINT_TO_PART, computePartRegions }
