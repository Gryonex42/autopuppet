/**
 * Auto-Rigging Rules Engine
 *
 * Deterministic pipeline that takes segmented parts, keypoints, and meshes
 * and produces a complete Rig with parameters, deformers, physics, and idle animation.
 */

import type { Rig, Part, Parameter, Physics, Mesh, Deformer } from '../engine/rig'
import type { WarpModeType, BBox } from '../engine/deformer'
import { WarpDeformer as WarpDeformerImpl, RotateDeformer as RotateDeformerImpl } from '../engine/deformer'
import type { KeypointMap } from './keypoint'

// --- 10.1: RigRule interface ---

/** A rule mapping a parameter to the parts it affects and how it deforms them. */
export interface RigRule {
  /** Part IDs this rule's parameter controls */
  affects: string[]
  /** Deformer type to apply */
  deformer: 'warp' | 'rotate'
  /** Parameter value range [min, max] */
  range: [number, number]
  /** Keypoint name used as the deformer origin */
  origin: string
  /** Primary warp axis (warp deformers only) */
  warpAxis?: 'x' | 'y'
  /** Warp mode (warp deformers only) */
  warpMode?: WarpModeType
  /** Whether child parts follow this deformation */
  childrenFollow: boolean
  /** Whether this parameter gets automatic idle animation */
  autoAnimate: boolean
}

// --- 10.2: RIG_RULES constant ---

/**
 * The 10 standard rigging rules. Each maps a parameter name to the parts
 * it affects, the deformer type, origin keypoint, and animation behaviour.
 */
export const RIG_RULES: Record<string, RigRule> = {
  head_angle_x: {
    affects: ['face', 'eye_left', 'eye_right', 'mouth', 'nose', 'ear_left', 'ear_right'],
    deformer: 'rotate',
    range: [-30, 30],
    origin: 'face_center',
    childrenFollow: true,
    autoAnimate: true,
  },
  head_angle_y: {
    affects: ['face', 'eye_left', 'eye_right', 'mouth', 'nose', 'ear_left', 'ear_right'],
    deformer: 'warp',
    range: [-30, 30],
    origin: 'face_center',
    warpAxis: 'y',
    warpMode: 'squeeze_center',
    childrenFollow: true,
    autoAnimate: false,
  },
  eye_open_left: {
    affects: ['eye_left'],
    deformer: 'warp',
    range: [0, 1],
    origin: 'eye_left',
    warpAxis: 'y',
    warpMode: 'squeeze_center',
    childrenFollow: false,
    autoAnimate: true,
  },
  eye_open_right: {
    affects: ['eye_right'],
    deformer: 'warp',
    range: [0, 1],
    origin: 'eye_right',
    warpAxis: 'y',
    warpMode: 'squeeze_center',
    childrenFollow: false,
    autoAnimate: true,
  },
  mouth_open: {
    affects: ['mouth'],
    deformer: 'warp',
    range: [0, 1],
    origin: 'mouth_center',
    warpAxis: 'y',
    warpMode: 'stretch_bottom',
    childrenFollow: false,
    autoAnimate: false,
  },
  mouth_smile: {
    affects: ['mouth'],
    deformer: 'warp',
    range: [-1, 1],
    origin: 'mouth_center',
    warpAxis: 'y',
    warpMode: 'curve_ends_up',
    childrenFollow: false,
    autoAnimate: false,
  },
  body_angle_x: {
    affects: ['body'],
    deformer: 'rotate',
    range: [-15, 15],
    origin: 'torso_center',
    childrenFollow: true,
    autoAnimate: false,
  },
  arm_L_angle: {
    affects: ['arm_upper_left'],
    deformer: 'rotate',
    range: [-45, 45],
    origin: 'shoulder_left',
    childrenFollow: true,
    autoAnimate: false,
  },
  arm_R_angle: {
    affects: ['arm_upper_right'],
    deformer: 'rotate',
    range: [-45, 45],
    origin: 'shoulder_right',
    childrenFollow: true,
    autoAnimate: false,
  },
  breathing: {
    affects: ['body', 'face'],
    deformer: 'warp',
    range: [0, 1],
    origin: 'torso_center',
    warpAxis: 'y',
    warpMode: 'scale_y',
    childrenFollow: false,
    autoAnimate: true,
  },
}

