/**
 * 3M Post-it inspired sticky palette.
 *
 * Each swatch pairs a **pastel paper** (the note) with a **fluorescent ink**
 * (the marker stroke) from the same hue family, so a comment's highlight and
 * its note always read as one set.
 *
 * Ink comes in two variants because the stroke is painted as a blended overlay:
 * - `marker`     → light theme, `mix-blend-mode: multiply` (subtractive, like real ink)
 * - `markerDark` → dark theme, `mix-blend-mode: screen` (additive, so ink must be *dark*)
 *
 * In both variants `deep` means "more ink" (pen dwell at stroke ends / bottom
 * settle): darker under multiply, brighter under screen.
 */

export interface StickyInk {
  /** Body of the stroke */
  base: string
  /** Pooled ink at stroke ends and bottom edge */
  deep: string
}

export interface StickyPaperColors {
  /** Lit top edge (where the adhesive strip holds the sheet) */
  top: string
  /** Main sheet color */
  base: string
  /** Shaded band just above the bottom edge, where the sheet lifts off */
  deep: string
  /** Lit lip of the lifted bottom edge, catching light head-on */
  back: string
}

export interface StickySwatch {
  id: string
  /** Post-it collection name */
  label: string
  paper: StickyPaperColors
  /** Pen ink written on the note */
  text: string
  textMuted: string
  marker: StickyInk
  markerDark: StickyInk
}

/** Six Post-it colors, cycling per comment. */
export const STICKY_PALETTE: readonly StickySwatch[] = [
  {
    id: 'canary',
    label: 'Canary Yellow',
    paper: { top: '#FFFCC9', base: '#FBF08A', deep: '#EFDF6D', back: '#FFFBD9' },
    text: '#463F10',
    textMuted: 'rgb(70 63 16 / 0.42)',
    marker: { base: 'rgb(247 226 20 / 0.5)', deep: 'rgb(224 194 8 / 0.58)' },
    markerDark: { base: 'rgb(96 84 12 / 0.9)', deep: 'rgb(128 111 18 / 0.95)' },
  },
  {
    id: 'pink',
    label: 'Power Pink',
    paper: { top: '#FFDCEB', base: '#FFB4D2', deep: '#F899C0', back: '#FFE8F1' },
    text: '#571432',
    textMuted: 'rgb(87 20 50 / 0.42)',
    marker: { base: 'rgb(255 92 158 / 0.4)', deep: 'rgb(238 56 132 / 0.5)' },
    markerDark: { base: 'rgb(104 26 58 / 0.9)', deep: 'rgb(136 34 74 / 0.95)' },
  },
  {
    id: 'papaya',
    label: 'Papaya Orange',
    paper: { top: '#FFE7C6', base: '#FFC98F', deep: '#F8B270', back: '#FFEEDA' },
    text: '#572C08',
    textMuted: 'rgb(87 44 8 / 0.42)',
    marker: { base: 'rgb(255 150 40 / 0.44)', deep: 'rgb(238 120 10 / 0.52)' },
    markerDark: { base: 'rgb(104 56 10 / 0.9)', deep: 'rgb(134 72 12 / 0.95)' },
  },
  {
    id: 'limeade',
    label: 'Limeade Green',
    paper: { top: '#E8F7C4', base: '#CBEB93', deep: '#B5DC78', back: '#EEF9D6' },
    text: '#2B4211',
    textMuted: 'rgb(43 66 17 / 0.42)',
    marker: { base: 'rgb(160 226 60 / 0.46)', deep: 'rgb(124 198 28 / 0.54)' },
    markerDark: { base: 'rgb(58 92 16 / 0.9)', deep: 'rgb(78 120 20 / 0.95)' },
  },
  {
    id: 'aqua',
    label: 'Aqua Wave',
    paper: { top: '#D8F2FA', base: '#A9E2F2', deep: '#8CD1E5', back: '#E4F6FC' },
    text: '#0F3849',
    textMuted: 'rgb(15 56 73 / 0.42)',
    marker: { base: 'rgb(80 205 240 / 0.42)', deep: 'rgb(36 176 219 / 0.52)' },
    markerDark: { base: 'rgb(18 76 102 / 0.9)', deep: 'rgb(24 100 132 / 0.95)' },
  },
  {
    id: 'iris',
    label: 'Iris Purple',
    paper: { top: '#EEE6FB', base: '#D2C2F0', deep: '#BEA9E4', back: '#F0EAFC' },
    text: '#2D1B56',
    textMuted: 'rgb(45 27 86 / 0.42)',
    marker: { base: 'rgb(186 140 245 / 0.4)', deep: 'rgb(156 102 232 / 0.5)' },
    markerDark: { base: 'rgb(66 42 110 / 0.9)', deep: 'rgb(88 56 142 / 0.95)' },
  },
] as const

export function stickyForIndex(index: number): StickySwatch {
  const n = STICKY_PALETTE.length
  const i = ((index % n) + n) % n
  return STICKY_PALETTE[i]!
}

/** Stable color from comment id (fallback when index unknown). */
export function stickyForId(id: string): StickySwatch {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return stickyForIndex(Math.abs(h))
}

/** Prefer order in the comments list so 1st=canary, 2nd=pink, … */
export function stickyForComment(
  commentId: string,
  comments: readonly { id: string }[],
): StickySwatch {
  const idx = comments.findIndex((c) => c.id === commentId)
  return idx >= 0 ? stickyForIndex(idx) : stickyForId(commentId)
}

/** Next free color for a new draft (cycles after palette length). */
export function stickyForDraft(commentCount: number): StickySwatch {
  return stickyForIndex(commentCount)
}
