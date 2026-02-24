import {
  FaceLandmarker,
  PoseLandmarker,
  FilesetResolver,
  type NormalizedLandmark,
} from '@mediapipe/tasks-vision'

/** Named keypoint map: keypoint name → [x, y] in pixel coordinates */
export type KeypointMap = Record<string, [number, number]>

// MediaPipe Face Mesh canonical landmark indices
const FACE_LANDMARK = {
  noseTip: 1,
  leftEyeInner: 133,
  leftEyeOuter: 33,
  rightEyeInner: 362,
  rightEyeOuter: 263,
  mouthUpperCenter: 13,
  mouthLowerCenter: 14,
  leftEar: 234,
  rightEar: 454,
  foreheadCenter: 10,
  chinCenter: 152,
} as const

// MediaPipe Pose landmark indices
const POSE_LANDMARK = {
  nose: 0,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
} as const

/** Minimum confidence to accept MediaPipe results */
const MIN_CONFIDENCE = 0.3

/**
 * Convert a normalized MediaPipe landmark (0-1) to pixel coordinates.
 */
function landmarkToPixel(
  lm: NormalizedLandmark,
  width: number,
  height: number,
): [number, number] {
  return [lm.x * width, lm.y * height]
}

/**
 * Average two pixel points.
 */
function midpoint(a: [number, number], b: [number, number]): [number, number] {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
}

/**
 * Detect face landmarks using MediaPipe FaceLandmarker.
 * Returns named keypoints in pixel coordinates, or null if detection fails.
 */
export async function detectFaceLandmarks(
  imageData: ImageData,
  wasmBasePath?: string,
): Promise<KeypointMap | null> {
  const fileset = await FilesetResolver.forVisionTasks(
    wasmBasePath ?? 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm',
  )

  const faceLandmarker = await FaceLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath:
        'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
      delegate: 'CPU',
    },
    runningMode: 'IMAGE',
    numFaces: 1,
  })

  const result = faceLandmarker.detect(imageData)
  faceLandmarker.close()

  if (!result.faceLandmarks || result.faceLandmarks.length === 0) {
    return null
  }

  const lm = result.faceLandmarks[0]
  const w = imageData.width
  const h = imageData.height

  // Check that we have enough landmarks and sufficient visibility
  if (lm.length < 468) return null

  const noseTip = lm[FACE_LANDMARK.noseTip]
  if (noseTip.visibility < MIN_CONFIDENCE) return null

  const leftEyeInner = landmarkToPixel(lm[FACE_LANDMARK.leftEyeInner], w, h)
  const leftEyeOuter = landmarkToPixel(lm[FACE_LANDMARK.leftEyeOuter], w, h)
  const rightEyeInner = landmarkToPixel(lm[FACE_LANDMARK.rightEyeInner], w, h)
  const rightEyeOuter = landmarkToPixel(lm[FACE_LANDMARK.rightEyeOuter], w, h)
  const forehead = landmarkToPixel(lm[FACE_LANDMARK.foreheadCenter], w, h)
  const chin = landmarkToPixel(lm[FACE_LANDMARK.chinCenter], w, h)

  const keypoints: KeypointMap = {
    face_center: midpoint(forehead, chin),
    eye_left: midpoint(leftEyeInner, leftEyeOuter),
    eye_right: midpoint(rightEyeInner, rightEyeOuter),
    mouth_center: midpoint(
      landmarkToPixel(lm[FACE_LANDMARK.mouthUpperCenter], w, h),
      landmarkToPixel(lm[FACE_LANDMARK.mouthLowerCenter], w, h),
    ),
    nose_tip: landmarkToPixel(noseTip, w, h),
    ear_left: landmarkToPixel(lm[FACE_LANDMARK.leftEar], w, h),
    ear_right: landmarkToPixel(lm[FACE_LANDMARK.rightEar], w, h),
  }

  return keypoints
}

/**
 * Detect body joints using MediaPipe PoseLandmarker.
 * Returns named keypoints in pixel coordinates, or null if detection fails.
 */
