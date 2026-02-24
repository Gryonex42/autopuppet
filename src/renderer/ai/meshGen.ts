/**
 * Mesh Generation
 *
 * Converts binary masks into triangle meshes suitable for deformation.
 * Pipeline: extractContour → simplifyContour → sampleInterior → triangulate → computeUVs → validateMesh
 */

import Delaunator from 'delaunator'
import type { Mesh } from '../engine/rig'

/** Bounding box used for UV computation and texture mapping */
export interface BBox {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Create an ImageData-like object. Works in both browser and Node test environment.
 */
function createImageData(width: number, height: number): ImageData {
  if (typeof ImageData !== 'undefined') {
    return new ImageData(width, height)
  }
  return {
    data: new Uint8ClampedArray(width * height * 4),
    width,
    height,
    colorSpace: 'srgb',
  } as ImageData
}

/** Alpha threshold for considering a pixel "solid" */
const ALPHA_THRESHOLD = 128

/**
 * Extract the outer boundary contour of a binary mask using marching squares.
 * Walks the alpha boundary to produce an ordered list of boundary points.
 *
 * The algorithm:
 * 1. Build a binary grid from the alpha channel (1 = solid, 0 = empty)
 * 2. Find a starting boundary pixel
 * 3. Trace the boundary using marching squares case lookup
 */
export function extractContour(mask: ImageData): [number, number][] {
  const { data, width, height } = mask

  // Build binary grid: true = solid (alpha >= threshold)
  const solid = new Uint8Array(width * height)
  for (let i = 0; i < width * height; i++) {
    solid[i] = data[i * 4 + 3] >= ALPHA_THRESHOLD ? 1 : 0
  }

  // Helper to read solid value, treating out-of-bounds as 0
  function isSolid(x: number, y: number): number {
    if (x < 0 || x >= width || y < 0 || y >= height) return 0
    return solid[y * width + x]
  }

  // Find the first solid pixel on a boundary (has at least one empty neighbor)
  let startX = -1
  let startY = -1
  outer: for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (isSolid(x, y) && (
        !isSolid(x - 1, y) || !isSolid(x + 1, y) ||
        !isSolid(x, y - 1) || !isSolid(x, y + 1)
      )) {
        startX = x
        startY = y
        break outer
      }
    }
  }

  if (startX === -1) return []

  // Marching squares contour tracing.
  // We treat the grid of 2x2 cells where each cell corner samples the binary grid.
  // The "cell" at (cx, cy) has corners:
  //   TL = solid[cy-1][cx-1], TR = solid[cy-1][cx]
  //   BL = solid[cy][cx-1],   BR = solid[cy][cx]
  // We walk edges between solid and empty regions.

  const contour: [number, number][] = []
  const visited = new Set<string>()

  // Use a simplified boundary walk: trace the outline by following boundary pixels
  // using Moore neighborhood tracing (more robust than pure marching squares for
  // raster masks with irregular shapes).

  // Direction vectors for 8-connected neighbors (clockwise from right)
  const dx = [1, 1, 0, -1, -1, -1, 0, 1]
  const dy = [0, 1, 1, 1, 0, -1, -1, -1]

  let cx = startX
  let cy = startY
  let dir = 7 // Start looking from the direction we came from (up-right)

  const maxSteps = width * height * 2 // Safety limit
  let steps = 0

  do {
    const key = `${cx},${cy}`
    if (!visited.has(key)) {
      contour.push([cx, cy])
      visited.add(key)
    }

    // Find next boundary pixel: scan clockwise from (dir + 5) % 8
    // This is Moore neighbor tracing: backtrack direction then scan clockwise
    let searchDir = (dir + 5) % 8
    let found = false

    for (let i = 0; i < 8; i++) {
      const nd = (searchDir + i) % 8
      const nx = cx + dx[nd]
      const ny = cy + dy[nd]

      if (isSolid(nx, ny)) {
        cx = nx
        cy = ny
        dir = nd
        found = true
        break
      }
    }

    if (!found) break
    steps++
  } while ((cx !== startX || cy !== startY) && steps < maxSteps)

  return contour
}

// --- 9.3: Douglas-Peucker polyline simplification ---

/**
 * Perpendicular distance from point P to the line segment AB.
 */
