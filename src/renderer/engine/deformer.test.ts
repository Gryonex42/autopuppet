import { describe, it, expect } from 'vitest'
import {
  WarpDeformer,
  RotateDeformer,
  createDeformer,
  computeWarpOffsets,
  type BBox,
} from './deformer'
import type { Deformer } from './rig'

const bbox: BBox = { x: 0, y: 0, w: 100, h: 100 }

// --- RotateDeformer ---

describe('RotateDeformer', () => {
  it('rotates vertex (1,0) to (0,1) at 90° around origin (0,0)', () => {
    const rot = new RotateDeformer([0, 0], false)
    const verts = new Float32Array([1, 0])
    const result = rot.apply(verts, 90)
    expect(result[0]).toBeCloseTo(0, 5)
    expect(result[1]).toBeCloseTo(1, 5)
  })

  it('rotates vertex (1,0) to (-1,0) at 180° around origin (0,0)', () => {
    const rot = new RotateDeformer([0, 0], false)
    const verts = new Float32Array([1, 0])
    const result = rot.apply(verts, 180)
    expect(result[0]).toBeCloseTo(-1, 5)
    expect(result[1]).toBeCloseTo(0, 5)
  })

  it('returns original vertices unchanged at 0°', () => {
    const rot = new RotateDeformer([50, 50], false)
    const verts = new Float32Array([100, 50, 50, 100, 0, 50])
    const result = rot.apply(verts, 0)
    for (let i = 0; i < verts.length; i++) {
      expect(result[i]).toBeCloseTo(verts[i], 5)
    }
  })

  it('rotates around a non-zero origin correctly', () => {
    const rot = new RotateDeformer([50, 50], false)
    // Vertex at (100, 50) is 50 units to the right of origin
    const verts = new Float32Array([100, 50])
    const result = rot.apply(verts, 90)
    // Should end up at (50, 100) — 50 units below origin
    expect(result[0]).toBeCloseTo(50, 5)
    expect(result[1]).toBeCloseTo(100, 5)
  })

  it('handles multiple vertices in a single call', () => {
    const rot = new RotateDeformer([0, 0], false)
    const verts = new Float32Array([1, 0, 0, 1])
    const result = rot.apply(verts, 90)
    // (1,0) → (0,1)
    expect(result[0]).toBeCloseTo(0, 5)
    expect(result[1]).toBeCloseTo(1, 5)
    // (0,1) → (-1,0)
    expect(result[2]).toBeCloseTo(-1, 5)
    expect(result[3]).toBeCloseTo(0, 5)
  })

  it('getTransform returns correct cos/sin for 90°', () => {
    const rot = new RotateDeformer([10, 20], true)
    const t = rot.getTransform(90)
    expect(t.cos).toBeCloseTo(0, 5)
    expect(t.sin).toBeCloseTo(1, 5)
    expect(t.originX).toBe(10)
    expect(t.originY).toBe(20)
  })
})

// --- WarpDeformer: identity ---

