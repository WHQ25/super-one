/**
 * Project → session-list unfold. Height pushes the rest of the drawer down;
 * rows fade and rise on a stagger. Collapse is shorter and not staggered,
 * so closing does not feel like it is playing in reverse.
 *
 * Kept free of Reanimated so the numbers are testable under vitest.
 */
export const SESSION_UNFOLD = {
  heightInMs: 240,
  heightOutMs: 180,
  chevronMs: 180,
  rowInMs: 180,
  rowOutMs: 90,
  staggerMs: 24,
  rowDelayMs: 40,
  translateY: 8,
  easing: [0.22, 1, 0.36, 1] as const,
} as const

export function sessionUnfoldDelay(index: number): number {
  return index * SESSION_UNFOLD.staggerMs + SESSION_UNFOLD.rowDelayMs
}

export function sessionUnfoldHeightMs(collapsing: boolean): number {
  return collapsing ? SESSION_UNFOLD.heightOutMs : SESSION_UNFOLD.heightInMs
}
