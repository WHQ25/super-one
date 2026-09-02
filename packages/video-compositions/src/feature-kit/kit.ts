// Shared constants + deterministic helpers for the SuperOne feature videos.
// Every video composition is 1920×1080 @ 30fps. All randomness here is seeded so
// Remotion renders identical frames across preview, scrub and final render.

import { Easing, interpolate } from "remotion"

export const FEATURE_FPS = 30
export const FEATURE_WIDTH = 1920
export const FEATURE_HEIGHT = 1080

/** Seconds → whole frames at the feature FPS. */
export const sec = (s: number): number => Math.round(s * FEATURE_FPS)

/** Smooth, slightly overshooting ease used for most enter animations. */
export const EASE_OUT = Easing.bezier(0.16, 1, 0.3, 1)
export const EASE_IN_OUT = Easing.bezier(0.65, 0, 0.35, 1)

/** Standard fade-in over `len` frames starting at `start` (clamped). */
export function fadeIn(frame: number, start: number, len: number): number {
  return interpolate(frame, [start, start + len], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  })
}

/** Fade-out over `len` frames ending at `end` (clamped). */
export function fadeOut(frame: number, end: number, len: number): number {
  return interpolate(frame, [end - len, end], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_IN_OUT,
  })
}

/** Window that fades in, holds, then fades out — returns 0..1 opacity. */
export function fadeWindow(
  frame: number,
  start: number,
  end: number,
  ramp = sec(0.4),
): number {
  return Math.min(fadeIn(frame, start, ramp), fadeOut(frame, end, ramp))
}

export function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

// ── Deterministic hash / noise ──────────────────────────────────────────────

export function hashStr(s: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function mulberry32(seed: number): number {
  let a = seed | 0
  a = (a + 0x6d2b79f5) | 0
  let t = Math.imul(a ^ (a >>> 15), 1 | a)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/** Stable 0..1 value for a (seed, index) pair. */
export function rand01(seed: string, i: number): number {
  return mulberry32((hashStr(seed) ^ Math.imul(i + 1, 0x9e3779b9)) >>> 0)
}

// ── Stage coordinate mapping ────────────────────────────────────────────────
// AppStage renders a base-sized mock scaled into a centered window box. Cursor
// and overlay positions are authored in the mock's base coordinate space and
// mapped into the 1920×1080 composition with these helpers.

export interface StageBox {
  left: number
  top: number
  scale: number
}

export function makeStage(
  windowW = 1500,
  baseW = 1280,
  top = 34,
): StageBox {
  return {
    left: (FEATURE_WIDTH - windowW) / 2,
    top,
    scale: windowW / baseW,
  }
}

export function mapX(s: StageBox, baseX: number): number {
  return s.left + baseX * s.scale
}

export function mapY(s: StageBox, baseY: number): number {
  return s.top + baseY * s.scale
}