describe('WarpDeformer', () => {
  it('returns original vertices unchanged when t=0 (all modes)', () => {
    const modes = ['squeeze_center', 'stretch_bottom', 'curve_ends_up', 'scale_y'] as const
    const verts = new Float32Array([25, 25, 50, 50, 75, 75])

    for (const mode of modes) {
      const warp = new WarpDeformer([4, 4], bbox, mode)
      const result = warp.apply(verts, 0)
      for (let i = 0; i < verts.length; i++) {
        expect(result[i]).toBeCloseTo(verts[i], 5, `mode=${mode} index=${i}`)
      }
    }
  })

  it('squeezeCenter with t=1 moves top row down and bottom row up', () => {
    const offsets = computeWarpOffsets(4, 4, bbox, 'squeeze_center', 1)
    // Top row (row=0): should have positive dy (push down toward center)
    // rowNorm=0, squeeze=(0.5-0)*-2=-1, dy=-(-1)*25*1=+25
    const topDy = offsets[1] // first control point dy
    expect(topDy).toBeCloseTo(25, 5)

    // Bottom row (row=3): should have negative dy (push up toward center)
    // rowNorm=1, squeeze=(0.5-1)*-2=1, dy=-(1)*25*1=-25
    const bottomIdx = (3 * 4 + 0) * 2 + 1
    const bottomDy = offsets[bottomIdx]
    expect(bottomDy).toBeCloseTo(-25, 5)

    // Middle rows should have smaller absolute offsets
    // row=1: rowNorm=1/3, squeeze=(0.5-1/3)*-2=-1/3, dy=-(-1/3)*25=8.33
    const midIdx = (1 * 4 + 0) * 2 + 1
    expect(Math.abs(offsets[midIdx])).toBeLessThan(Math.abs(topDy))
  })

  it('squeezeCenter does not shift in X', () => {
    const offsets = computeWarpOffsets(4, 4, bbox, 'squeeze_center', 1)
    for (let i = 0; i < offsets.length; i += 2) {
      expect(offsets[i]).toBe(0)
    }
  })

  it('stretchBottom moves bottom row downward at t=1', () => {
    const offsets = computeWarpOffsets(4, 4, bbox, 'stretch_bottom', 1)
    // Top row (row=0): rowNorm=0, dy=0
    expect(offsets[1]).toBe(0)

    // Bottom row (row=3): rowNorm=1, dy=1*30*1=30
    const bottomIdx = (3 * 4 + 0) * 2 + 1
    expect(offsets[bottomIdx]).toBeCloseTo(30, 5)

    // Middle row should be proportional
    const midIdx = (1 * 4 + 0) * 2 + 1
    expect(offsets[midIdx]).toBeGreaterThan(0)
    expect(offsets[midIdx]).toBeLessThan(offsets[bottomIdx])
  })

  it('curveEndsUp moves bottom corners upward at t=1', () => {
    const offsets = computeWarpOffsets(4, 4, bbox, 'curve_ends_up', 1)
    // Bottom-left corner (row=3, col=0)
    const blIdx = (3 * 4 + 0) * 2 + 1
    expect(offsets[blIdx]).toBeLessThan(0) // moved upward

    // Bottom-right corner (row=3, col=3)
    const brIdx = (3 * 4 + 3) * 2 + 1
    expect(offsets[brIdx]).toBeLessThan(0)

    // Bottom center column should be unaffected (edge factor = 0)
    // With 4 cols: col=1 → colNorm=1/3, edgeFactor=|1/3-0.5|*2=1/3
    // col=2 → colNorm=2/3, edgeFactor=|2/3-0.5|*2=1/3 — same, small
    // The center-most columns have smaller displacement than edges
    const bcIdx1 = (3 * 4 + 1) * 2 + 1
    expect(Math.abs(offsets[bcIdx1])).toBeLessThan(Math.abs(offsets[blIdx]))

    // Top row should be unaffected (rowFactor = 0)
    expect(offsets[1]).toBeCloseTo(0, 5)
  })

  it('scaleY expands top/bottom away from center at t=1', () => {
    const offsets = computeWarpOffsets(4, 4, bbox, 'scale_y', 1)
    // scale = 1 * 0.02 = 0.02, centerY = 50
    // Top row: gridY=0, dy=(0-50)*0.02=-1
    expect(offsets[1]).toBeCloseTo(-1, 5)

    // Bottom row: gridY=100, dy=(100-50)*0.02=+1
    const bottomIdx = (3 * 4 + 0) * 2 + 1
    expect(offsets[bottomIdx]).toBeCloseTo(1, 5)

    // Center rows should have ~0 offset
    // row=1: gridY=100/3=33.33, dy=(33.33-50)*0.02=-0.333
    // row=2: gridY=200/3=66.67, dy=(66.67-50)*0.02=+0.333
    const mid1Idx = (1 * 4 + 0) * 2 + 1
    const mid2Idx = (2 * 4 + 0) * 2 + 1
    expect(offsets[mid1Idx]).toBeCloseTo(-0.333, 2)
    expect(offsets[mid2Idx]).toBeCloseTo(0.333, 2)
  })

  it('bilinear interpolation produces smooth output for a vertex at grid center', () => {
    // A vertex at the exact center of the bbox should get the average of the
    // 4 surrounding control-point offsets
    const warp = new WarpDeformer([2, 2], bbox, 'stretch_bottom')
    const verts = new Float32Array([50, 50])
    const result = warp.apply(verts, 1)
    // For a 2×2 grid on stretch_bottom with t=1:
    // row0 (top): dy=0, row1 (bottom): dy=30
    // Vertex at (50,50) is at gx=0.5, gy=0.5 → interpolated dy = average of 0 and 30 = 15
    expect(result[0]).toBeCloseTo(50, 5) // no x shift
    expect(result[1]).toBeCloseTo(65, 5) // 50 + 15
  })
})

// --- createDeformer factory ---

describe('createDeformer', () => {
  it('creates a WarpDeformer from a warp config', () => {
    const config: Deformer = {
      type: 'warp',
      paramBinding: 'head_angle_x',
      gridSize: [4, 4],
      bbox: { x: 0, y: 0, w: 100, h: 100 },
      mode: 'squeeze_center',
    }
    const instance = createDeformer(config, bbox)
    expect(instance).toBeInstanceOf(WarpDeformer)
  })

  it('creates a RotateDeformer from a rotate config', () => {
    const config: Deformer = {
      type: 'rotate',
      paramBinding: 'eye_open_left',
      origin: [50, 50],
      childrenFollow: false,
    }
    const instance = createDeformer(config, bbox)
    expect(instance).toBeInstanceOf(RotateDeformer)
  })

  it('created WarpDeformer produces correct output', () => {
    const config: Deformer = {
      type: 'warp',
      paramBinding: 'test',
      gridSize: [4, 4],
      bbox: { x: 0, y: 0, w: 100, h: 100 },
      mode: 'scale_y',
    }
    const instance = createDeformer(config, bbox)
    const verts = new Float32Array([50, 50])
    const result = instance.apply(verts, 0)
    expect(result[0]).toBeCloseTo(50, 5)
    expect(result[1]).toBeCloseTo(50, 5)
  })

  it('created RotateDeformer produces correct output', () => {
    const config: Deformer = {
      type: 'rotate',
      paramBinding: 'test',
      origin: [0, 0],
      childrenFollow: true,
    }
    const instance = createDeformer(config, bbox)
    const verts = new Float32Array([1, 0])
    const result = instance.apply(verts, 90)
    expect(result[0]).toBeCloseTo(0, 5)
    expect(result[1]).toBeCloseTo(1, 5)
  })
})
