import { describe, it, expect } from 'vitest'
import {
  resolveOverlaps,
  PART_PRIORITY,
  postprocessMask,
  getMaskBbox,
  KEYPOINT_TO_PART,
} from './segmenter'

/**
 * Create a synthetic ImageData-like mask with specified opaque pixels.
 * Pixels at coordinates in `opaquePixels` get alpha=255, rest get alpha=0.
 */
function makeMask(
  width: number,
  height: number,
  opaquePixels: [number, number][],
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4)
  for (const [x, y] of opaquePixels) {
    const i = (y * width + x) * 4
    data[i] = 255
    data[i + 1] = 255
    data[i + 2] = 255
    data[i + 3] = 255
  }
  return { data, width, height, colorSpace: 'srgb' } as ImageData
}

/**
 * Create a rectangular mask — all pixels in the bbox are opaque.
 */
function makeRectMask(
  width: number,
  height: number,
  bbox: { x: number; y: number; w: number; h: number },
): ImageData {
  const pixels: [number, number][] = []
  for (let y = bbox.y; y < bbox.y + bbox.h && y < height; y++) {
    for (let x = bbox.x; x < bbox.x + bbox.w && x < width; x++) {
      pixels.push([x, y])
    }
  }
  return makeMask(width, height, pixels)
}

/** Count opaque pixels (alpha > 127) in a mask */
function countOpaque(mask: ImageData): number {
  let count = 0
  for (let i = 0; i < mask.width * mask.height; i++) {
    if (mask.data[i * 4 + 3] > 127) count++
  }
  return count
}

/** Check if pixel (x, y) is opaque in the mask */
function isOpaque(mask: ImageData, x: number, y: number): boolean {
  return mask.data[(y * mask.width + x) * 4 + 3] > 127
}

// --- resolveOverlaps ---

describe('resolveOverlaps', () => {
  it('higher-priority part wins contested pixels', () => {
    // Two masks that overlap in a 5x5 region
    // eye_left (high priority) and face (low priority) both claim center pixels
    const w = 20
    const h = 20
    const eyeMask = makeRectMask(w, h, { x: 5, y: 5, w: 10, h: 10 })
    const faceMask = makeRectMask(w, h, { x: 0, y: 0, w: 20, h: 20 })

    const masks = new Map<string, ImageData>()
    masks.set('eye_left', eyeMask)
    masks.set('face', faceMask)

    const resolved = resolveOverlaps(masks, PART_PRIORITY)

    const resolvedEye = resolved.get('eye_left')!
    const resolvedFace = resolved.get('face')!

    // The overlapping region (5,5)→(14,14) should belong to eye_left
    expect(isOpaque(resolvedEye, 7, 7)).toBe(true)
    expect(isOpaque(resolvedFace, 7, 7)).toBe(false)

    // Non-overlapping face region should still belong to face
    expect(isOpaque(resolvedFace, 0, 0)).toBe(true)
    expect(isOpaque(resolvedEye, 0, 0)).toBe(false)
  })

  it('no pixel belongs to two masks after resolution', () => {
    const w = 30
    const h = 30

    const masks = new Map<string, ImageData>()
    masks.set('eye_left', makeRectMask(w, h, { x: 5, y: 5, w: 10, h: 10 }))
    masks.set('eye_right', makeRectMask(w, h, { x: 15, y: 5, w: 10, h: 10 }))
    masks.set('face', makeRectMask(w, h, { x: 0, y: 0, w: 30, h: 30 }))

    const resolved = resolveOverlaps(masks, PART_PRIORITY)

    // For every pixel, at most one resolved mask should be opaque
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let ownersCount = 0
        for (const mask of resolved.values()) {
          if (isOpaque(mask, x, y)) ownersCount++
        }
        expect(ownersCount).toBeLessThanOrEqual(1)
      }
    }
  })

  it('total coverage equals union of input masks', () => {
    const w = 20
    const h = 20

    const masks = new Map<string, ImageData>()
    masks.set('mouth', makeRectMask(w, h, { x: 5, y: 10, w: 10, h: 5 }))
    masks.set('face', makeRectMask(w, h, { x: 0, y: 0, w: 20, h: 20 }))

    // Count total opaque pixels across input masks (union)
    const unionPixels = new Set<string>()
    for (const mask of masks.values()) {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (isOpaque(mask, x, y)) unionPixels.add(`${x},${y}`)
        }
      }
    }

    const resolved = resolveOverlaps(masks, PART_PRIORITY)

    // Count total opaque pixels across resolved masks
    let resolvedTotal = 0
    for (const mask of resolved.values()) {
      resolvedTotal += countOpaque(mask)
    }

    expect(resolvedTotal).toBe(unionPixels.size)
  })

  it('returns empty map for empty input', () => {
    const resolved = resolveOverlaps(new Map(), PART_PRIORITY)
    expect(resolved.size).toBe(0)
  })

  it('handles parts not in priority list (appended at lowest priority)', () => {
    const w = 10
    const h = 10

    const masks = new Map<string, ImageData>()
    masks.set('custom_part', makeRectMask(w, h, { x: 0, y: 0, w: 10, h: 10 }))
    masks.set('face', makeRectMask(w, h, { x: 0, y: 0, w: 10, h: 10 }))

    const resolved = resolveOverlaps(masks, PART_PRIORITY)

    // face is in priority list and should win over custom_part
    const resolvedFace = resolved.get('face')!
    const resolvedCustom = resolved.get('custom_part')!

    expect(countOpaque(resolvedFace)).toBe(100)
    expect(countOpaque(resolvedCustom)).toBe(0)
  })

  it('respects eye > mouth > face priority order', () => {
    const w = 10
    const h = 10
    // All three claim the same pixel at (5, 5)
    const allSamePixel: [number, number][] = [[5, 5]]

    const masks = new Map<string, ImageData>()
    masks.set('face', makeMask(w, h, allSamePixel))
    masks.set('mouth', makeMask(w, h, allSamePixel))
    masks.set('eye_left', makeMask(w, h, allSamePixel))

    const resolved = resolveOverlaps(masks, PART_PRIORITY)

    expect(isOpaque(resolved.get('eye_left')!, 5, 5)).toBe(true)
    expect(isOpaque(resolved.get('mouth')!, 5, 5)).toBe(false)
    expect(isOpaque(resolved.get('face')!, 5, 5)).toBe(false)
  })
})

