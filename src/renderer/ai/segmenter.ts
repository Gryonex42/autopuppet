/**
 * Part Segmentation
 *
 * Keypoint-geometry segmentation: elliptical masks derived from
 * inter-keypoint distances, intersected with the original alpha channel.
 * Fast, deterministic, works well for illustrated/anime characters.
 */

import type { KeypointMap } from './keypoint'

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
 *
 * Parts are extracted in z-order (highest z first = PART_PRIORITY order).
 * After extracting each part, the hole left behind is inpainted on a running
 * "base layer" copy so lower-z parts show plausible content underneath.
 *
 * If the LaMa model is loaded, uses AI inpainting. Otherwise falls back to
 * simple colour-fill (samples border pixels around the hole).
 */
export async function exportPartTextures(
  originalImage: ImageData,
  masks: Map<string, ImageData>,
  outputDir: string,
  options?: { useInpainting?: boolean },
): Promise<Map<string, PartTextureInfo>> {
  const result = new Map<string, PartTextureInfo>()
  const { width, height } = originalImage
  const useInpainting = options?.useInpainting ?? false

  // Working copy of the image — gets inpainted as we extract parts
  const baseLayer = new Uint8ClampedArray(originalImage.data)

  // Process parts in priority order (highest-z first) so that
  // higher-z parts are extracted from the clean original, and
  // lower-z parts benefit from inpainting beneath them.
  const orderedParts = PART_PRIORITY.filter((name) => masks.has(name))
  for (const name of masks.keys()) {
    if (!orderedParts.includes(name)) orderedParts.push(name)
  }

  for (const partName of orderedParts) {
    const mask = masks.get(partName)!
    const bbox = getMaskBbox(mask)
    if (!bbox) continue

    const { x, y, w, h } = bbox

    // Extract the cropped RGBA pixels from the current base layer
    const cropped = new Uint8ClampedArray(w * h * 4)
    for (let row = 0; row < h; row++) {
      for (let col = 0; col < w; col++) {
        const srcX = x + col
        const srcY = y + row
        const srcIdx = (srcY * width + srcX) * 4
        const dstIdx = (row * w + col) * 4

        const maskIdx = (srcY * mask.width + srcX) * 4
        if (mask.data[maskIdx + 3] > 127) {
          cropped[dstIdx] = baseLayer[srcIdx]
          cropped[dstIdx + 1] = baseLayer[srcIdx + 1]
          cropped[dstIdx + 2] = baseLayer[srcIdx + 2]
          cropped[dstIdx + 3] = baseLayer[srcIdx + 3]
        }
      }
    }

    // Write the part texture
    const filePath = `${outputDir}/${partName}.png`
    await window.api.writeRgbaPng(filePath, cropped.buffer, w, h)
    result.set(partName, { path: filePath, offset: [x, y] })

    // Inpaint the hole this part left on the base layer
    if (useInpainting) {
      try {
        const inpainted = await inpaintHole(baseLayer, width, height, mask)
        baseLayer.set(inpainted)
      } catch {
        // Fall back to colour-fill if inpainting fails
        colourFillHole(baseLayer, width, height, mask)
      }
    } else {
      colourFillHole(baseLayer, width, height, mask)
    }
  }

  return result
}

/**
 * Inpaint a hole in the base layer using LaMa via IPC.
 * The mask defines which pixels to inpaint (alpha > 127 = hole).
 */
async function inpaintHole(
  baseLayer: Uint8ClampedArray,
  width: number,
  height: number,
  mask: ImageData,
): Promise<Uint8ClampedArray> {
  // Build a full-image RGBA buffer from the base layer
  const imageRgba = new Uint8ClampedArray(baseLayer)

  // Build a mask RGBA buffer (alpha channel used by the worker)
  const maskRgba = new Uint8ClampedArray(mask.data)

  const result = await window.api.inpaintRun(
    imageRgba.buffer, width, height,
    maskRgba.buffer, mask.width, mask.height,
  )

  // Only apply inpainted pixels where the mask is active
  const inpainted = new Uint8ClampedArray(baseLayer)
  const outRgba = new Uint8ClampedArray(result.imageRgba)
  for (let i = 0; i < width * height; i++) {
    if (mask.data[i * 4 + 3] > 127) {
      inpainted[i * 4] = outRgba[i * 4]
      inpainted[i * 4 + 1] = outRgba[i * 4 + 1]
      inpainted[i * 4 + 2] = outRgba[i * 4 + 2]
      inpainted[i * 4 + 3] = outRgba[i * 4 + 3]
    }
  }
  return inpainted
}

/**
 * Simple colour-fill fallback: for each hole pixel, sample the average colour
 * of non-hole pixels within a small border ring around the hole, then fill
 * the hole with that colour. Works without any AI model.
 */
export function colourFillHole(
  baseLayer: Uint8ClampedArray,
  width: number,
  height: number,
  mask: ImageData,
): void {
  // Find the bounding box of the mask to limit our search area
  const bbox = getMaskBbox(mask)
  if (!bbox) return

  const borderRadius = 3

  // Expand bbox by borderRadius and clamp to image bounds
  const x0 = Math.max(0, bbox.x - borderRadius)
  const y0 = Math.max(0, bbox.y - borderRadius)
  const x1 = Math.min(width - 1, bbox.x + bbox.w - 1 + borderRadius)
  const y1 = Math.min(height - 1, bbox.y + bbox.h - 1 + borderRadius)

  // Collect border pixel colours: pixels NOT in the mask that are
  // adjacent (within borderRadius) to a mask pixel
  let sumR = 0, sumG = 0, sumB = 0, sumA = 0, count = 0

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const idx = (y * width + x) * 4
      const maskIdx = (y * mask.width + x) * 4

      // Skip pixels inside the mask
      if (y < mask.height && x < mask.width && mask.data[maskIdx + 3] > 127) continue

      // Check if this pixel is near a mask pixel
      let nearMask = false
      for (let dy = -borderRadius; dy <= borderRadius && !nearMask; dy++) {
        for (let dx = -borderRadius; dx <= borderRadius && !nearMask; dx++) {
          const ny = y + dy
          const nx = x + dx
          if (ny >= 0 && ny < mask.height && nx >= 0 && nx < mask.width) {
            if (mask.data[(ny * mask.width + nx) * 4 + 3] > 127) {
              nearMask = true
            }
          }
        }
      }

      if (nearMask && baseLayer[idx + 3] > 10) {
        sumR += baseLayer[idx]
        sumG += baseLayer[idx + 1]
        sumB += baseLayer[idx + 2]
        sumA += baseLayer[idx + 3]
        count++
      }
    }
  }

  if (count === 0) return // No border pixels found

  const avgR = Math.round(sumR / count)
  const avgG = Math.round(sumG / count)
  const avgB = Math.round(sumB / count)
  const avgA = Math.round(sumA / count)

  // Fill hole pixels with the average border colour
  for (let y = bbox.y; y < bbox.y + bbox.h; y++) {
    for (let x = bbox.x; x < bbox.x + bbox.w; x++) {
      const maskIdx = (y * mask.width + x) * 4
      if (mask.data[maskIdx + 3] > 127) {
        const idx = (y * width + x) * 4
        baseLayer[idx] = avgR
        baseLayer[idx + 1] = avgG
        baseLayer[idx + 2] = avgB
        baseLayer[idx + 3] = avgA
      }
    }
  }
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

export { getMaskBbox, KEYPOINT_TO_PART, computePartRegions }
