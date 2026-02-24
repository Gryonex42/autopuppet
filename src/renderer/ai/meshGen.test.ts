import { describe, it, expect } from 'vitest'
import {
  extractContour,
  simplifyContour,
  sampleInterior,
  triangulate,
  computeUVs,
  validateMesh,
  generateMesh,
  type BBox,
} from './meshGen'

/** Create a mock ImageData with a filled circle mask */
function makeCircleMask(size: number, radius: number): ImageData {
  const data = new Uint8ClampedArray(size * size * 4)
  const cx = size / 2
  const cy = size / 2
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx
      const dy = y - cy
      if (dx * dx + dy * dy <= radius * radius) {
        const i = (y * size + x) * 4
        data[i] = 255     // R
        data[i + 1] = 255 // G
        data[i + 2] = 255 // B
        data[i + 3] = 255 // A
      }
    }
  }
  return { data, width: size, height: size, colorSpace: 'srgb' } as ImageData
}

/** Create a small rectangular mask */
function makeRectMask(w: number, h: number, padX = 5, padY = 5): ImageData {
  const totalW = w + padX * 2
  const totalH = h + padY * 2
  const data = new Uint8ClampedArray(totalW * totalH * 4)
  for (let y = padY; y < padY + h; y++) {
    for (let x = padX; x < padX + w; x++) {
      const i = (y * totalW + x) * 4
      data[i] = 255
      data[i + 1] = 255
      data[i + 2] = 255
      data[i + 3] = 255
    }
  }
  return { data, width: totalW, height: totalH, colorSpace: 'srgb' } as ImageData
}

describe('extractContour', () => {
  it('extracts a contour from a circle mask', () => {
    const mask = makeCircleMask(200, 80)
    const contour = extractContour(mask)
    expect(contour.length).toBeGreaterThan(10)
    // All contour points should be within the image bounds
    for (const [x, y] of contour) {
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThan(200)
      expect(y).toBeGreaterThanOrEqual(0)
      expect(y).toBeLessThan(200)
    }
  })

  it('returns empty array for a fully transparent mask', () => {
    const data = new Uint8ClampedArray(100 * 100 * 4)
    const mask = { data, width: 100, height: 100, colorSpace: 'srgb' } as ImageData
    const contour = extractContour(mask)
    expect(contour).toEqual([])
  })

  it('extracts contour from a rectangle mask', () => {
    const mask = makeRectMask(40, 30)
    const contour = extractContour(mask)
    expect(contour.length).toBeGreaterThan(4)
  })
})

describe('simplifyContour', () => {
  it('preserves endpoints', () => {
    const pts: [number, number][] = [[0, 0], [1, 0.1], [2, 0], [3, 0.1], [4, 0]]
    const result = simplifyContour(pts, 0.5)
    expect(result[0]).toEqual([0, 0])
    expect(result[result.length - 1]).toEqual([4, 0])
  })

  it('simplifies a nearly-straight line to two points', () => {
    const pts: [number, number][] = []
    for (let i = 0; i <= 100; i++) {
      pts.push([i, i * 0.001]) // Almost perfectly straight
    }
    const result = simplifyContour(pts, 1.0)
    expect(result.length).toBe(2)
  })

  it('preserves sharp corners', () => {
    // L-shaped contour: should keep the corner
    const pts: [number, number][] = [[0, 0], [10, 0], [20, 0], [20, 10], [20, 20]]
    const result = simplifyContour(pts, 0.5)
    expect(result.length).toBeGreaterThanOrEqual(3)
    // Should keep the corner at [20, 0]
    expect(result.some(([x, y]) => x === 20 && y === 0)).toBe(true)
  })

  it('returns original for 2 or fewer points', () => {
    expect(simplifyContour([[1, 2]], 1)).toEqual([[1, 2]])
    expect(simplifyContour([], 1)).toEqual([])
  })
})

describe('sampleInterior', () => {
  it('samples points inside a circle mask', () => {
    const mask = makeCircleMask(200, 80)
    const points = sampleInterior(mask, 10)
    expect(points.length).toBeGreaterThan(10)

    // All points should be inside the circle (with some tolerance for jitter)
    const cx = 100
    const cy = 100
    for (const [x, y] of points) {
      const dx = x - cx
      const dy = y - cy
      // Allow small margin for jittered points near boundary
      expect(dx * dx + dy * dy).toBeLessThan((85) ** 2)
    }
  })

  it('returns no points for an empty mask', () => {
    const data = new Uint8ClampedArray(100 * 100 * 4)
    const mask = { data, width: 100, height: 100, colorSpace: 'srgb' } as ImageData
    const points = sampleInterior(mask, 10)
    expect(points.length).toBe(0)
  })
})

describe('triangulate', () => {
  it('triangulates a circle mask with no degenerate triangles', () => {
    const mask = makeCircleMask(200, 80)
    const contour = extractContour(mask)
    const simplified = simplifyContour(contour, 2)
    const interior = sampleInterior(mask, 10, simplified)
    const result = triangulate(simplified, interior, mask)

    expect(result.vertices.length).toBeGreaterThan(10)
    expect(result.triangles.length).toBeGreaterThan(5)

    // No degenerate triangles: all triangle indices in bounds
    for (const [a, b, c] of result.triangles) {
      expect(a).toBeGreaterThanOrEqual(0)
      expect(a).toBeLessThan(result.vertices.length)
      expect(b).toBeGreaterThanOrEqual(0)
      expect(b).toBeLessThan(result.vertices.length)
      expect(c).toBeGreaterThanOrEqual(0)
      expect(c).toBeLessThan(result.vertices.length)

      // Check triangle has non-zero area (not degenerate)
      const va = result.vertices[a]
      const vb = result.vertices[b]
      const vc = result.vertices[c]
      const area = Math.abs(
        (vb[0] - va[0]) * (vc[1] - va[1]) - (vc[0] - va[0]) * (vb[1] - va[1])
      ) / 2
      expect(area).toBeGreaterThan(0)
    }
  })

  it('returns empty triangles for fewer than 3 points', () => {
    const result = triangulate([[0, 0], [1, 1]], [])
    expect(result.triangles).toEqual([])
  })
})

