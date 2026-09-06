import { describe, expect, it } from 'vitest'
import { PERIOD_STEPS } from '@superone/shared/fire-particles'
import { buildFireTrajectories, particleAgeAt } from './fire-sim'

const fire = buildFireTrajectories(120, 16, true)

describe('trajectory table', () => {
  it('resolves every spawn in the period', () => {
    expect(fire.count).toBeGreaterThan(100)
    expect(fire.spawnStep).toHaveLength(fire.count)
    expect(fire.lifeSteps).toHaveLength(fire.count)
  })

  it('packs each particle into its own run of the position arrays', () => {
    let expected = 0
    for (let index = 0; index < fire.count; index++) {
      expect(fire.offset[index]).toBe(expected)
      expected += fire.lifeSteps[index]!
    }
    expect(fire.x).toHaveLength(expected)
    expect(fire.y).toHaveLength(expected)
  })

  it('rises: every particle ends above where it started', () => {
    for (let index = 0; index < fire.count; index++) {
      const start = fire.offset[index]!
      const last = start + fire.lifeSteps[index]! - 1
      expect(fire.y[last]!).toBeLessThan(fire.y[start]!)
    }
  })

  it('accelerates upward rather than rising at a constant rate', () => {
    const index = 0
    const start = fire.offset[index]!
    const life = fire.lifeSteps[index]!
    const first = fire.y[start]! - fire.y[start + 1]!
    const later = fire.y[start + life - 2]! - fire.y[start + life - 1]!
    expect(later).toBeGreaterThan(first)
  })

  it('is deterministic, so light and dark each keep one stable fire', () => {
    expect([...buildFireTrajectories(120, 16, true).x]).toEqual([...fire.x])
    expect([...buildFireTrajectories(120, 16, false).x]).not.toEqual([...fire.x])
  })

  it('scales spawn spread with the label it burns over', () => {
    const wide = buildFireTrajectories(400, 16, true)
    expect(Math.max(...wide.x)).toBeGreaterThan(Math.max(...fire.x))
  })
})

describe('age lookup', () => {
  it('reports a particle alive exactly through its life span', () => {
    const step = fire.spawnStep[3]!
    expect(particleAgeAt(fire, 3, step)).toBe(0)
    expect(particleAgeAt(fire, 3, (step + fire.lifeSteps[3]! - 1) % PERIOD_STEPS)).toBe(fire.lifeSteps[3]! - 1)
    expect(particleAgeAt(fire, 3, (step + fire.lifeSteps[3]!) % PERIOD_STEPS)).toBe(-1)
  })

  it('wraps across the period so the loop has no empty frame', () => {
    const late = [...fire.spawnStep].findIndex((step, index) => step + fire.lifeSteps[index]! > PERIOD_STEPS)
    expect(late).toBeGreaterThanOrEqual(0)
    expect(particleAgeAt(fire, late, 0)).toBeGreaterThan(0)
  })

  it('keeps the fire populated at every tick of the period', () => {
    for (let step = 0; step < PERIOD_STEPS; step++) {
      let alive = 0
      for (let index = 0; index < fire.count; index++) if (particleAgeAt(fire, index, step) >= 0) alive++
      expect(alive).toBeGreaterThan(10)
    }
  })
})
