import { describe, it, expect } from 'vitest'
import type { Mesh, Parameter, Deformer } from '../engine/rig'
import type { KeypointMap } from './keypoint'
import {
  RIG_RULES,
  buildHierarchy,
  applyRules,
  generateKeyframes,
  addPhysics,
  generateIdle,
} from './autoRig'
import type { RigRule, PartTree, AnimationClip } from './autoRig'

// --- Test fixtures ---

/** Minimal keypoint map covering all standard keypoints. */
function makeKeypoints(): KeypointMap {
  return {
    face_center: [200, 100],
    eye_left: [180, 80],
    eye_right: [220, 80],
    mouth_center: [200, 130],
    nose_tip: [200, 110],
    ear_left: [160, 100],
    ear_right: [240, 100],
    shoulder_left: [150, 200],
    shoulder_right: [250, 200],
    elbow_left: [130, 300],
    elbow_right: [270, 300],
    wrist_left: [120, 380],
    wrist_right: [280, 380],
    torso_center: [200, 300],
  }
}

/** Create a simple square mesh for testing. */
function makeMesh(x: number, y: number, size: number): Mesh {
  const vertices: [number, number][] = [
    [x, y],
    [x + size, y],
    [x + size, y + size],
    [x, y + size],
  ]
  const uvs: [number, number][] = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ]
  const triangles: [number, number, number][] = [
    [0, 1, 2],
    [0, 2, 3],
  ]
  return { vertices, uvs, triangles }
}

// --- RIG_RULES tests ---

describe('RIG_RULES', () => {
  it('contains all 10 expected rules', () => {
    const expectedRules = [
      'head_angle_x',
      'head_angle_y',
      'eye_open_left',
      'eye_open_right',
      'mouth_open',
      'mouth_smile',
      'body_angle_x',
      'arm_L_angle',
      'arm_R_angle',
      'breathing',
    ]
    for (const name of expectedRules) {
      expect(RIG_RULES).toHaveProperty(name)
    }
    expect(Object.keys(RIG_RULES)).toHaveLength(10)
  })

  it('each rule has valid structure', () => {
    for (const [name, rule] of Object.entries(RIG_RULES)) {
      expect(rule.affects.length).toBeGreaterThan(0)
      expect(['warp', 'rotate']).toContain(rule.deformer)
      expect(rule.range).toHaveLength(2)
      expect(rule.range[0]).toBeLessThan(rule.range[1])
      expect(typeof rule.origin).toBe('string')
      expect(typeof rule.childrenFollow).toBe('boolean')
      expect(typeof rule.autoAnimate).toBe('boolean')

      if (rule.deformer === 'warp') {
        expect(rule.warpMode).toBeDefined()
      }
    }
  })
})

// --- buildHierarchy tests ---

describe('buildHierarchy', () => {
  it('assigns face children correctly', () => {
    const parts = ['face', 'eye_left', 'eye_right', 'mouth', 'nose', 'body']
    const tree = buildHierarchy(parts, makeKeypoints())

    expect(tree.parentOf.get('eye_left')).toBe('face')
    expect(tree.parentOf.get('eye_right')).toBe('face')
    expect(tree.parentOf.get('mouth')).toBe('face')
    expect(tree.parentOf.get('nose')).toBe('face')
    expect(tree.parentOf.get('face')).toBeNull()
    expect(tree.parentOf.get('body')).toBeNull()
  })

  it('assigns arm hierarchy correctly', () => {
    const parts = ['body', 'arm_upper_left', 'arm_lower_left', 'arm_upper_right']
    const tree = buildHierarchy(parts, makeKeypoints())

    expect(tree.parentOf.get('arm_upper_left')).toBe('body')
    expect(tree.parentOf.get('arm_lower_left')).toBe('arm_upper_left')
    expect(tree.parentOf.get('arm_upper_right')).toBe('body')
    expect(tree.parentOf.get('body')).toBeNull()
  })

  it('assigns hair parts under face', () => {
    const parts = ['face', 'hair_front', 'hair_back']
    const tree = buildHierarchy(parts, makeKeypoints())

    expect(tree.parentOf.get('hair_front')).toBe('face')
    expect(tree.parentOf.get('hair_back')).toBe('face')
  })

  it('puts unknown parts at root level', () => {
    const parts = ['face', 'body', 'accessory']
    const tree = buildHierarchy(parts, makeKeypoints())

    expect(tree.parentOf.get('accessory')).toBeNull()
    expect(tree.root.children.map((c) => c.id)).toContain('accessory')
  })

  it('falls back to root if parent part is missing', () => {
    // eye_left → face, but face doesn't exist
    const parts = ['eye_left', 'body']
    const tree = buildHierarchy(parts, makeKeypoints())

    expect(tree.parentOf.get('eye_left')).toBeNull()
    expect(tree.root.children.map((c) => c.id)).toContain('eye_left')
  })
})

// --- applyRules tests ---

