import { describe, expect, it } from 'vitest'
import {
  buildSpawnSchedule,
  DARK_SEED,
  mulberry32,
  particleAlpha,
  particleRadius,
  PERIOD_STEPS,
  spawnParticle,
  stepParticle,
} from './fire-particles'

describe('spawn schedule', () => {
  it('covers exactly one period', () => {
    expect(buildSpawnSchedule(100, 16, DARK_SEED)).toHaveLength(PERIOD_STEPS)
  })

  it('is reproducible for a seed, so the sprite strip and the live sim agree', () => {
    expect(buildSpawnSchedule(100, 16, DARK_SEED)).toEqual(buildSpawnSchedule(100, 16, DARK_SEED))
  })

  it('leaves gaps rather than spawning on every tick', () => {
    const spawns = buildSpawnSchedule(100, 16, DARK_SEED)
    const live = spawns.filter(Boolean).length
    expect(live).toBeGreaterThan(PERIOD_STEPS * 0.5)
    expect(live).toBeLessThan(PERIOD_STEPS * 0.7)
  })

  it('seeds every particle differently so their wander does not sync up', () => {
    const seeds = buildSpawnSchedule(100, 16, DARK_SEED).filter((event) => event !== null).map((event) => event.seed)
    expect(new Set(seeds).size).toBe(seeds.length)
  })

  it('spawns inside the text box', () => {
    for (const event of buildSpawnSchedule(100, 16, DARK_SEED)) {
      if (!event) continue
      expect(event.x).toBeGreaterThanOrEqual(0)
      expect(event.x).toBeLessThanOrEqual(100)
      expect(event.y).toBeGreaterThanOrEqual(16 * 0.1)
      expect(event.y).toBeLessThanOrEqual(16 * 0.6)
    }
  })
})

describe('physics', () => {
  const event = { x: 10, y: 8, vx: 0, vy: -0.1, maxLife: 40, size: 1, seed: 7 }

  it('accelerates upward instead of drifting at a constant speed', () => {
    const particle = spawnParticle(event)
    stepParticle(particle)
    const first = particle.y
    stepParticle(particle)
    const second = particle.y
    // Each step covers more ground than the last: that is `vy -= 0.005`.
    expect(8 - first).toBeLessThan(first - second)
  })

  it('wanders sideways from a standing start', () => {
    const particle = spawnParticle(event)
    for (let step = 0; step < 20; step++) stepParticle(particle)
    expect(particle.x).not.toBe(10)
  })

  it('replays identically from the same seed', () => {
    const run = () => {
      const particle = spawnParticle(event)
      for (let step = 0; step < 20; step++) stepParticle(particle)
      return [particle.x, particle.y]
    }
    expect(run()).toEqual(run())
  })
})

describe('appearance over a life', () => {
  it('flares in over the first tenth and fades to nothing', () => {
    expect(particleAlpha(0)).toBe(0)
    expect(particleAlpha(0.1)).toBeCloseTo(1)
    expect(particleAlpha(1)).toBeCloseTo(0)
  })

  it('rises to full brightness faster than it dies', () => {
    expect(particleAlpha(0.05)).toBeGreaterThan(particleAlpha(0.95))
  })

  it('shrinks to half its size', () => {
    expect(particleRadius(2, 0)).toBe(2)
    expect(particleRadius(2, 1)).toBe(1)
  })
})

it('mulberry32 stays inside the unit interval', () => {
  const random = mulberry32(DARK_SEED)
  for (let draw = 0; draw < 500; draw++) {
    const value = random()
    expect(value).toBeGreaterThanOrEqual(0)
    expect(value).toBeLessThan(1)
  }
})
