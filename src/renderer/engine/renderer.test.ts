import { describe, it, expect } from 'vitest'
import { loadRig } from './rig'
import { createDeformer } from './deformer'

/**
 * Renderer tests focus on data flow validation — we can't instantiate
 * PixiJS in a pure Node test environment, but we can verify that the
 * rig loading and parameter pipeline produce sensible results.
 *
 * Visual verification (actual rendering) is done via `npm run dev` —
 * the renderer entry point loads the test rig and provides interactive
 * sliders. See src/renderer/main.ts.
 */

const TEST_RIG_JSON = JSON.stringify({
  version: '1.0',
  canvas: { width: 1024, height: 1024 },
  parts: [
    {
      id: 'face', zIndex: 1, texture: 'textures/face.png',
      mesh: {
        vertices: [[300,100],[500,100],[600,200],[600,400],[500,500],[300,500],[200,400],[200,200],[350,250],[450,250],[400,350]],
        uvs: [[0.25,0],[0.625,0],[0.875,0.25],[0.875,0.75],[0.625,1],[0.25,1],[0.125,0.75],[0.125,0.25],[0.375,0.375],[0.5625,0.375],[0.46875,0.625]],
        triangles: [[0,1,8],[1,2,9],[2,3,9],[3,4,10],[4,5,10],[5,6,10],[6,7,8],[7,0,8],[8,9,10],[6,10,8]],
      },
      deformers: [{ type: 'warp', paramBinding: 'head_angle_x', gridSize: [4,4], bbox: {x:200,y:100,w:400,h:400}, mode: 'squeeze_center' }],
    },
    {
      id: 'eye_left', zIndex: 2, texture: 'textures/eye_left.png',
      mesh: {
        vertices: [[310,220],[370,210],[380,260],[340,280],[300,260]],
        uvs: [[0.125,0.143],[0.875,0],[1,0.714],[0.5,1],[0,0.714]],
        triangles: [[0,1,4],[1,2,3],[1,3,4]],
      },
      deformers: [{ type: 'rotate', paramBinding: 'eye_open_left', origin: [340,250], childrenFollow: false }],
    },
  ],
  parameters: [
    { id: 'head_angle_x', range: [-30, 30], default: 0, keys: [-30, 0, 30] },
    { id: 'eye_open_left', range: [0, 1], default: 1, keys: [0, 0.5, 1] },
  ],
  physics: [
    { target: 'face', type: 'pendulum', length: 100, damping: 0.9, paramBinding: 'head_angle_x' },
  ],
})

describe('RigRenderer data pipeline', () => {
  it('test rig JSON parses successfully for renderer use', () => {
    const rig = loadRig(TEST_RIG_JSON)
    expect(rig.parts).toHaveLength(2)
    expect(rig.parameters).toHaveLength(2)
  })

  it('parts are sortable by zIndex', () => {
    const rig = loadRig(TEST_RIG_JSON)
    const sorted = [...rig.parts].sort((a, b) => a.zIndex - b.zIndex)
    expect(sorted[0].id).toBe('face')
    expect(sorted[1].id).toBe('eye_left')
  })

  it('vertex data flattens correctly to Float32Array', () => {
    const rig = loadRig(TEST_RIG_JSON)
    const face = rig.parts.find(p => p.id === 'face')!
    const positions = new Float32Array(face.mesh.vertices.length * 2)
    for (let i = 0; i < face.mesh.vertices.length; i++) {
      positions[i * 2] = face.mesh.vertices[i][0]
      positions[i * 2 + 1] = face.mesh.vertices[i][1]
    }
    expect(positions.length).toBe(22) // 11 vertices × 2
    expect(positions[0]).toBe(300)
    expect(positions[1]).toBe(100)
  })

  it('UV data flattens correctly to Float32Array', () => {
    const rig = loadRig(TEST_RIG_JSON)
    const face = rig.parts.find(p => p.id === 'face')!
    const uvs = new Float32Array(face.mesh.uvs.length * 2)
    for (let i = 0; i < face.mesh.uvs.length; i++) {
      uvs[i * 2] = face.mesh.uvs[i][0]
      uvs[i * 2 + 1] = face.mesh.uvs[i][1]
    }
    expect(uvs.length).toBe(22)
    // All UVs should be in [0, 1]
    for (let i = 0; i < uvs.length; i++) {
      expect(uvs[i]).toBeGreaterThanOrEqual(0)
      expect(uvs[i]).toBeLessThanOrEqual(1)
    }
  })

  it('triangle indices flatten correctly to Uint32Array', () => {
    const rig = loadRig(TEST_RIG_JSON)
    const face = rig.parts.find(p => p.id === 'face')!
    const indices = new Uint32Array(face.mesh.triangles.length * 3)
    for (let i = 0; i < face.mesh.triangles.length; i++) {
      indices[i * 3] = face.mesh.triangles[i][0]
      indices[i * 3 + 1] = face.mesh.triangles[i][1]
      indices[i * 3 + 2] = face.mesh.triangles[i][2]
    }
    expect(indices.length).toBe(30) // 10 triangles × 3
    // All indices should be within vertex bounds
    for (let i = 0; i < indices.length; i++) {
      expect(indices[i]).toBeLessThan(face.mesh.vertices.length)
    }
  })

  it('deformation produces no NaN or Infinity at parameter extremes', () => {
    const rig = loadRig(TEST_RIG_JSON)
    const face = rig.parts.find(p => p.id === 'face')!
    const positions = new Float32Array(face.mesh.vertices.length * 2)
    for (let i = 0; i < face.mesh.vertices.length; i++) {
      positions[i * 2] = face.mesh.vertices[i][0]
      positions[i * 2 + 1] = face.mesh.vertices[i][1]
    }

    for (const deformerConfig of face.deformers) {
      const deformer = createDeformer(deformerConfig, { x: 200, y: 100, w: 400, h: 400 })
      const param = rig.parameters.find(p => p.id === deformerConfig.paramBinding)!

      // Test at min, default, and max
      for (const val of [param.range[0], param.default, param.range[1]]) {
        const result = deformer.apply(positions, val)
        for (let i = 0; i < result.length; i++) {
          expect(Number.isFinite(result[i])).toBe(true)
        }
      }
    }
  })
})
