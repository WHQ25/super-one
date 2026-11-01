/**
 * Draft-row motion, matching the desktop sidebar group.
 * Kept free of Reanimated so the numbers stay testable under vitest.
 *
 * Height opens or closes with the row count. A draft that was not on the
 * first paint flies in from the right, just behind that space. Opening one
 * flies that row out toward the composer.
 */

export const DRAFT_ROW_HEIGHT = 40

/** Opening or closing the space the rows occupy. */
export const DRAFT_GROUP_MS = 180
export const DRAFT_GROUP_EASING = [0.32, 0.72, 0, 1] as const

/** The row flying in from the right. */
export const DRAFT_SLIDE_IN_MS = 220
export const DRAFT_SLIDE_IN_DELAY_MS = 60
export const DRAFT_SLIDE_IN_EASING = [0.22, 1, 0.36, 1] as const

/** Leaving for the composer — accelerating out, so it reads as departing. */
export const DRAFT_SLIDE_OUT_MS = 200
export const DRAFT_SLIDE_OUT_EASING = [0.55, 0, 1, 0.45] as const

/** How far past the row's own width the flight starts and ends. */
export const DRAFT_FLIGHT_SCALE = 1.05
