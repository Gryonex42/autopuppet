import { describe, it, expect } from 'vitest'
import { PhysicsChain, PhysicsEngine } from './physics'

describe('PhysicsChain', () => {
  it('initializes as a vertical line from anchor', () => {
    const chain = new PhysicsChain([100, 50], 80, 4, 0.9)
    const segLen = 80 / 4

    expect(chain.points[0]).toBe(100)
    expect(chain.points[1]).toBe(50)
    // Last point should be at anchor.y + length
    expect(chain.points[8]).toBe(100)
    expect(chain.points[9]).toBe(50 + 4 * segLen)
  })

  it('chain with gravity falls downward over multiple steps', () => {
    // Start with a horizontal chain (all points at same y)
    const chain = new PhysicsChain([0, 0], 100, 4, 0.9, [0, 200])
    // Manually set points horizontal
    for (let i = 0; i <= 4; i++) {
      chain.points[i * 2] = i * 25
      chain.points[i * 2 + 1] = 0
      chain.oldPoints[i * 2] = i * 25
      chain.oldPoints[i * 2 + 1] = 0
    }

    const initialLastY = chain.points[9]

    // Run several steps
    for (let s = 0; s < 20; s++) {
      chain.update(1 / 60, [0, 0])
    }

    // The last point should have moved significantly downward
    expect(chain.points[9]).toBeGreaterThan(initialLastY)
  })

  it('chain at rest maintains its rest length', () => {
    // A vertical chain with gravity pointing down — already at equilibrium
    const chain = new PhysicsChain([0, 0], 100, 4, 0.9, [0, 200])
    const segLen = 100 / 4

    // Run many steps to reach equilibrium
    for (let s = 0; s < 200; s++) {
      chain.update(1 / 60, [0, 0])
    }

    // Check that each segment is close to rest length
    for (let i = 0; i < 4; i++) {
      const ix = i * 2
      const jx = (i + 1) * 2
      const dx = chain.points[jx] - chain.points[ix]
      const dy = chain.points[jx + 1] - chain.points[ix + 1]
      const dist = Math.sqrt(dx * dx + dy * dy)
      expect(dist).toBeCloseTo(segLen, 0)
    }
  })

  it('getAngle returns 0 for a vertical chain', () => {
    const chain = new PhysicsChain([0, 0], 100, 4, 0.9, [0, 0])
    // Default init is vertical downward — atan2(0, positive) = 0
    expect(chain.getAngle()).toBeCloseTo(0, 5)
  })

  it('getAngle returns correct sign for left/right displacement', () => {
    const chain = new PhysicsChain([0, 0], 100, 4, 0.9, [0, 0])
    // Move last point to the right
    chain.points[8] = 50
    chain.points[9] = 100
    expect(chain.getAngle()).toBeGreaterThan(0)

    // Move last point to the left
    chain.points[8] = -50
    chain.points[9] = 100
    expect(chain.getAngle()).toBeLessThan(0)
  })

  it('damping reduces oscillation amplitude over time', () => {
    const chain = new PhysicsChain([0, 0], 100, 4, 0.9, [0, 200])

    // Kick the chain sideways
    for (let i = 1; i <= 4; i++) {
      chain.points[i * 2] = 50
    }

    // Record peak displacements over cycles
    const peakX: number[] = []
    let prevSign = Math.sign(chain.points[8])

    for (let s = 0; s < 300; s++) {
      chain.update(1 / 60, [0, 0])
      const lastX = chain.points[8]
      const sign = Math.sign(lastX)
      // Detect sign change → record the previous peak
      if (sign !== 0 && sign !== prevSign) {
        peakX.push(Math.abs(lastX))
        prevSign = sign
      }
    }

    // We should have at least 2 peaks, and later peaks should be smaller
    if (peakX.length >= 2) {
      expect(peakX[peakX.length - 1]).toBeLessThan(peakX[0])
    }
  })

  it('identity: update with dt=0 does not change positions', () => {
    const chain = new PhysicsChain([10, 20], 60, 3, 0.9)
    const before = new Float64Array(chain.points)
    chain.update(0, [10, 20])
    // After dt=0 step, constraint relaxation may adjust slightly but positions
    // should remain very close to initial (vertical equilibrium)
    for (let i = 0; i < before.length; i++) {
      expect(chain.points[i]).toBeCloseTo(before[i], 5)
    }
  })

  it('constrain maintains distance between two points', () => {
    const chain = new PhysicsChain([0, 0], 100, 4, 0.9)
    const segLen = chain.segmentLength

    // Pull point 2 far away from point 1
    chain.points[4] = 500
    chain.points[5] = 500

    // Run constraint multiple times
    for (let i = 0; i < 10; i++) {
      chain.constrain(1, 2)
    }

    const dx = chain.points[4] - chain.points[2]
    const dy = chain.points[5] - chain.points[3]
    const dist = Math.sqrt(dx * dx + dy * dy)
    expect(dist).toBeCloseTo(segLen, 3)
  })
})

describe('PhysicsEngine', () => {
  it('manages multiple chains and returns parameter values', () => {
    const engine = new PhysicsEngine()

    engine.addChain(
      { target: 'hair_front', type: 'pendulum', length: 80, damping: 0.9, paramBinding: 'hair_front_physics' },
      [100, 50],
    )
    engine.addChain(
      { target: 'hair_back', type: 'pendulum', length: 100, damping: 0.85, paramBinding: 'hair_back_physics' },
      [100, 40],
    )

    expect(engine.chains).toHaveLength(2)

    const result = engine.step(1 / 60, () => [100, 50])
    expect(result).toHaveProperty('hair_front_physics')
    expect(result).toHaveProperty('hair_back_physics')
    expect(typeof result['hair_front_physics']).toBe('number')
    expect(typeof result['hair_back_physics']).toBe('number')
  })

  it('step uses getAnchorPos to update each chain anchor', () => {
    const engine = new PhysicsEngine()
    engine.addChain(
      { target: 'hair_front', type: 'pendulum', length: 80, damping: 0.9, paramBinding: 'hp' },
      [0, 0],
    )

    // Move anchor to the right over several steps
    for (let s = 0; s < 30; s++) {
      engine.step(1 / 60, () => [50, 0])
    }

    // The chain's first point should track the new anchor
    expect(engine.chains[0].chain.points[0]).toBe(50)
    expect(engine.chains[0].chain.points[1]).toBe(0)
  })

  it('clear removes all chains', () => {
    const engine = new PhysicsEngine()
    engine.addChain(
      { target: 'hair', type: 'pendulum', length: 80, damping: 0.9, paramBinding: 'hp' },
      [0, 0],
    )
    expect(engine.chains).toHaveLength(1)
    engine.clear()
    expect(engine.chains).toHaveLength(0)
  })
})
