import {
  buildSpawnSchedule,
  DARK_SEED,
  LIGHT_SEED,
  PERIOD_STEPS,
  spawnParticle,
  stepParticle,
  type FireParticle,
} from '@superone/shared/fire-particles'

/**
 * The `max` easter egg's fire, precomputed into flat typed arrays a Skia
 * worklet can read without touching the JS thread.
 *
 * Desktop runs the same simulation once and bakes it into a sprite strip.
 * Mobile cannot rasterise at build time for an arbitrary label width, so it
 * bakes the *trajectories* instead: every particle's position is resolved here,
 * and the draw loop only has to look up `spawnStep + age`. Colour, radius and
 * alpha stay as cheap per-frame math because they are a few multiplies and
 * would otherwise triple the size of this table.
 */
export interface FireTrajectories {
  /** Number of particles in one period. */
  count: number
  /** Tick each particle is born on, in `[0, PERIOD_STEPS)`. */
  spawnStep: Int32Array
  /** How many ticks each particle lives — its row length in `x` / `y`. */
  lifeSteps: Int32Array
  /** Where each particle's run starts in `x` / `y`. */
  offset: Int32Array
  /** Spawn size, before the burn-down shrink. */
  size: Float32Array
  x: Float32Array
  y: Float32Array
}

/**
 * Resolve one period of fire over a text box. The first period is thrown away
 * as warm-up so tick 0 already has a full population — without it the loop
 * visibly restarts from an empty box every two seconds.
 */
export function buildFireTrajectories(width: number, height: number, dark: boolean): FireTrajectories {
  const spawns = buildSpawnSchedule(width, height, dark ? DARK_SEED : LIGHT_SEED)
  const live = spawns
    .map((event, step) => (event ? { event, step } : null))
    .filter((entry): entry is { event: NonNullable<(typeof spawns)[number]>; step: number } => entry !== null)

  const count = live.length
  const spawnStep = new Int32Array(count)
  const lifeSteps = new Int32Array(count)
  const offset = new Int32Array(count)
  const size = new Float32Array(count)

  let total = 0
  for (let index = 0; index < count; index++) {
    const { event, step } = live[index]!
    spawnStep[index] = step
    // `maxLife` is fractional; a particle is drawn while `life / maxLife < 1`.
    lifeSteps[index] = Math.ceil(event.maxLife)
    offset[index] = total
    size[index] = event.size
    total += lifeSteps[index]!
  }

  const x = new Float32Array(total)
  const y = new Float32Array(total)
  for (let index = 0; index < count; index++) {
    const particle: FireParticle = spawnParticle(live[index]!.event)
    const start = offset[index]!
    for (let age = 0; age < lifeSteps[index]!; age++) {
      x[start + age] = particle.x
      y[start + age] = particle.y
      stepParticle(particle)
    }
  }

  return { count, spawnStep, lifeSteps, offset, size, x, y }
}

/**
 * Age of particle `index` at `step`, in ticks, or `-1` when it is not alive.
 * The wrap is what makes the loop seamless: a particle born at tick 235 is
 * still burning at tick 5 of the next period.
 */
export function particleAgeAt(fire: FireTrajectories, index: number, step: number): number {
  const age = (step - fire.spawnStep[index]! + PERIOD_STEPS) % PERIOD_STEPS
  return age < fire.lifeSteps[index]! ? age : -1
}
