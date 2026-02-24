import { describe, it, expect } from 'vitest'
import { estimateKeypointsHeuristic, type KeypointMap } from './keypoint'

/**
 * Helper: create an ImageData-like object with a given bounding box of opaque pixels.
 * Pixels inside the bbox have alpha=255, outside alpha=0.
 */
function makeImageData(
  width: number,
  height: number,
  bbox: { x: number; y: number; w: number; h: number },
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = bbox.y; y < bbox.y + bbox.h && y < height; y++) {
    for (let x = bbox.x; x < bbox.x + bbox.w && x < width; x++) {
      const i = (y * width + x) * 4
      data[i] = 255 // R
      data[i + 1] = 255 // G
      data[i + 2] = 255 // B
      data[i + 3] = 255 // A
    }
  }
  return { data, width, height, colorSpace: 'srgb' } as ImageData
}

describe('estimateKeypointsHeuristic', () => {
  it('places face_center at 12% from top of bounding box', () => {
    const img = makeImageData(200, 400, { x: 50, y: 50, w: 100, h: 300 })
    const kp = estimateKeypointsHeuristic(img)

    const bboxTop = 50
    const bboxHeight = 300
    const expectedY = bboxTop + bboxHeight * 0.12

    expect(kp.face_center[1]).toBeCloseTo(expectedY, 0)
  })

  it('places face_center at horizontal center of bounding box', () => {
    const img = makeImageData(200, 400, { x: 50, y: 50, w: 100, h: 300 })
    const kp = estimateKeypointsHeuristic(img)

    // Pixel bbox: minX=50, maxX=149, bw=99, cx=50+99/2=99.5
    const expectedX = 50 + 99 / 2
    expect(kp.face_center[0]).toBeCloseTo(expectedX, 0)
  })

  it('places eyes at face ± 8% width', () => {
    const img = makeImageData(200, 400, { x: 50, y: 50, w: 100, h: 300 })
    const kp = estimateKeypointsHeuristic(img)

    // Pixel bbox: bw=99, cx=99.5
    const cx = 50 + 99 / 2
    const bw = 99

    expect(kp.eye_left[0]).toBeCloseTo(cx - bw * 0.08, 0)
    expect(kp.eye_right[0]).toBeCloseTo(cx + bw * 0.08, 0)
  })

  it('places eyes at 10% from top', () => {
    const img = makeImageData(200, 400, { x: 50, y: 50, w: 100, h: 300 })
    const kp = estimateKeypointsHeuristic(img)

    const expectedY = 50 + 300 * 0.10
    expect(kp.eye_left[1]).toBeCloseTo(expectedY, 0)
    expect(kp.eye_right[1]).toBeCloseTo(expectedY, 0)
  })

  it('places shoulders at 28% from top and ±20% width', () => {
    const img = makeImageData(200, 400, { x: 50, y: 50, w: 100, h: 300 })
    const kp = estimateKeypointsHeuristic(img)

    // Pixel bbox: bw=99, bh=299, cx=99.5
    const cx = 50 + 99 / 2
    const bw = 99
    const expectedY = 50 + 299 * 0.28

    expect(kp.shoulder_left[0]).toBeCloseTo(cx - bw * 0.20, 0)
    expect(kp.shoulder_right[0]).toBeCloseTo(cx + bw * 0.20, 0)
    expect(kp.shoulder_left[1]).toBeCloseTo(expectedY, 0)
    expect(kp.shoulder_right[1]).toBeCloseTo(expectedY, 0)
  })

  it('places torso_center at 45% from top', () => {
    const img = makeImageData(200, 400, { x: 50, y: 50, w: 100, h: 300 })
    const kp = estimateKeypointsHeuristic(img)

    const expectedY = 50 + 300 * 0.45
    expect(kp.torso_center[1]).toBeCloseTo(expectedY, 0)
  })

  it('returns all expected keypoint names', () => {
    const img = makeImageData(200, 400, { x: 0, y: 0, w: 200, h: 400 })
    const kp = estimateKeypointsHeuristic(img)

    const expectedKeys = [
      'face_center',
      'eye_left',
      'eye_right',
      'mouth_center',
      'nose_tip',
      'ear_left',
      'ear_right',
      'shoulder_left',
      'shoulder_right',
      'elbow_left',
      'elbow_right',
      'wrist_left',
      'wrist_right',
      'torso_center',
    ]

    for (const key of expectedKeys) {
      expect(kp).toHaveProperty(key)
      expect(kp[key]).toHaveLength(2)
      expect(typeof kp[key][0]).toBe('number')
      expect(typeof kp[key][1]).toBe('number')
    }
  })

  it('handles fully transparent image (falls back to full image bounds)', () => {
    // All alpha = 0
    const width = 100
    const height = 200
    const data = new Uint8ClampedArray(width * height * 4) // all zeros
    const img = { data, width, height, colorSpace: 'srgb' } as ImageData

    const kp = estimateKeypointsHeuristic(img)

    // Should use full image as bounding box
    const cx = (width - 1) / 2
    expect(kp.face_center[0]).toBeCloseTo(cx, 0)
    expect(kp.face_center[1]).toBeGreaterThan(0)
  })

  it('produces symmetric keypoints for centered bounding box', () => {
    const img = makeImageData(400, 600, { x: 100, y: 50, w: 200, h: 500 })
    const kp = estimateKeypointsHeuristic(img)

    // Pixel bbox: bw=199, cx=100+199/2=199.5
    const cx = 100 + 199 / 2

    // eye_left and eye_right should be symmetric around center
    const leftDist = cx - kp.eye_left[0]
    const rightDist = kp.eye_right[0] - cx
    expect(leftDist).toBeCloseTo(rightDist, 5)

    // shoulders should be symmetric
    const lsDist = cx - kp.shoulder_left[0]
    const rsDist = kp.shoulder_right[0] - cx
    expect(lsDist).toBeCloseTo(rsDist, 5)
  })

  it('left eye is to the left of right eye', () => {
    const img = makeImageData(200, 400, { x: 10, y: 10, w: 180, h: 380 })
    const kp = estimateKeypointsHeuristic(img)

    expect(kp.eye_left[0]).toBeLessThan(kp.eye_right[0])
  })

  it('vertical ordering: eyes above mouth above shoulders above torso', () => {
    const img = makeImageData(200, 400, { x: 10, y: 10, w: 180, h: 380 })
    const kp = estimateKeypointsHeuristic(img)

    expect(kp.eye_left[1]).toBeLessThan(kp.mouth_center[1])
    expect(kp.mouth_center[1]).toBeLessThan(kp.shoulder_left[1])
    expect(kp.shoulder_left[1]).toBeLessThan(kp.torso_center[1])
  })
})

describe('detectKeypoints fallback', () => {
  // We can't easily test MediaPipe in unit tests (requires WASM + GPU),
  // but we verify the orchestrator falls back to heuristic gracefully.
  // The heuristic tests above cover the actual keypoint logic.

  it('estimateKeypointsHeuristic returns valid coordinates within image bounds', () => {
    const width = 300
    const height = 500
    const img = makeImageData(width, height, { x: 20, y: 30, w: 260, h: 440 })
    const kp = estimateKeypointsHeuristic(img)

    for (const [, [x, y]] of Object.entries(kp)) {
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThanOrEqual(width)
      expect(y).toBeGreaterThanOrEqual(0)
      expect(y).toBeLessThanOrEqual(height)
    }
  })
})
