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

function squeezeCenter(_offsets: Float32Array, _cols: number, _rows: number, _bbox: BBox, _t: number): void {
  // TODO: 3.3
}

function stretchBottom(_offsets: Float32Array, _cols: number, _rows: number, _bbox: BBox, _t: number): void {
  // TODO: 3.3
}

function curveEndsUp(_offsets: Float32Array, _cols: number, _rows: number, _bbox: BBox, _t: number): void {
  // TODO: 3.3
}

function scaleY(_offsets: Float32Array, _cols: number, _rows: number, _bbox: BBox, _t: number): void {
  // TODO: 3.3
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