function pointToSegmentDist(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) {
    // A and B are the same point
    const ex = p[0] - a[0]
    const ey = p[1] - a[1]
    return Math.sqrt(ex * ex + ey * ey)
  }
  // Project P onto AB, clamped to [0, 1]
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq))
  const projX = a[0] + t * dx
  const projY = a[1] + t * dy
  const ex = p[0] - projX
  const ey = p[1] - projY
  return Math.sqrt(ex * ex + ey * ey)
}

/**
 * Douglas-Peucker polyline simplification.
 * Reduces vertex count while preserving shape within `epsilon` tolerance.
 */
export function simplifyContour(contour: [number, number][], epsilon: number): [number, number][] {
  if (contour.length <= 2) return contour.slice()

  // Find the point with maximum distance from the line between first and last
  let maxDist = 0
  let maxIdx = 0
  const first = contour[0]
  const last = contour[contour.length - 1]

  for (let i = 1; i < contour.length - 1; i++) {
    const d = pointToSegmentDist(contour[i], first, last)
    if (d > maxDist) {
      maxDist = d
      maxIdx = i
    }
  }

  if (maxDist > epsilon) {
    // Recurse on both halves
    const left = simplifyContour(contour.slice(0, maxIdx + 1), epsilon)
    const right = simplifyContour(contour.slice(maxIdx), epsilon)
    // Join, removing duplicate at the split point
    return left.slice(0, -1).concat(right)
  }

  // All points within tolerance — keep only endpoints
  return [first, last]
}

// --- 9.4: Poisson disk sampling of interior points ---

/**
 * Poisson disk sampling inside a mask region.
 * Applies 2× density near boundaries (within `boundaryWidth` pixels of contour).
 */
export function sampleInterior(mask: ImageData, density: number, contourPts?: [number, number][]): [number, number][] {
  const { data, width, height } = mask

  // Build solid grid
  const solid = new Uint8Array(width * height)
  for (let i = 0; i < width * height; i++) {
    solid[i] = data[i * 4 + 3] >= ALPHA_THRESHOLD ? 1 : 0
  }

  // Compute distance-to-boundary grid for adaptive density.
  // A pixel is "near boundary" if any of its 4-neighbors is non-solid.
  const boundaryWidth = Math.max(5, Math.round(Math.min(width, height) * 0.05))
  const nearBoundary = new Uint8Array(width * height)

  if (contourPts && contourPts.length > 0) {
    // Mark boundary region from contour points
    for (const [cx, cy] of contourPts) {
      for (let dy = -boundaryWidth; dy <= boundaryWidth; dy++) {
        for (let dx = -boundaryWidth; dx <= boundaryWidth; dx++) {
          const nx = cx + dx
          const ny = cy + dy
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            if (dx * dx + dy * dy <= boundaryWidth * boundaryWidth) {
              nearBoundary[ny * width + nx] = 1
            }
          }
        }
      }
    }
  } else {
    // Fallback: mark pixels adjacent to boundary
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!solid[y * width + x]) continue
        const idx = y * width + x
        if (
          x === 0 || x === width - 1 || y === 0 || y === height - 1 ||
          !solid[idx - 1] || !solid[idx + 1] ||
          !solid[idx - width] || !solid[idx + width]
        ) {
          // Flood nearby pixels as near-boundary
          for (let dy = -boundaryWidth; dy <= boundaryWidth; dy++) {
            for (let dx = -boundaryWidth; dx <= boundaryWidth; dx++) {
              const nx = x + dx
              const ny = y + dy
              if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                if (dx * dx + dy * dy <= boundaryWidth * boundaryWidth) {
                  nearBoundary[ny * width + nx] = 1
                }
              }
            }
          }
        }
      }
    }
  }

  // Poisson disk sampling via a simple grid-accelerated dart-throwing approach.
  // `density` is the approximate spacing between samples in pixels.
  const points: [number, number][] = []
  const cellSize = density / Math.SQRT2
  const gridW = Math.ceil(width / cellSize)
  const gridH = Math.ceil(height / cellSize)
  const grid = new Int32Array(gridW * gridH).fill(-1)

  // Seed the RNG for reproducibility (simple LCG)
  let seed = 42
  function rand(): number {
    seed = (seed * 1664525 + 1013904223) & 0x7fffffff
    return seed / 0x7fffffff
  }

  function addPoint(x: number, y: number): boolean {
    const gi = Math.floor(x / cellSize)
    const gj = Math.floor(y / cellSize)

    // Check nearby grid cells for distance conflicts
    const minDist = nearBoundary[Math.floor(y) * width + Math.floor(x)]
      ? density * 0.5  // 2× density near boundary
      : density
    const minDistSq = minDist * minDist

    const searchRadius = 2
    for (let dj = -searchRadius; dj <= searchRadius; dj++) {
      for (let di = -searchRadius; di <= searchRadius; di++) {
        const ni = gi + di
        const nj = gj + dj
        if (ni < 0 || ni >= gridW || nj < 0 || nj >= gridH) continue
        const pidx = grid[nj * gridW + ni]
        if (pidx === -1) continue
        const px = points[pidx][0]
        const py = points[pidx][1]
        const ddx = x - px
        const ddy = y - py
        if (ddx * ddx + ddy * ddy < minDistSq) return false
      }
    }

    const idx = points.length
    points.push([x, y])
    grid[gj * gridW + gi] = idx
    return true
  }

  // Generate candidate points using stratified sampling with jitter
  const step = density * 0.5
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const jx = x + (rand() - 0.5) * step
      const jy = y + (rand() - 0.5) * step
      const ix = Math.floor(jx)
      const iy = Math.floor(jy)
      if (ix < 0 || ix >= width || iy < 0 || iy >= height) continue
      if (!solid[iy * width + ix]) continue
      addPoint(jx, jy)
    }
  }

  return points
}