// --- 10.3: Part hierarchy ---

/** A node in the part hierarchy tree. */
export interface PartNode {
  id: string
  children: PartNode[]
}

/** The full part tree with a virtual root. */
export interface PartTree {
  root: PartNode
  /** Flat lookup: part id → parent id (null for top-level parts) */
  parentOf: Map<string, string | null>
}

/** Parts that belong under the head group */
const HEAD_PARTS = ['face', 'eye_left', 'eye_right', 'mouth', 'nose', 'ear_left', 'ear_right']

/** Pattern-based parent assignment. Maps part name prefixes to parent part. */
const PARENT_RULES: [RegExp, string][] = [
  [/^eye_/, 'face'],
  [/^mouth/, 'face'],
  [/^nose/, 'face'],
  [/^ear_/, 'face'],
  [/^hair/, 'face'],
  [/^arm_lower_left/, 'arm_upper_left'],
  [/^arm_lower_right/, 'arm_upper_right'],
  [/^arm_upper_/, 'body'],
]

/**
 * Build a part hierarchy tree from part names and keypoints.
 *
 * Structure:
 *   root
 *   ├── body
 *   │   ├── arm_upper_left
 *   │   │   └── arm_lower_left
 *   │   └── arm_upper_right
 *   │       └── arm_lower_right
 *   └── face
 *       ├── eye_left
 *       ├── eye_right
 *       ├── mouth
 *       ├── nose
 *       ├── ear_left
 *       ├── ear_right
 *       └── hair_*
 *
 * Parts not matching any pattern are placed at the root level.
 */
export function buildHierarchy(
  partNames: string[],
  _keypoints: KeypointMap,
): PartTree {
  const nameSet = new Set(partNames)
  const parentOf = new Map<string, string | null>()

  // Assign parents via pattern matching
  for (const name of partNames) {
    let assigned = false
    for (const [pattern, parent] of PARENT_RULES) {
      if (pattern.test(name) && nameSet.has(parent)) {
        parentOf.set(name, parent)
        assigned = true
        break
      }
    }
    if (!assigned) {
      // Top-level part (body, face, or unknown)
      parentOf.set(name, null)
    }
  }

  // Build tree nodes
  const nodes = new Map<string, PartNode>()
  for (const name of partNames) {
    nodes.set(name, { id: name, children: [] })
  }

  const root: PartNode = { id: '__root__', children: [] }

  for (const name of partNames) {
    const parentId = parentOf.get(name)
    if (parentId === null || parentId === undefined) {
      root.children.push(nodes.get(name)!)
    } else {
      const parentNode = nodes.get(parentId)
      if (parentNode) {
        parentNode.children.push(nodes.get(name)!)
      } else {
        // Parent doesn't exist as a part — attach to root
        parentOf.set(name, null)
        root.children.push(nodes.get(name)!)
      }
    }
  }

  return { root, parentOf }
}

// --- 10.4: Apply rules to produce parameters and deformers ---

/** Default grid size for warp deformers */
const DEFAULT_GRID_SIZE: [number, number] = [4, 4]

/** Compute the axis-aligned bounding box of a mesh's vertices. */
function meshBbox(mesh: Mesh): BBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [x, y] of mesh.vertices) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  const w = Math.max(1, maxX - minX)
  const h = Math.max(1, maxY - minY)
  return { x: minX, y: minY, w, h }
}

/**
 * Apply rigging rules to produce Parameter and Deformer configs.
 *
 * For each rule, resolves the origin keypoint to pixel coordinates,
 * filters to only the parts that actually exist in the segmentation,
 * and produces the appropriate deformer config for each affected part.
 *
 * Returns parameters (for the rig root) and a per-part deformer map.
 */
