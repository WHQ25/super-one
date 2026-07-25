/**
 * Classic fluorescent highlighter set (common 3M / Stabilo / Sharpie packs).
 * Stroke = neon ink for screen-blend overlays; paper = soft Post-it companion.
 */
export interface HighlighterSwatch {
  id: string
  /** Short English label */
  label: string
  /** Fluorescent core fill (with alpha) */
  core: string
  /** Gradient top edge highlight */
  coreTop: string
  /** Gradient bottom edge */
  coreBottom: string
  /** Soft outer glow */
  glow: string
  /** Outer bloom */
  bloom: string
  /** Hairline edge */
  edge: string
  /** Collapsed pin / open sticky paper */
  paper: string
  paperDeep: string
  /** Text on paper */
  ink: string
  inkMuted: string
}

/** Six common highlighter colors, cycling per comment. */
export const HIGHLIGHTER_PALETTE: readonly HighlighterSwatch[] = [
  {
    id: 'yellow',
    label: 'Yellow',
    core: 'rgb(220 255 40 / 0.42)',
    coreTop: 'rgb(235 255 90 / 0.55)',
    coreBottom: 'rgb(180 255 30 / 0.4)',
    glow: 'rgb(200 255 0 / 0.28)',
    bloom: 'rgb(200 255 0 / 0.12)',
    edge: 'rgb(255 255 120 / 0.25)',
    paper: '#FEF6A5',
    paperDeep: '#F5E66B',
    ink: '#3D3410',
    inkMuted: 'rgb(61 52 16 / 0.35)',
  },
  {
    id: 'pink',
    label: 'Pink',
    core: 'rgb(255 105 180 / 0.4)',
    coreTop: 'rgb(255 150 200 / 0.52)',
    coreBottom: 'rgb(255 80 160 / 0.38)',
    glow: 'rgb(255 100 180 / 0.26)',
    bloom: 'rgb(255 80 160 / 0.12)',
    edge: 'rgb(255 180 220 / 0.28)',
    paper: '#FFD6E8',
    paperDeep: '#FFB8D9',
    ink: '#4A1530',
    inkMuted: 'rgb(74 21 48 / 0.35)',
  },
  {
    id: 'orange',
    label: 'Orange',
    core: 'rgb(255 170 40 / 0.42)',
    coreTop: 'rgb(255 200 90 / 0.55)',
    coreBottom: 'rgb(255 140 20 / 0.4)',
    glow: 'rgb(255 160 30 / 0.26)',
    bloom: 'rgb(255 140 0 / 0.12)',
    edge: 'rgb(255 210 120 / 0.28)',
    paper: '#FFE0B2',
    paperDeep: '#FFCC80',
    ink: '#4A2C0A',
    inkMuted: 'rgb(74 44 10 / 0.35)',
  },
  {
    id: 'green',
    label: 'Green',
    core: 'rgb(100 255 120 / 0.4)',
    coreTop: 'rgb(140 255 160 / 0.52)',
    coreBottom: 'rgb(60 240 100 / 0.38)',
    glow: 'rgb(80 255 120 / 0.26)',
    bloom: 'rgb(50 255 100 / 0.12)',
    edge: 'rgb(160 255 180 / 0.28)',
    paper: '#D4F5C8',
    paperDeep: '#B8EBA6',
    ink: '#1A3D14',
    inkMuted: 'rgb(26 61 20 / 0.35)',
  },
  {
    id: 'blue',
    label: 'Blue',
    core: 'rgb(80 200 255 / 0.4)',
    coreTop: 'rgb(120 220 255 / 0.52)',
    coreBottom: 'rgb(50 180 255 / 0.38)',
    glow: 'rgb(70 190 255 / 0.26)',
    bloom: 'rgb(40 170 255 / 0.12)',
    edge: 'rgb(150 230 255 / 0.28)',
    paper: '#C8E8FF',
    paperDeep: '#A8D8FF',
    ink: '#0F2A45',
    inkMuted: 'rgb(15 42 69 / 0.35)',
  },
  {
    id: 'purple',
    label: 'Purple',
    core: 'rgb(200 140 255 / 0.4)',
    coreTop: 'rgb(220 170 255 / 0.52)',
    coreBottom: 'rgb(180 110 255 / 0.38)',
    glow: 'rgb(190 120 255 / 0.26)',
    bloom: 'rgb(170 100 255 / 0.12)',
    edge: 'rgb(230 190 255 / 0.28)',
    paper: '#E8D4FF',
    paperDeep: '#D4B8FF',
    ink: '#2A1450',
    inkMuted: 'rgb(42 20 80 / 0.35)',
  },
] as const

export function highlighterForIndex(index: number): HighlighterSwatch {
  const n = HIGHLIGHTER_PALETTE.length
  const i = ((index % n) + n) % n
  return HIGHLIGHTER_PALETTE[i]!
}

/** Stable color from comment id (fallback when index unknown). */
export function highlighterForId(id: string): HighlighterSwatch {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return highlighterForIndex(Math.abs(h))
}

/** Prefer order in the comments list so 1st=yellow, 2nd=pink, … */
export function highlighterForComment(
  commentId: string,
  comments: readonly { id: string }[],
): HighlighterSwatch {
  const idx = comments.findIndex((c) => c.id === commentId)
  return idx >= 0 ? highlighterForIndex(idx) : highlighterForId(commentId)
}

/** Next free color for a new draft (cycles after palette length). */
export function highlighterForDraft(commentCount: number): HighlighterSwatch {
  return highlighterForIndex(commentCount)
}
