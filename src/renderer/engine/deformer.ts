import type { Deformer, WarpDeformer as WarpDeformerConfig, RotateDeformer as RotateDeformerConfig } from './rig'

// --- BBox type (matches the schema shape) ---

export interface BBox {
  x: number
  y: number
  w: number
  h: number
}

// --- Runtime deformer interface ---

export interface DeformerInstance {
  apply(vertices: Float32Array, paramValue: number): Float32Array
}

// --- Warp mode types ---

export type WarpModeType = 'squeeze_center' | 'stretch_bottom' | 'curve_ends_up' | 'scale_y'

/**
 * Compute per-control-point XY offsets for a given warp mode and parameter value.
 * Returns a Float32Array of [dx0, dy0, dx1, dy1, ...] with length = cols * rows * 2.
 * Mode implementations are defined separately as pure functions.
 */
export function computeWarpOffsets(
  cols: number,
  rows: number,
  bbox: BBox,
  mode: WarpModeType,
  t: number,
): Float32Array {
  const offsets = new Float32Array(cols * rows * 2) // initialized to 0
  switch (mode) {
    case 'squeeze_center':
      squeezeCenter(offsets, cols, rows, bbox, t)
      break
    case 'stretch_bottom':
      stretchBottom(offsets, cols, rows, bbox, t)
      break
    case 'curve_ends_up':
      curveEndsUp(offsets, cols, rows, bbox, t)
      break
    case 'scale_y':
      scaleY(offsets, cols, rows, bbox, t)
      break
  }
  return offsets
}

// Warp mode stubs — real implementations in sub-task 3.3

/**
 * Moves the top row downward and the bottom row upward toward the vertical center.
 * The amount is proportional to t and scales with the bbox height.
 * Interior rows are interpolated linearly so the grid stays smooth.
 */
function squeezeCenter(offsets: Float32Array, cols: number, rows: number, bbox: BBox, t: number): void {
  const maxShift = bbox.h * 0.25 // top/bottom rows can move up to 25% of height
  for (let row = 0; row < rows; row++) {
    // Normalised row position: 0 = top, 1 = bottom
    const rowNorm = rows > 1 ? row / (rows - 1) : 0.5
    // Squeeze factor: positive at top (push down), negative at bottom (push up), zero at center
    const squeeze = (0.5 - rowNorm) * -2 // top → -1, center → 0, bottom → 1
    // Invert: top rows get +dy (push down toward center), bottom rows get -dy (push up toward center)
    const dy = -squeeze * maxShift * t
    for (let col = 0; col < cols; col++) {
      const idx = (row * cols + col) * 2
      offsets[idx + 1] = dy
    }
  }
}

/**
 * Moves the bottom row downward. Upper rows are unaffected;
 * rows in between are linearly interpolated for a smooth stretch.
 */
function stretchBottom(offsets: Float32Array, cols: number, rows: number, bbox: BBox, t: number): void {
  const maxShift = bbox.h * 0.3 // bottom row moves up to 30% of height
  for (let row = 0; row < rows; row++) {
    const rowNorm = rows > 1 ? row / (rows - 1) : 0
    // Only rows toward the bottom get shifted, linearly ramped
    const dy = rowNorm * maxShift * t
    for (let col = 0; col < cols; col++) {
      const idx = (row * cols + col) * 2
      offsets[idx + 1] = dy
    }
  }
}

/**
 * Moves corner control points upward (negative dy), creating a concave curve.
 * The effect is strongest at the left/right edges and tapers toward the center column.
 * Only affects the bottom half of the grid.
 */
function curveEndsUp(offsets: Float32Array, cols: number, rows: number, bbox: BBox, t: number): void {
  const maxShift = bbox.h * 0.2
  for (let row = 0; row < rows; row++) {
    const rowNorm = rows > 1 ? row / (rows - 1) : 0.5
    // Only affect the bottom portion of the grid (rowNorm > 0.5)
    const rowFactor = Math.max(0, (rowNorm - 0.5) * 2) // 0 at middle, 1 at bottom
    for (let col = 0; col < cols; col++) {
      const colNorm = cols > 1 ? col / (cols - 1) : 0.5
      // Edge factor: 1 at left/right edges, 0 at center column
      const edgeFactor = Math.abs(colNorm - 0.5) * 2 // 0 at center, 1 at edges
      const dy = -edgeFactor * rowFactor * maxShift * t
      const idx = (row * cols + col) * 2
      offsets[idx + 1] = dy
    }
  }
}