export function applyRules(
  _hierarchy: PartTree,
  keypoints: KeypointMap,
  meshes: Map<string, Mesh>,
  rules: Record<string, RigRule>,
): { parameters: Parameter[]; deformers: Map<string, Deformer[]> } {
  const parameters: Parameter[] = []
  const deformers = new Map<string, Deformer[]>()

  // Initialise deformer lists for every part
  for (const partId of meshes.keys()) {
    deformers.set(partId, [])
  }

  for (const [paramId, rule] of Object.entries(rules)) {
    // Filter to parts that actually exist
    const existingParts = rule.affects.filter((id) => meshes.has(id))
    if (existingParts.length === 0) continue

    // Resolve origin keypoint
    const originCoords = keypoints[rule.origin]
    if (!originCoords) continue

    // Create the parameter
    const defaultValue = rule.range[0] <= 0 && rule.range[1] >= 0
      ? 0
      : rule.range[0] // sensible default within range
    parameters.push({
      id: paramId,
      range: rule.range,
      default: defaultValue,
      keys: [rule.range[0], defaultValue, rule.range[1]],
    })

    // Create deformers for each affected part
    for (const partId of existingParts) {
      const mesh = meshes.get(partId)!
      const bbox = meshBbox(mesh)
      let deformer: Deformer

      if (rule.deformer === 'warp') {
        deformer = {
          type: 'warp' as const,
          paramBinding: paramId,
          gridSize: DEFAULT_GRID_SIZE,
          bbox,
          mode: rule.warpMode ?? 'squeeze_center',
        }
      } else {
        deformer = {
          type: 'rotate' as const,
          paramBinding: paramId,
          origin: originCoords,
          childrenFollow: rule.childrenFollow,
        }
      }

      deformers.get(partId)!.push(deformer)
    }
  }

  return { parameters, deformers }
}

// --- 10.5: Generate keyframe data ---

/** Pre-computed deformation snapshot at a specific parameter value. */
export interface KeyframeData {
  paramId: string
  value: number
  /** Per-part vertex positions at this parameter value. */
  partVertices: Map<string, Float32Array>
}

/**
 * For each parameter, generate deformation data at 3 key values: min, default, max.
 * This pre-computes the vertex positions at each extreme so the runtime can
 * interpolate between them.
 */
export function generateKeyframes(
  parameters: Parameter[],
  meshes: Map<string, Mesh>,
  deformers: Map<string, Deformer[]>,
): KeyframeData[] {
  const keyframes: KeyframeData[] = []

  for (const param of parameters) {
    for (const keyValue of param.keys) {
      const partVertices = new Map<string, Float32Array>()

      for (const [partId, partDeformers] of deformers) {
        const mesh = meshes.get(partId)
        if (!mesh) continue

        // Start with base vertex positions
        let verts: Float32Array = new Float32Array(mesh.vertices.length * 2)
        for (let i = 0; i < mesh.vertices.length; i++) {
          verts[i * 2] = mesh.vertices[i][0]
          verts[i * 2 + 1] = mesh.vertices[i][1]
        }

        // Apply only deformers bound to this parameter
        for (const def of partDeformers) {
          if (def.paramBinding !== param.id) continue

          if (def.type === 'warp') {
            const wd = new WarpDeformerImpl(def.gridSize, def.bbox, def.mode)
            verts = wd.apply(verts, keyValue) as Float32Array
          } else {
            const rd = new RotateDeformerImpl(def.origin, def.childrenFollow)
            verts = rd.apply(verts, keyValue) as Float32Array
          }
        }

        partVertices.set(partId, verts)
      }

      keyframes.push({ paramId: param.id, value: keyValue, partVertices })
    }
  }

  return keyframes
}

// --- 10.6: Add physics ---

/** Pattern for parts that should get physics simulation. */
const PHYSICS_PART_PATTERN = /hair|cloth/i

/**
 * Detect parts whose names contain "hair" or "cloth" and create
 * pendulum physics configs with appropriate anchor points.
 *
 * Each physics-enabled part gets a unique parameter binding
 * (e.g., `hair_front_physics`) so it can be driven by the physics engine.
 */
export function addPhysics(
  partNames: string[],
  keypoints: KeypointMap,
): { physics: Physics[]; physicsParams: Parameter[] } {
  const physics: Physics[] = []
  const physicsParams: Parameter[] = []

  for (const partName of partNames) {
    if (!PHYSICS_PART_PATTERN.test(partName)) continue

    // Derive anchor point: use face_center for hair, torso_center for cloth
    const isHair = /hair/i.test(partName)
    const anchorKey = isHair ? 'face_center' : 'torso_center'
    const anchor = keypoints[anchorKey]
    if (!anchor) continue

    // Estimate pendulum length based on distance from anchor
    // Default to a reasonable value if we can't compute it
    const length = isHair ? 80 : 120

    const paramId = `${partName}_physics`

    physicsParams.push({
      id: paramId,
      range: [-45, 45],
      default: 0,
      keys: [-45, 0, 45],
    })

    physics.push({
      target: partName,
      type: 'pendulum',
      length,
      damping: 0.9,
      paramBinding: paramId,
    })
  }

  return { physics, physicsParams }
}

