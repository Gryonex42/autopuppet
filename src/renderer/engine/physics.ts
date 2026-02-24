import type { Physics } from './rig'

// --- PhysicsChain: Verlet integration pendulum ---

export class PhysicsChain {
  /** Number of point masses in the chain. */
  readonly segments: number
  /** Rest distance between adjacent points. */
  readonly segmentLength: number
  /** Velocity damping factor per step (0 = full damping, 1 = none). */
  readonly damping: number
  /** Gravity vector [gx, gy] in pixels/s². */
  readonly gravity: [number, number]

  /** Current positions: [x0, y0, x1, y1, ...]. Length = (segments + 1) * 2. */
  points: Float64Array
  /** Positions from the previous step (for Verlet velocity). */
  oldPoints: Float64Array

  constructor(
    anchor: [number, number],
    length: number,
    segments: number,
    damping: number,
    gravity: [number, number] = [0, 200],
  ) {
    this.segments = segments
    this.segmentLength = length / segments
    this.damping = damping
    this.gravity = gravity

    const count = segments + 1
    this.points = new Float64Array(count * 2)
    this.oldPoints = new Float64Array(count * 2)

    // Initialize chain as a straight vertical line hanging from anchor
    for (let i = 0; i < count; i++) {
      const x = anchor[0]
      const y = anchor[1] + i * this.segmentLength
      this.points[i * 2] = x
      this.points[i * 2 + 1] = y
      this.oldPoints[i * 2] = x
      this.oldPoints[i * 2 + 1] = y
    }
  }

  /**
   * Advance the simulation by `dt` seconds.
   * Pins the first point to `anchorPos`, applies Verlet integration
   * with damping and gravity, then runs 5 iterations of distance constraints.
   */
  update(dt: number, anchorPos: [number, number]): void {
    const count = this.segments + 1
    const dt2 = dt * dt

    // Pin first point to anchor
    this.points[0] = anchorPos[0]
    this.points[1] = anchorPos[1]

    // Verlet integration for remaining points
    for (let i = 1; i < count; i++) {
      const ix = i * 2
      const iy = ix + 1

      const cx = this.points[ix]
      const cy = this.points[iy]
      const ox = this.oldPoints[ix]
      const oy = this.oldPoints[iy]

      // velocity = current - old, with damping
      const vx = (cx - ox) * this.damping
      const vy = (cy - oy) * this.damping

      // Save current as old before updating
      this.oldPoints[ix] = cx
      this.oldPoints[iy] = cy

      // New position = current + velocity + gravity * dt²
      this.points[ix] = cx + vx + this.gravity[0] * dt2
      this.points[iy] = cy + vy + this.gravity[1] * dt2
    }

    // Pin anchor again (old position tracks for next frame)
    this.oldPoints[0] = anchorPos[0]
    this.oldPoints[1] = anchorPos[1]

    // Satisfy distance constraints (5 iterations)
    for (let iter = 0; iter < 5; iter++) {
      for (let i = 0; i < this.segments; i++) {
        this.constrain(i, i + 1)
      }
    }
  }

  /**
   * Standard Verlet distance constraint between points i and j.
   * Pushes/pulls both points equally to maintain rest distance.
   * Point 0 (anchor) is not moved.
   */
  constrain(i: number, j: number): void {
    const ix = i * 2
    const iy = ix + 1
    const jx = j * 2
    const jy = jx + 1

    const dx = this.points[jx] - this.points[ix]
    const dy = this.points[jy] - this.points[iy]
    const dist = Math.sqrt(dx * dx + dy * dy)

    if (dist < 1e-10) return // avoid division by zero

    const diff = (dist - this.segmentLength) / dist
    const offsetX = dx * 0.5 * diff
    const offsetY = dy * 0.5 * diff

    // Don't move the anchor (point 0)
    if (i === 0) {
      this.points[jx] -= offsetX * 2
      this.points[jy] -= offsetY * 2
    } else if (j === 0) {
      this.points[ix] += offsetX * 2
      this.points[iy] += offsetY * 2
    } else {
      this.points[ix] += offsetX
      this.points[iy] += offsetY
      this.points[jx] -= offsetX
      this.points[jy] -= offsetY
    }
  }

  /**
   * Returns the angle (in degrees) of the chain direction,
   * measured as atan2(dx, dy) between the first and last points.
   * A vertical chain returns 0; swinging left returns negative, right positive.
   */
  getAngle(): number {
    const lastIdx = this.segments * 2
    const dx = this.points[lastIdx] - this.points[0]
    const dy = this.points[lastIdx + 1] - this.points[1]
    return Math.atan2(dx, dy) * (180 / Math.PI)
  }
}

// --- PhysicsEngine: manages multiple chains ---

export interface PhysicsChainBinding {
  chain: PhysicsChain
  paramBinding: string
  target: string
}

/**
 * Manages multiple PhysicsChain instances and maps their angles
 * back to rig parameters. Call `step()` each frame.
 */
export class PhysicsEngine {
  readonly chains: PhysicsChainBinding[] = []

  /**
   * Add a physics chain from a rig Physics config.
   * `anchorPos` is the initial anchor position (from keypoints/deformation state).
   */
  addChain(config: Physics, anchorPos: [number, number], segments = 5): void {
    const chain = new PhysicsChain(
      anchorPos,
      config.length,
      segments,
      config.damping,
    )
    this.chains.push({
      chain,
      paramBinding: config.paramBinding,
      target: config.target,
    })
  }

  /**
   * Step all chains forward by `dt` seconds.
   * `getAnchorPos` resolves the current anchor position for a given target part
   * (e.g., from the current rig deformation state).
   * Returns updated parameter values to feed back into the rig.
   */
  step(
    dt: number,
    getAnchorPos: (target: string) => [number, number],
  ): Record<string, number> {
    const paramValues: Record<string, number> = {}

    for (const binding of this.chains) {
      const anchor = getAnchorPos(binding.target)
      binding.chain.update(dt, anchor)
      paramValues[binding.paramBinding] = binding.chain.getAngle()
    }

    return paramValues
  }

  /** Remove all chains. */
  clear(): void {
    this.chains.length = 0
  }
}