export async function detectBodyJoints(
  imageData: ImageData,
  wasmBasePath?: string,
): Promise<KeypointMap | null> {
  const fileset = await FilesetResolver.forVisionTasks(
    wasmBasePath ?? 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm',
  )

  const poseLandmarker = await PoseLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath:
        'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
      delegate: 'CPU',
    },
    runningMode: 'IMAGE',
    numPoses: 1,
  })

  const result = poseLandmarker.detect(imageData)
  poseLandmarker.close()

  if (!result.landmarks || result.landmarks.length === 0) {
    return null
  }

  const lm = result.landmarks[0]
  const w = imageData.width
  const h = imageData.height

  // Check minimum landmark count (33 for full body)
  if (lm.length < 17) return null

  const nose = lm[POSE_LANDMARK.nose]
  if (nose.visibility < MIN_CONFIDENCE) return null

  const leftShoulder = landmarkToPixel(lm[POSE_LANDMARK.leftShoulder], w, h)
  const rightShoulder = landmarkToPixel(lm[POSE_LANDMARK.rightShoulder], w, h)

  const keypoints: KeypointMap = {
    shoulder_left: leftShoulder,
    shoulder_right: rightShoulder,
    elbow_left: landmarkToPixel(lm[POSE_LANDMARK.leftElbow], w, h),
    elbow_right: landmarkToPixel(lm[POSE_LANDMARK.rightElbow], w, h),
    wrist_left: landmarkToPixel(lm[POSE_LANDMARK.leftWrist], w, h),
    wrist_right: landmarkToPixel(lm[POSE_LANDMARK.rightWrist], w, h),
    torso_center: midpoint(
      midpoint(leftShoulder, rightShoulder),
      midpoint(
        landmarkToPixel(lm[POSE_LANDMARK.leftHip], w, h),
        landmarkToPixel(lm[POSE_LANDMARK.rightHip], w, h),
      ),
    ),
  }

  return keypoints
}

/**
 * Heuristic keypoint estimation based on bounding box proportions.
 * Used as fallback when MediaPipe fails on illustrated/anime characters.
 *
 * Uses standard body proportions:
 * - Head = top 20% of bounding box
 * - Face center at 12% from top
 * - Eyes at face ± 8% width
 * - Body = middle 40%
 * - Arms = side 20% strips
 */
export function estimateKeypointsHeuristic(imageRgba: ImageData): KeypointMap {
  const { width, height, data } = imageRgba

  // Find bounding box from alpha channel
  let minX = width
  let minY = height
  let maxX = 0
  let maxY = 0

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * 4 + 3]
      if (alpha > 10) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }

  // If no opaque pixels found, fall back to full image bounds
  if (maxX <= minX || maxY <= minY) {
    minX = 0
    minY = 0
    maxX = width - 1
    maxY = height - 1
  }

  const bw = maxX - minX
  const bh = maxY - minY
  const cx = minX + bw / 2

  return {
    face_center: [cx, minY + bh * 0.12],
    eye_left: [cx - bw * 0.08, minY + bh * 0.10],
    eye_right: [cx + bw * 0.08, minY + bh * 0.10],
    mouth_center: [cx, minY + bh * 0.18],
    nose_tip: [cx, minY + bh * 0.14],
    ear_left: [cx - bw * 0.15, minY + bh * 0.12],
    ear_right: [cx + bw * 0.15, minY + bh * 0.12],
    shoulder_left: [cx - bw * 0.20, minY + bh * 0.28],
    shoulder_right: [cx + bw * 0.20, minY + bh * 0.28],
    elbow_left: [cx - bw * 0.28, minY + bh * 0.45],
    elbow_right: [cx + bw * 0.28, minY + bh * 0.45],
    wrist_left: [cx - bw * 0.30, minY + bh * 0.58],
    wrist_right: [cx + bw * 0.30, minY + bh * 0.58],
    torso_center: [cx, minY + bh * 0.45],
  }
}

/**
 * Detect keypoints for a character image.
 * Tries MediaPipe face + pose detection first, falls back to heuristic
 * estimation if MediaPipe returns no results.
 */
export async function detectKeypoints(
  imageData: ImageData,
  wasmBasePath?: string,
): Promise<KeypointMap> {
  let facePoints: KeypointMap | null = null
  let bodyPoints: KeypointMap | null = null

  try {
    ;[facePoints, bodyPoints] = await Promise.all([
      detectFaceLandmarks(imageData, wasmBasePath),
      detectBodyJoints(imageData, wasmBasePath),
    ])
  } catch {
    // MediaPipe failed (missing models, WASM issues, etc.) — fall through to heuristic
  }

  // If both succeeded, merge them (face takes precedence for overlapping keys)
  if (facePoints && bodyPoints) {
    return { ...bodyPoints, ...facePoints }
  }

  // If only face succeeded, fill in body with heuristic
  if (facePoints) {
    const heuristic = estimateKeypointsHeuristic(imageData)
    return {
      ...heuristic,
      ...facePoints, // face keypoints override heuristic
    }
  }

  // If only body succeeded, fill in face with heuristic
  if (bodyPoints) {
    const heuristic = estimateKeypointsHeuristic(imageData)
    return {
      ...heuristic,
      ...bodyPoints, // body keypoints override heuristic
    }
  }

  // Neither succeeded — full heuristic fallback
  return estimateKeypointsHeuristic(imageData)
}