// --- 10.7: Generate idle animation ---

/** A single keyframe: value at a specific time. */
export interface AnimKeyframe {
  time: number
  value: number
  easing: 'linear' | 'easeIn' | 'easeOut' | 'easeInOut'
}

/** A track of keyframes for one parameter. */
export interface AnimTrack {
  paramId: string
  keyframes: AnimKeyframe[]
}

/** A complete animation clip. */
export interface AnimationClip {
  name: string
  duration: number
  loop: boolean
  tracks: AnimTrack[]
}

/**
 * Generate an idle animation clip with:
 * - Breathing (sine wave, 3s period)
 * - Gentle head sway (sine, 6s period, small amplitude)
 * - Auto-blink (every 3–5s, 0.15s duration)
 *
 * The clip duration is 6s (LCM of breathing and sway periods) to loop seamlessly.
 */
export function generateIdle(parameters: Parameter[]): AnimationClip {
  const paramIds = new Set(parameters.map((p) => p.id))
  const tracks: AnimTrack[] = []
  const duration = 6 // seconds

  // Breathing: sine wave, 3s period
  if (paramIds.has('breathing')) {
    const breathingTrack: AnimTrack = { paramId: 'breathing', keyframes: [] }
    const period = 3
    const steps = 12 // sample every 0.5s
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * duration
      // Sine wave mapped to [0, 1]
      const value = (Math.sin((t / period) * Math.PI * 2) + 1) / 2
      breathingTrack.keyframes.push({ time: t, value, easing: 'linear' })
    }
    tracks.push(breathingTrack)
  }

  // Head sway: sine, 6s period, small amplitude
  if (paramIds.has('head_angle_x')) {
    const param = parameters.find((p) => p.id === 'head_angle_x')!
    const amplitude = (param.range[1] - param.range[0]) * 0.1 // 10% of range
    const swayTrack: AnimTrack = { paramId: 'head_angle_x', keyframes: [] }
    const steps = 12
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * duration
      const value = Math.sin((t / duration) * Math.PI * 2) * amplitude
      swayTrack.keyframes.push({ time: t, value, easing: 'linear' })
    }
    tracks.push(swayTrack)
  }

  // Auto-blink: every ~4s, 0.15s duration
  const blinkParams = ['eye_open_left', 'eye_open_right']
  for (const blinkId of blinkParams) {
    if (!paramIds.has(blinkId)) continue
    const param = parameters.find((p) => p.id === blinkId)!
    const openValue = param.range[1] // eyes open = max
    const closedValue = param.range[0] // eyes closed = min
    const blinkTrack: AnimTrack = { paramId: blinkId, keyframes: [] }

    // Start open
    blinkTrack.keyframes.push({ time: 0, value: openValue, easing: 'linear' })

    // Blink at ~2s
    blinkTrack.keyframes.push({ time: 1.9, value: openValue, easing: 'linear' })
    blinkTrack.keyframes.push({ time: 2.0, value: closedValue, easing: 'easeIn' })
    blinkTrack.keyframes.push({ time: 2.15, value: openValue, easing: 'easeOut' })

    // Blink at ~5s
    blinkTrack.keyframes.push({ time: 4.9, value: openValue, easing: 'linear' })
    blinkTrack.keyframes.push({ time: 5.0, value: closedValue, easing: 'easeIn' })
    blinkTrack.keyframes.push({ time: 5.15, value: openValue, easing: 'easeOut' })

    // End open
    blinkTrack.keyframes.push({ time: duration, value: openValue, easing: 'linear' })

    tracks.push(blinkTrack)
  }

  return { name: 'idle', duration, loop: true, tracks }
}

// --- 10.8: autoRig orchestrator ---

import { detectKeypoints } from './keypoint'
import {
  segmentByKeypoints,
  exportPartTextures,
  PART_PRIORITY,
  getMaskBbox,
} from './segmenter'
import { generateMesh } from './meshGen'
import type { BBox as MeshBBox } from './meshGen'

