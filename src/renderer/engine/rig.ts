import { z } from 'zod'

// --- Shared primitives ---

const Point2D = z.tuple([z.number(), z.number()])
const TriangleIndices = z.tuple([z.int().nonnegative(), z.int().nonnegative(), z.int().nonnegative()])

// --- Mesh ---

export const MeshSchema = z.object({
  vertices: z.array(Point2D).min(3),
  uvs: z.array(Point2D).min(3),
  triangles: z.array(TriangleIndices).min(1),
})

// --- Deformers ---

const WarpMode = z.enum(['squeeze_center', 'stretch_bottom', 'curve_ends_up', 'scale_y'])

const WarpDeformerSchema = z.object({
  type: z.literal('warp'),
  paramBinding: z.string(),
  gridSize: z.tuple([z.int().positive(), z.int().positive()]),
  bbox: z.object({
    x: z.number(),
    y: z.number(),
    w: z.number().positive(),
    h: z.number().positive(),
  }),
  mode: WarpMode,
})

const RotateDeformerSchema = z.object({
  type: z.literal('rotate'),
  paramBinding: z.string(),
  origin: Point2D,
  childrenFollow: z.boolean(),
})

export const DeformerSchema = z.discriminatedUnion('type', [
  WarpDeformerSchema,
  RotateDeformerSchema,
])

// --- Part ---

export const PartSchema = z.object({
  id: z.string().min(1),
  zIndex: z.number(),
  texture: z.string().min(1),
  mesh: MeshSchema,
  deformers: z.array(DeformerSchema),
})

// --- Parameter ---

export const ParameterSchema = z.object({
  id: z.string().min(1),
  range: z.tuple([z.number(), z.number()]),
  default: z.number(),
  keys: z.array(z.number()),
})

// --- Physics ---

export const PhysicsSchema = z.object({
  target: z.string().min(1),
  type: z.enum(['pendulum']),
  length: z.number().positive(),
  damping: z.number().min(0).max(1),
  paramBinding: z.string().min(1),
})

// --- Rig (top-level) ---

export const RigSchema = z.object({
  version: z.string(),
  canvas: z.object({
    width: z.int().positive(),
    height: z.int().positive(),
  }),
  parts: z.array(PartSchema).min(1),
  parameters: z.array(ParameterSchema),
  physics: z.array(PhysicsSchema),
})

// --- Inferred types ---

export type Mesh = z.infer<typeof MeshSchema>
export type WarpDeformer = z.infer<typeof WarpDeformerSchema>
export type RotateDeformer = z.infer<typeof RotateDeformerSchema>
export type Deformer = z.infer<typeof DeformerSchema>
export type Part = z.infer<typeof PartSchema>
export type Parameter = z.infer<typeof ParameterSchema>
export type Physics = z.infer<typeof PhysicsSchema>
export type Rig = z.infer<typeof RigSchema>

// --- Cross-field validation ---

function validateRig(rig: Rig): void {
  const paramIds = new Set(rig.parameters.map(p => p.id))

  for (const part of rig.parts) {
    const { vertices, uvs, triangles } = part.mesh

    if (vertices.length !== uvs.length) {
      throw new Error(
        `Part "${part.id}": vertex count (${vertices.length}) does not match UV count (${uvs.length})`
      )
    }

    for (let i = 0; i < triangles.length; i++) {
      const tri = triangles[i]
      for (const idx of tri) {
        if (idx >= vertices.length) {
          throw new Error(
            `Part "${part.id}": triangle[${i}] index ${idx} out of bounds (${vertices.length} vertices)`
          )
        }
      }
    }

    for (const deformer of part.deformers) {
      if (!paramIds.has(deformer.paramBinding)) {
        throw new Error(
          `Part "${part.id}": deformer references unknown parameter "${deformer.paramBinding}"`
        )
      }
    }
  }

  for (const physics of rig.physics) {
    if (!paramIds.has(physics.paramBinding)) {
      throw new Error(
        `Physics entry for "${physics.target}": references unknown parameter "${physics.paramBinding}"`
      )
    }
  }
}

// --- Load / Save ---

export function loadRig(jsonString: string): Rig {
  let raw: unknown
  try {
    raw = JSON.parse(jsonString)
  } catch (e) {
    throw new Error(`Invalid JSON: ${(e as Error).message}`)
  }

  const result = RigSchema.safeParse(raw)
  if (!result.success) {
    const issues = result.error.issues
      .map(i => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n')
    throw new Error(`Rig validation failed:\n${issues}`)
  }

  const rig = result.data
  validateRig(rig)
  return rig
}

export function saveRig(rig: Rig): string {
  return JSON.stringify(rig, null, 2)
}
