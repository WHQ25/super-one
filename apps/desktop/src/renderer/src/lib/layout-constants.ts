export const LAYOUT = {
  MIN_MAIN: 400,
  MIN_SIDEBAR: 320,
  MAX_SIDEBAR: 500,
  MIN_AP: 360,
  CARD_GUTTER: 12,
} as const

export const ACTIVITY_PANEL_TRANSITION = {
  durationMs: 300,
  easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
} as const

/**
 * Largest the sidebar may grow to while the main area keeps at least `mainMin`
 * (in mosaic mode `mainMin` is the split's measured minimum, not LAYOUT.MIN_MAIN).
 * `apReserved` is the space the activity panel needs to keep — its min during a
 * live drag, its current width during a passive clamp.
 */
export function maxSidebarWidth(innerWidth: number, mainMin: number, apReserved: number): number {
  return Math.min(LAYOUT.MAX_SIDEBAR, innerWidth - apReserved - mainMin - LAYOUT.CARD_GUTTER)
}