// --- 9.5: Delaunay triangulation ---

/**
 * Combine boundary and interior points, run Delaunator, discard triangles
 * whose centroid falls outside the mask.
 */
export function triangulate(
  boundaryPts: [number, number][],
  interiorPts: [number, number][],
  mask?: ImageData
): { vertices: [number, number][]; triangles: [number, number, number][] } {
  const allPts = boundaryPts.concat(interiorPts)

  if (allPts.length < 3) {
    return { vertices: allPts, triangles: [] }
  }

  // Build flat coordinate array for Delaunator
  const coords = new Float64Array(allPts.length * 2)
  for (let i = 0; i < allPts.length; i++) {
    coords[i * 2] = allPts[i][0]
    coords[i * 2 + 1] = allPts[i][1]
  }

  const delaunay = new Delaunator(coords)
  const rawTris = delaunay.triangles

  const triangles: [number, number, number][] = []

  // If we have a mask, discard triangles whose centroid is outside the mask
  let solid: Uint8Array | null = null
  let maskW = 0
  let maskH = 0
  if (mask) {
    maskW = mask.width
    maskH = mask.height
    solid = new Uint8Array(maskW * maskH)
    for (let i = 0; i < maskW * maskH; i++) {
      solid[i] = mask.data[i * 4 + 3] >= ALPHA_THRESHOLD ? 1 : 0
    }
  }

  for (let i = 0; i < rawTris.length; i += 3) {
    const a = rawTris[i]
    const b = rawTris[i + 1]
    const c = rawTris[i + 2]

    if (solid) {
      // Centroid test
      const cx = (allPts[a][0] + allPts[b][0] + allPts[c][0]) / 3
      const cy = (allPts[a][1] + allPts[b][1] + allPts[c][1]) / 3
      const ix = Math.floor(cx)
      const iy = Math.floor(cy)
      if (ix < 0 || ix >= maskW || iy < 0 || iy >= maskH) continue
      if (!solid[iy * maskW + ix]) continue
    }

    triangles.push([a, b, c])
  }

  return { vertices: allPts, triangles }
}

// --- 9.6: UV computation ---

/**
 * Normalize vertex positions relative to a texture bounding box to produce
 * UV coordinates in [0, 1] range.
 */
export function computeUVs(
  vertices: [number, number][],
  textureBbox: BBox
): [number, number][] {
  const { x, y, w, h } = textureBbox
  return vertices.map(([vx, vy]) => [
    Math.max(0, Math.min(1, (vx - x) / w)),
    Math.max(0, Math.min(1, (vy - y) / h)),
  ] as [number, number])
}

// --- 9.7: Mesh validation ---

/** Validation result for a generated mesh */
export interface MeshValidation {
  valid: boolean
  errors: string[]
}