/**
 * Scales all control points in Y around the grid's vertical center by (1 + t * 0.02).
 * Produces a subtle breathing/scaling effect.
 */
function scaleY(offsets: Float32Array, cols: number, rows: number, bbox: BBox, t: number): void {
  const centerY = bbox.y + bbox.h / 2
  const scale = t * 0.02 // fractional scale offset
  for (let row = 0; row < rows; row++) {
    // Absolute Y of this grid row
    const gridY = rows > 1 ? bbox.y + (row / (rows - 1)) * bbox.h : centerY
    const dy = (gridY - centerY) * scale
    for (let col = 0; col < cols; col++) {
      const idx = (row * cols + col) * 2
      offsets[idx + 1] = dy
    }
  }
}

// --- WarpDeformer ---

export class WarpDeformer implements DeformerInstance {
  readonly cols: number
  readonly rows: number
  readonly bbox: BBox
  readonly mode: WarpModeType

  constructor(gridSize: [number, number], bbox: BBox, mode: WarpModeType) {
    this.cols = gridSize[0]
    this.rows = gridSize[1]
    this.bbox = bbox
    this.mode = mode
  }

  apply(vertices: Float32Array, paramValue: number): Float32Array {
    const offsets = computeWarpOffsets(this.cols, this.rows, this.bbox, this.mode, paramValue)
    const out = new Float32Array(vertices.length)

    for (let i = 0; i < vertices.length; i += 2) {
      const vx = vertices[i]
      const vy = vertices[i + 1]

      // Normalize vertex position to grid-cell coordinates [0, cols-1] x [0, rows-1]
      const gx = ((vx - this.bbox.x) / this.bbox.w) * (this.cols - 1)
      const gy = ((vy - this.bbox.y) / this.bbox.h) * (this.rows - 1)

      // Find the grid cell containing this vertex
      const col0 = Math.max(0, Math.min(this.cols - 2, Math.floor(gx)))
      const row0 = Math.max(0, Math.min(this.rows - 2, Math.floor(gy)))
      const col1 = col0 + 1
      const row1 = row0 + 1

      // Fractional position within the cell, clamped to [0, 1]
      const fx = Math.max(0, Math.min(1, gx - col0))
      const fy = Math.max(0, Math.min(1, gy - row0))

      // Indices into the flat offsets array for the 4 cell corners
      const i00 = (row0 * this.cols + col0) * 2
      const i10 = (row0 * this.cols + col1) * 2
      const i01 = (row1 * this.cols + col0) * 2
      const i11 = (row1 * this.cols + col1) * 2

      // Bilinear interpolation of XY offsets
      const w00 = (1 - fx) * (1 - fy)
      const w10 = fx * (1 - fy)
      const w01 = (1 - fx) * fy
      const w11 = fx * fy

      const ox = w00 * offsets[i00] + w10 * offsets[i10] + w01 * offsets[i01] + w11 * offsets[i11]
      const oy = w00 * offsets[i00 + 1] + w10 * offsets[i10 + 1] + w01 * offsets[i01 + 1] + w11 * offsets[i11 + 1]

      out[i] = vx + ox
      out[i + 1] = vy + oy
    }

    return out
  }
}

// --- RotateDeformer ---

const DEG_TO_RAD = Math.PI / 180

export class RotateDeformer implements DeformerInstance {
  readonly originX: number
  readonly originY: number
  readonly childrenFollow: boolean

  constructor(origin: [number, number], childrenFollow: boolean) {
    this.originX = origin[0]
    this.originY = origin[1]
    this.childrenFollow = childrenFollow
  }

  apply(vertices: Float32Array, paramValue: number): Float32Array {
    const theta = paramValue * DEG_TO_RAD
    const cos = Math.cos(theta)
    const sin = Math.sin(theta)
    const out = new Float32Array(vertices.length)

    for (let i = 0; i < vertices.length; i += 2) {
      const dx = vertices[i] - this.originX
      const dy = vertices[i + 1] - this.originY
      out[i] = this.originX + dx * cos - dy * sin
      out[i + 1] = this.originY + dx * sin + dy * cos
    }

    return out
  }

  /** Returns the rotation transform for applying to child parts when childrenFollow is true. */
  getTransform(paramValue: number): { cos: number; sin: number; originX: number; originY: number } {
    const theta = paramValue * DEG_TO_RAD
    return {
      cos: Math.cos(theta),
      sin: Math.sin(theta),
      originX: this.originX,
      originY: this.originY,
    }
  }
}
