import { MIN_CHAT_WIDTH } from '@superone/shared/agent-types'

export const LAYOUT = {
  MIN_MAIN: MIN_CHAT_WIDTH,
  MIN_SIDEBAR: 320,
  MAX_SIDEBAR: 500,
  /**
   * Floor for the activity panel and for dockview group minima inside it. A group
   * that demands more is laid out oversized and clipped by the panel.
   *
   * Also the app window's activity-panel reservation (`App.tsx`) and the mini-app
   * `preferWidth` minimum (`miniapp-schema.ts`).
   */
  MIN_AP: 400,
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