/** Minimum acceptable vertex count */
const MIN_VERTICES = 50
/** Maximum acceptable vertex count */
const MAX_VERTICES = 500
/** Maximum acceptable triangle aspect ratio (longest edge / shortest edge) */
const MAX_ASPECT_RATIO = 10

/**
 * Validate a generated mesh for quality constraints.
 * Checks vertex count, degenerate triangles, and bounds.
 */
export function validateMesh(mesh: Mesh): MeshValidation {
  const errors: string[] = []
  const { vertices, triangles, uvs } = mesh

  // Vertex count check
  if (vertices.length < MIN_VERTICES) {
    errors.push(`Too few vertices: ${vertices.length} (minimum ${MIN_VERTICES})`)
  }
  if (vertices.length > MAX_VERTICES) {
    errors.push(`Too many vertices: ${vertices.length} (maximum ${MAX_VERTICES})`)
  }

  // Check for degenerate triangles
  let degenerateCount = 0
  for (let i = 0; i < triangles.length; i++) {
    const [ai, bi, ci] = triangles[i]

    // Bounds check
    if (ai >= vertices.length || bi >= vertices.length || ci >= vertices.length) {
      errors.push(`Triangle[${i}] has index out of bounds`)
      continue
    }

    const a = vertices[ai]
    const b = vertices[bi]
    const c = vertices[ci]

    // Edge lengths
    const ab = Math.sqrt((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2)
    const bc = Math.sqrt((c[0] - b[0]) ** 2 + (c[1] - b[1]) ** 2)
    const ca = Math.sqrt((a[0] - c[0]) ** 2 + (a[1] - c[1]) ** 2)

    const longest = Math.max(ab, bc, ca)
    const shortest = Math.min(ab, bc, ca)

    if (shortest < 1e-6) {
      degenerateCount++
      continue
    }

    if (longest / shortest > MAX_ASPECT_RATIO) {
      degenerateCount++
    }
  }

  if (degenerateCount > 0) {
    errors.push(`${degenerateCount} degenerate triangle(s) (aspect ratio > ${MAX_ASPECT_RATIO} or zero-length edge)`)
  }

  // Check UVs are in [0, 1]
  let uvOutOfRange = 0
  for (const [u, v] of uvs) {
    if (u < -0.01 || u > 1.01 || v < -0.01 || v > 1.01) {
      uvOutOfRange++
    }
  }
  if (uvOutOfRange > 0) {
    errors.push(`${uvOutOfRange} UV coordinate(s) outside [0, 1] range`)
  }

  return { valid: errors.length === 0, errors }
}

// --- 9.8: generateMesh orchestrator ---

/** Default contour simplification epsilon */
const DEFAULT_EPSILON = 2.0
/** Default interior sampling density (pixels between samples) */
const DEFAULT_DENSITY = 8

/**
 * Generate a complete mesh from a binary mask.
 * Runs the full pipeline: extractContour → simplifyContour → sampleInterior →
 * triangulate → computeUVs → validateMesh.
 * Automatically adjusts density if validation fails.
 */
export function generateMesh(mask: ImageData, textureBbox: BBox): Mesh {
  const contour = extractContour(mask)
  if (contour.length < 3) {
    throw new Error('Mask contains no traceable contour (fewer than 3 boundary points)')
  }

  const simplified = simplifyContour(contour, DEFAULT_EPSILON)

  // Try with default density first, then adjust if validation fails
  let density = DEFAULT_DENSITY
  let mesh: Mesh | null = null

  for (let attempt = 0; attempt < 3; attempt++) {
    const interior = sampleInterior(mask, density, simplified)
    const { vertices, triangles } = triangulate(simplified, interior, mask)
    const uvs = computeUVs(vertices, textureBbox)

    mesh = { vertices, uvs, triangles }
    const validation = validateMesh(mesh)

    if (validation.valid) return mesh

    // Adjust density based on error type
    const tooFew = validation.errors.some(e => e.includes('Too few'))
    const tooMany = validation.errors.some(e => e.includes('Too many'))

    if (tooFew) {
      density = Math.max(2, density * 0.6) // Increase sample density
    } else if (tooMany) {
      density = density * 1.5 // Decrease sample density
    } else {
      break // Non-density-related errors, stop trying
    }
  }

  // Return whatever we have — caller can check validateMesh themselves
  return mesh!
}
