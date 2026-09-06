/**
 * The `max` effort easter egg's particle simulation, shared by every surface
 * that draws it. Desktop bakes it into a sprite strip with a 2D canvas; mobile
 * replays it live with Skia. Only the drawing differs — the physics, the spawn
 * schedule and the seeds live here so the two fires stay the same fire.
 *
 * Colours live next door in `effort-easter-egg-palette`.
 */

/** Physics ticks per second. The sim is stepped, not time-integrated. */
export const PHYS_HZ = 120
/** Seconds before the spawn schedule repeats, which is what makes the loop seamless. */
export const PERIOD_S = 2
export const PERIOD_STEPS = PHYS_HZ * PERIOD_S

export const DARK_SEED = 0x9e3779b9
export const LIGHT_SEED = 0x85ebca6b

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface SpawnEvent {
  x: number
  y: number
  vx: number
  vy: number
  maxLife: number
  size: number
  /** Seeds this particle's own jitter stream, so its wander is reproducible. */
  seed: number
}

export interface FireParticle extends SpawnEvent {
  life: number
  jitter: () => number
}

/**
 * One period of spawns. `null` means the tick spawned nothing — the 0.6
 * probability is what gives the fire its uneven, licking rhythm, so the gaps
 * are part of the data rather than something to compress out.
 */
export function buildSpawnSchedule(textW: number, textH: number, seed: number): (SpawnEvent | null)[] {
  const rng = mulberry32(seed)
  const spawns: (SpawnEvent | null)[] = []
  for (let step = 0; step < PERIOD_STEPS; step++) {
    spawns.push(
      rng() < 0.6
        ? {
            x: rng() * textW,
            // Embers leave the body of the glyphs, not the top of the box.
            y: textH * (0.1 + rng() * 0.5),
            vx: (rng() - 0.5) * 0.15,
            vy: -(0.05 + rng() * 0.12),
            maxLife: 30 + rng() * 30,
            size: 0.5 + rng() * 1.5,
            seed: Math.imul(step + 1, 2654435761),
          }
        : null,
    )
  }
  return spawns
}

export function spawnParticle(event: SpawnEvent): FireParticle {
  return { ...event, life: 0, jitter: mulberry32(event.seed) }
}

/** Advance one particle by a single tick. Rising accelerates; drift is a random walk. */
export function stepParticle(particle: FireParticle): void {
  particle.life++
  particle.x += particle.vx
  particle.vy -= 0.005
  particle.y += particle.vy
  particle.vx += (particle.jitter() - 0.5) * 0.08
}

/** Fraction of life burned, in `[0, 1)`. At 1 the particle is gone. */
export function particleAge(particle: FireParticle): number {
  return particle.life / particle.maxLife
}

/** Flares to full over the first tenth of life, then fades out linearly. */
export function particleAlpha(age: number): number {
  return age < 0.1 ? age / 0.1 : 1 - (age - 0.1) / 0.9
}

/** Embers shrink to half as they burn down. */
export function particleRadius(size: number, age: number): number {
  return size * (1 - age * 0.5)
}

/** Core alpha multiplier; the halo is drawn at `HALO_RADIUS`x this size and `HALO_ALPHA`. */
export const CORE_ALPHA = 0.8
export const HALO_ALPHA = 0.12
export const HALO_RADIUS = 2