/**
 * Load a PNG file and decode it into an ImageData object.
 * Uses the renderer's OffscreenCanvas API.
 */
async function loadImageData(imagePath: string): Promise<ImageData> {
  const buffer = await window.api.readFile(imagePath)
  const blob = new Blob([buffer], { type: 'image/png' })
  const bitmap = await createImageBitmap(blob)
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bitmap, 0, 0)
  return ctx.getImageData(0, 0, bitmap.width, bitmap.height)
}

/**
 * Top-level auto-rigging orchestrator.
 *
 * Takes a character PNG path and produces a complete Rig:
 * 1. Detect keypoints (face, body)
 * 2. Segment into parts via SAM
 * 3. Export part textures
 * 4. Generate meshes per part
 * 5. Build hierarchy, apply rules, generate keyframes
 * 6. Add physics for hair/cloth
 * 7. Generate idle animation
 * 8. Assemble into a Rig object
 */
export async function autoRig(
  imagePath: string,
  _modelDir?: string,
): Promise<{ rig: Rig; idleClip: AnimationClip }> {
  const imageData = await loadImageData(imagePath)
  const imageDir = imagePath.replace(/\/[^/]+$/, '')
  const outputDir = imageDir + '/parts'

  // 1. Detect keypoints
  const keypoints = await detectKeypoints(imageData)

  // 2. Segment character into parts using keypoint geometry + alpha channel
  // Parts overlap intentionally (Live2D style) — draw order handles compositing
  const masks = segmentByKeypoints(imageData, keypoints)

  // 3. Export part textures as PNGs (each part is its full region, no holes)
  const textureInfos = await exportPartTextures(imageData, masks, outputDir)

  // 4. Generate meshes per part
  const meshes = new Map<string, Mesh>()
  for (const [partName, mask] of masks) {
    const info = textureInfos.get(partName)
    if (!info) continue
    const bbox = getMaskBbox(mask)
    if (!bbox) continue
    const textureBbox: MeshBBox = { x: bbox.x, y: bbox.y, w: bbox.w, h: bbox.h }
    try {
      const mesh = generateMesh(mask, textureBbox)
      meshes.set(partName, mesh)
    } catch {
      // Skip parts with untraceable contours (too small, etc.)
      console.warn(`Skipping mesh generation for part "${partName}"`)
    }
  }

  if (meshes.size === 0) {
    throw new Error('No parts could be meshed — segmentation may have failed')
  }

  // 5. Build hierarchy and apply rules
  const partNames = [...meshes.keys()]
  const hierarchy = buildHierarchy(partNames, keypoints)
  const { parameters, deformers } = applyRules(hierarchy, keypoints, meshes, RIG_RULES)

  // 6. Generate keyframe data
  const _keyframeData = generateKeyframes(parameters, meshes, deformers)

  // 7. Add physics for hair/cloth parts
  const { physics, physicsParams } = addPhysics(partNames, keypoints)
  const allParameters = [...parameters, ...physicsParams]

  // 8. Generate idle animation
  const idleClip = generateIdle(allParameters)

  // 9. Assemble the Rig
  // Draw order: back-to-front, matching Live2D layering.
  // Body at back, face on top, detail parts (eyes, mouth, nose) on top of face.
  const DRAW_ORDER: Record<string, number> = {
    body: 0,
    arm_upper_left: 1,
    arm_upper_right: 2,
    face: 10,
    ear_left: 11,
    ear_right: 12,
    nose: 20,
    eye_left: 21,
    eye_right: 22,
    mouth: 23,
    hair: 30,
  }

  const parts: Part[] = []
  for (const [partName, mesh] of meshes) {
    const info = textureInfos.get(partName)
    const texturePath = info ? info.path : `${outputDir}/${partName}.png`
    const partDeformers = deformers.get(partName) ?? []
    parts.push({
      id: partName,
      zIndex: DRAW_ORDER[partName] ?? 15,
      texture: texturePath,
      mesh,
      deformers: partDeformers,
    })
  }

  // Sort by draw order so rendering is back-to-front
  parts.sort((a, b) => a.zIndex - b.zIndex)

  const rig: Rig = {
    version: '1.0',
    canvas: {
      width: imageData.width,
      height: imageData.height,
    },
    parts,
    parameters: allParameters,
    physics,
  }

  return { rig, idleClip }
}