describe('applyRules', () => {
  it('creates parameters and deformers for matching parts', () => {
    const meshes = new Map<string, Mesh>()
    meshes.set('face', makeMesh(150, 50, 100))
    meshes.set('eye_left', makeMesh(170, 70, 30))
    meshes.set('body', makeMesh(150, 200, 100))

    const keypoints = makeKeypoints()
    const hierarchy = buildHierarchy([...meshes.keys()], keypoints)

    const { parameters, deformers } = applyRules(hierarchy, keypoints, meshes, RIG_RULES)

    // Should have created parameters for rules whose parts exist
    expect(parameters.length).toBeGreaterThan(0)

    // head_angle_x should exist because face exists
    const headX = parameters.find((p) => p.id === 'head_angle_x')
    expect(headX).toBeDefined()
    expect(headX!.range).toEqual([-30, 30])
    expect(headX!.default).toBe(0)

    // face should have deformers
    const faceDefs = deformers.get('face')
    expect(faceDefs).toBeDefined()
    expect(faceDefs!.length).toBeGreaterThan(0)
  })

  it('skips rules with no matching parts', () => {
    const meshes = new Map<string, Mesh>()
    meshes.set('body', makeMesh(150, 200, 100))

    const keypoints = makeKeypoints()
    const hierarchy = buildHierarchy(['body'], keypoints)

    const { parameters } = applyRules(hierarchy, keypoints, meshes, RIG_RULES)

    // arm rules should be skipped since arm_upper_left/right don't exist
    const armL = parameters.find((p) => p.id === 'arm_L_angle')
    expect(armL).toBeUndefined()
  })

  it('creates warp deformers with correct bbox', () => {
    const meshes = new Map<string, Mesh>()
    meshes.set('face', makeMesh(100, 50, 200))

    const keypoints = makeKeypoints()
    const hierarchy = buildHierarchy(['face'], keypoints)

    const { deformers } = applyRules(hierarchy, keypoints, meshes, RIG_RULES)

    const faceDefs = deformers.get('face')!
    const warpDef = faceDefs.find((d) => d.type === 'warp')
    expect(warpDef).toBeDefined()
    if (warpDef && warpDef.type === 'warp') {
      expect(warpDef.bbox.x).toBe(100)
      expect(warpDef.bbox.y).toBe(50)
      expect(warpDef.bbox.w).toBe(200)
      expect(warpDef.bbox.h).toBe(200)
    }
  })

  it('creates rotate deformers with keypoint origin', () => {
    const meshes = new Map<string, Mesh>()
    meshes.set('face', makeMesh(150, 50, 100))

    const keypoints = makeKeypoints()
    const hierarchy = buildHierarchy(['face'], keypoints)

    const { deformers } = applyRules(hierarchy, keypoints, meshes, RIG_RULES)

    const faceDefs = deformers.get('face')!
    const rotateDef = faceDefs.find((d) => d.type === 'rotate')
    expect(rotateDef).toBeDefined()
    if (rotateDef && rotateDef.type === 'rotate') {
      expect(rotateDef.origin).toEqual([200, 100]) // face_center
      expect(rotateDef.childrenFollow).toBe(true)
    }
  })
})

// --- generateKeyframes tests ---

describe('generateKeyframes', () => {
  it('produces keyframes at min, default, and max for each parameter', () => {
    const meshes = new Map<string, Mesh>()
    meshes.set('face', makeMesh(100, 50, 200))

    const parameters: Parameter[] = [
      { id: 'test_param', range: [-10, 10], default: 0, keys: [-10, 0, 10] },
    ]
    const deformers = new Map<string, Deformer[]>()
    deformers.set('face', [
      {
        type: 'warp' as const,
        paramBinding: 'test_param',
        gridSize: [4, 4] as [number, number],
        bbox: { x: 100, y: 50, w: 200, h: 200 },
        mode: 'squeeze_center' as const,
      },
    ])

    const keyframes = generateKeyframes(parameters, meshes, deformers)

    expect(keyframes).toHaveLength(3) // min, default, max
    expect(keyframes[0].paramId).toBe('test_param')
    expect(keyframes[0].value).toBe(-10)
    expect(keyframes[1].value).toBe(0)
    expect(keyframes[2].value).toBe(10)

    // Each keyframe should have vertex data for the face part
    for (const kf of keyframes) {
      expect(kf.partVertices.has('face')).toBe(true)
      const verts = kf.partVertices.get('face')!
      expect(verts.length).toBe(8) // 4 vertices × 2 coords
    }
  })

  it('leaves vertices unchanged at param value 0 for identity deformers', () => {
    const meshes = new Map<string, Mesh>()
    const mesh = makeMesh(0, 0, 100)
    meshes.set('face', mesh)

    const parameters: Parameter[] = [
      { id: 'test', range: [-1, 1], default: 0, keys: [-1, 0, 1] },
    ]
    const deformers = new Map<string, Deformer[]>()
    deformers.set('face', [
      {
        type: 'rotate' as const,
        paramBinding: 'test',
        origin: [50, 50] as [number, number],
        childrenFollow: false,
      },
    ])

    const keyframes = generateKeyframes(parameters, meshes, deformers)
    const identityKf = keyframes.find((kf) => kf.value === 0)!
    const verts = identityKf.partVertices.get('face')!

    // At rotation 0, vertices should be unchanged
    for (let i = 0; i < mesh.vertices.length; i++) {
      expect(verts[i * 2]).toBeCloseTo(mesh.vertices[i][0])
      expect(verts[i * 2 + 1]).toBeCloseTo(mesh.vertices[i][1])
    }
  })
})