// --- getMaskBbox ---

describe('getMaskBbox', () => {
  it('returns tight bounding box of opaque pixels', () => {
    const mask = makeRectMask(100, 100, { x: 20, y: 30, w: 40, h: 25 })
    const bbox = getMaskBbox(mask)

    expect(bbox).toEqual({ x: 20, y: 30, w: 40, h: 25 })
  })

  it('returns null for fully transparent mask', () => {
    const mask = makeMask(50, 50, [])
    expect(getMaskBbox(mask)).toBeNull()
  })

  it('handles single-pixel mask', () => {
    const mask = makeMask(100, 100, [[42, 73]])
    const bbox = getMaskBbox(mask)

    expect(bbox).toEqual({ x: 42, y: 73, w: 1, h: 1 })
  })

  it('handles mask spanning full image', () => {
    const mask = makeRectMask(10, 10, { x: 0, y: 0, w: 10, h: 10 })
    const bbox = getMaskBbox(mask)

    expect(bbox).toEqual({ x: 0, y: 0, w: 10, h: 10 })
  })
})

// --- postprocessMask ---

describe('postprocessMask', () => {
  it('thresholds at 0 (positive = foreground)', () => {
    // Create a 256x256 mask with left half positive, right half negative
    const decoderSize = 256
    const maskFloat = new Float32Array(decoderSize * decoderSize)
    for (let y = 0; y < decoderSize; y++) {
      for (let x = 0; x < decoderSize; x++) {
        maskFloat[y * decoderSize + x] = x < 128 ? 1.0 : -1.0
      }
    }

    const result = postprocessMask(maskFloat, 256, 256, 256, 256)

    // Left half should be opaque
    expect(result.data[0 * 4 + 3]).toBe(255)
    expect(result.data[(127) * 4 + 3]).toBe(255)

    // Right half should be transparent
    expect(result.data[(128) * 4 + 3]).toBe(0)
    expect(result.data[(255) * 4 + 3]).toBe(0)
  })

  it('resizes from 256x256 to target dimensions', () => {
    const decoderSize = 256
    const maskFloat = new Float32Array(decoderSize * decoderSize).fill(1.0) // all foreground

    const result = postprocessMask(maskFloat, 256, 256, 512, 512)

    expect(result.width).toBe(512)
    expect(result.height).toBe(512)
    // All pixels should be opaque
    expect(countOpaque(result)).toBe(512 * 512)
  })

  it('produces correct output size for non-square targets', () => {
    const decoderSize = 256
    const maskFloat = new Float32Array(decoderSize * decoderSize).fill(-1.0) // all background

    const result = postprocessMask(maskFloat, 256, 256, 800, 600)

    expect(result.width).toBe(800)
    expect(result.height).toBe(600)
    expect(countOpaque(result)).toBe(0)
  })

  it('values at exactly 0 are treated as background', () => {
    const decoderSize = 256
    const maskFloat = new Float32Array(decoderSize * decoderSize).fill(0)

    const result = postprocessMask(maskFloat, 256, 256, 10, 10)
    expect(countOpaque(result)).toBe(0)
  })
})

// --- KEYPOINT_TO_PART mapping ---

describe('KEYPOINT_TO_PART', () => {
  it('maps face_center to face', () => {
    expect(KEYPOINT_TO_PART['face_center']).toBe('face')
  })

  it('maps eye keypoints to eye parts', () => {
    expect(KEYPOINT_TO_PART['eye_left']).toBe('eye_left')
    expect(KEYPOINT_TO_PART['eye_right']).toBe('eye_right')
  })

  it('maps torso_center to body', () => {
    expect(KEYPOINT_TO_PART['torso_center']).toBe('body')
  })

  it('maps shoulders to arm parts', () => {
    expect(KEYPOINT_TO_PART['shoulder_left']).toBe('arm_upper_left')
    expect(KEYPOINT_TO_PART['shoulder_right']).toBe('arm_upper_right')
  })
})

// --- PART_PRIORITY order ---

describe('PART_PRIORITY', () => {
  it('eyes have higher priority than face', () => {
    const eyeIdx = PART_PRIORITY.indexOf('eye_left')
    const faceIdx = PART_PRIORITY.indexOf('face')
    expect(eyeIdx).toBeLessThan(faceIdx)
  })

  it('mouth has higher priority than face', () => {
    const mouthIdx = PART_PRIORITY.indexOf('mouth')
    const faceIdx = PART_PRIORITY.indexOf('face')
    expect(mouthIdx).toBeLessThan(faceIdx)
  })

  it('face has higher priority than body', () => {
    const faceIdx = PART_PRIORITY.indexOf('face')
    const bodyIdx = PART_PRIORITY.indexOf('body')
    expect(faceIdx).toBeLessThan(bodyIdx)
  })
})
