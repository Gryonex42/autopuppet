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