// --- addPhysics tests ---

describe('addPhysics', () => {
  it('creates physics configs for hair parts', () => {
    const parts = ['face', 'hair_front', 'hair_back', 'body']
    const { physics, physicsParams } = addPhysics(parts, makeKeypoints())

    expect(physics).toHaveLength(2)
    expect(physicsParams).toHaveLength(2)

    const hairFront = physics.find((p) => p.target === 'hair_front')
    expect(hairFront).toBeDefined()
    expect(hairFront!.type).toBe('pendulum')
    expect(hairFront!.damping).toBe(0.9)
    expect(hairFront!.paramBinding).toBe('hair_front_physics')
  })

  it('creates physics configs for cloth parts', () => {
    const parts = ['body', 'cloth_ribbon']
    const { physics } = addPhysics(parts, makeKeypoints())

    expect(physics).toHaveLength(1)
    expect(physics[0].target).toBe('cloth_ribbon')
  })

  it('skips non-physics parts', () => {
    const parts = ['face', 'eye_left', 'body']
    const { physics } = addPhysics(parts, makeKeypoints())

    expect(physics).toHaveLength(0)
  })

  it('each physics entry has a matching parameter', () => {
    const parts = ['hair_front', 'hair_side']
    const { physics, physicsParams } = addPhysics(parts, makeKeypoints())

    for (const p of physics) {
      const matchingParam = physicsParams.find((pp) => pp.id === p.paramBinding)
      expect(matchingParam).toBeDefined()
    }
  })
})

// --- generateIdle tests ---

describe('generateIdle', () => {
  it('generates a looping 6s clip', () => {
    const params: Parameter[] = [
      { id: 'breathing', range: [0, 1], default: 0, keys: [0, 0, 1] },
      { id: 'head_angle_x', range: [-30, 30], default: 0, keys: [-30, 0, 30] },
      { id: 'eye_open_left', range: [0, 1], default: 1, keys: [0, 0.5, 1] },
      { id: 'eye_open_right', range: [0, 1], default: 1, keys: [0, 0.5, 1] },
    ]

    const clip = generateIdle(params)

    expect(clip.name).toBe('idle')
    expect(clip.duration).toBe(6)
    expect(clip.loop).toBe(true)
  })

  it('includes breathing track when param exists', () => {
    const params: Parameter[] = [
      { id: 'breathing', range: [0, 1], default: 0, keys: [0, 0, 1] },
    ]

    const clip = generateIdle(params)
    const breathingTrack = clip.tracks.find((t) => t.paramId === 'breathing')

    expect(breathingTrack).toBeDefined()
    expect(breathingTrack!.keyframes.length).toBeGreaterThan(0)

    // Breathing values should be in [0, 1]
    for (const kf of breathingTrack!.keyframes) {
      expect(kf.value).toBeGreaterThanOrEqual(-0.01)
      expect(kf.value).toBeLessThanOrEqual(1.01)
    }
  })

  it('includes head sway track with small amplitude', () => {
    const params: Parameter[] = [
      { id: 'head_angle_x', range: [-30, 30], default: 0, keys: [-30, 0, 30] },
    ]

    const clip = generateIdle(params)
    const swayTrack = clip.tracks.find((t) => t.paramId === 'head_angle_x')

    expect(swayTrack).toBeDefined()
    // Amplitude should be 10% of range = 6 degrees
    for (const kf of swayTrack!.keyframes) {
      expect(Math.abs(kf.value)).toBeLessThanOrEqual(7) // some tolerance
    }
  })

  it('includes blink tracks for both eyes', () => {
    const params: Parameter[] = [
      { id: 'eye_open_left', range: [0, 1], default: 1, keys: [0, 0.5, 1] },
      { id: 'eye_open_right', range: [0, 1], default: 1, keys: [0, 0.5, 1] },
    ]

    const clip = generateIdle(params)
    const blinkL = clip.tracks.find((t) => t.paramId === 'eye_open_left')
    const blinkR = clip.tracks.find((t) => t.paramId === 'eye_open_right')

    expect(blinkL).toBeDefined()
    expect(blinkR).toBeDefined()

    // Should have at least 2 blink events (close + open pairs)
    const closedFramesL = blinkL!.keyframes.filter((kf) => kf.value === 0)
    expect(closedFramesL.length).toBeGreaterThanOrEqual(2)
  })

  it('produces no tracks when no matching params exist', () => {
    const params: Parameter[] = [
      { id: 'mouth_open', range: [0, 1], default: 0, keys: [0, 0, 1] },
    ]

    const clip = generateIdle(params)
    expect(clip.tracks).toHaveLength(0)
  })
})