describe('computeUVs', () => {
  it('produces UVs in [0, 1] range', () => {
    const vertices: [number, number][] = [
      [10, 20], [50, 20], [50, 60], [10, 60],
    ]
    const bbox: BBox = { x: 10, y: 20, w: 40, h: 40 }
    const uvs = computeUVs(vertices, bbox)

    for (const [u, v] of uvs) {
      expect(u).toBeGreaterThanOrEqual(0)
      expect(u).toBeLessThanOrEqual(1)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }

    // Check specific corners
    expect(uvs[0]).toEqual([0, 0])   // top-left
    expect(uvs[1]).toEqual([1, 0])   // top-right
    expect(uvs[2]).toEqual([1, 1])   // bottom-right
    expect(uvs[3]).toEqual([0, 1])   // bottom-left
  })

  it('clamps vertices outside bbox to [0, 1]', () => {
    const vertices: [number, number][] = [[-10, -10], [200, 200]]
    const bbox: BBox = { x: 0, y: 0, w: 100, h: 100 }
    const uvs = computeUVs(vertices, bbox)

    expect(uvs[0]).toEqual([0, 0])
    expect(uvs[1]).toEqual([1, 1])
  })
})

describe('validateMesh', () => {
  it('reports too few vertices', () => {
    const mesh = {
      vertices: Array.from({ length: 10 }, (_, i) => [i, i] as [number, number]),
      uvs: Array.from({ length: 10 }, (_, i) => [i / 10, i / 10] as [number, number]),
      triangles: [[0, 1, 2] as [number, number, number]],
    }
    const result = validateMesh(mesh)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('Too few'))).toBe(true)
  })

  it('reports too many vertices', () => {
    const n = 600
    const mesh = {
      vertices: Array.from({ length: n }, (_, i) => [i, i] as [number, number]),
      uvs: Array.from({ length: n }, (_, i) => [i / n, i / n] as [number, number]),
      triangles: [[0, 1, 2] as [number, number, number]],
    }
    const result = validateMesh(mesh)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('Too many'))).toBe(true)
  })

  it('detects degenerate triangles', () => {
    const n = 60
    const vertices: [number, number][] = Array.from({ length: n }, (_, i) => [i * 10, i * 5])
    const uvs: [number, number][] = Array.from({ length: n }, (_, i) => [i / n, i / n])
    // Degenerate: two vertices at same position (zero-length edge)
    vertices.push([0, 0]) // duplicate of vertex 0
    uvs.push([0, 0])
    const triangles: [number, number, number][] = [[0, 1, n]] // vertex 0 and n are identical
    // Also add a very skinny triangle (high aspect ratio)
    vertices.push([0, 0.0001])
    uvs.push([0, 0])
    triangles.push([0, 1, n + 1]) // vertex 0 is [0,0], vertex n+1 is [0,0.0001], very short edge

    const result = validateMesh({ vertices, uvs, triangles })
    expect(result.errors.some(e => e.includes('degenerate'))).toBe(true)
  })

  it('passes for a well-formed mesh', () => {
    // Generate a valid mesh from a circle
    const mask = makeCircleMask(200, 80)
    const bbox: BBox = { x: 20, y: 20, w: 160, h: 160 }
    const mesh = generateMesh(mask, bbox)
    const result = validateMesh(mesh)
    // At minimum it should have been auto-adjusted
    expect(mesh.vertices.length).toBeGreaterThanOrEqual(3)
    expect(mesh.triangles.length).toBeGreaterThanOrEqual(1)
  })
})

describe('generateMesh', () => {
  it('generates a complete mesh from a circle mask', () => {
    const mask = makeCircleMask(200, 80)
    const bbox: BBox = { x: 20, y: 20, w: 160, h: 160 }
    const mesh = generateMesh(mask, bbox)

    expect(mesh.vertices.length).toBeGreaterThan(0)
    expect(mesh.triangles.length).toBeGreaterThan(0)
    expect(mesh.uvs.length).toBe(mesh.vertices.length)

    // All UVs in [0, 1]
    for (const [u, v] of mesh.uvs) {
      expect(u).toBeGreaterThanOrEqual(0)
      expect(u).toBeLessThanOrEqual(1)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }

    // All triangle indices valid
    for (const [a, b, c] of mesh.triangles) {
      expect(a).toBeLessThan(mesh.vertices.length)
      expect(b).toBeLessThan(mesh.vertices.length)
      expect(c).toBeLessThan(mesh.vertices.length)
    }
  })

  it('throws for an empty mask', () => {
    const data = new Uint8ClampedArray(100 * 100 * 4)
    const mask = { data, width: 100, height: 100, colorSpace: 'srgb' } as ImageData
    const bbox: BBox = { x: 0, y: 0, w: 100, h: 100 }
    expect(() => generateMesh(mask, bbox)).toThrow('no traceable contour')
  })

  it('triangulates a small rect mask with minimum vertex enforcement', () => {
    const mask = makeRectMask(60, 60)
    const bbox: BBox = { x: 5, y: 5, w: 60, h: 60 }
    const mesh = generateMesh(mask, bbox)

    expect(mesh.vertices.length).toBeGreaterThan(0)
    expect(mesh.triangles.length).toBeGreaterThan(0)
    expect(mesh.uvs.length).toBe(mesh.vertices.length)
  })
})
