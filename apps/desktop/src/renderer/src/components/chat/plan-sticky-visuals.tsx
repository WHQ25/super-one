import type { CSSProperties, ReactNode } from 'react'
import type { StickySwatch } from './plan-sticky-palette'

/**
 * Physical-media look for plan annotations: chisel-tip marker strokes and
 * 3M Post-it sheets. Pure presentation — no DOM measuring, no state — so both
 * `PlanLineReview` and Storybook render the exact same pixels.
 */

/** Deterministic 0..1 from a seed, so a stroke keeps its wobble across re-renders. */
function noise(seed: number, salt: number): number {
  const x = Math.sin(seed * 12.9898 + salt * 78.233) * 43758.5453
  return x - Math.floor(x)
}

function span(seed: number, salt: number, min: number, max: number): number {
  return min + noise(seed, salt) * (max - min)
}

/** Stable numeric seed for a stroke fragment. */
export function strokeSeed(key: string, index: number): number {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0
  return Math.abs(h % 9973) + index * 37
}

/** Extra width painted past the text, mimicking marker overshoot. */
export const MARKER_OVERSHOOT = 3

/**
 * A chisel-tip highlighter stroke.
 *
 * Layers, top-down: fibre grain → dry stripe → bottom ink settle → end pooling.
 * The two upper layers use a *veil* color that is a no-op for the blend mode in
 * use (white under `multiply`, black under `screen`), so they subtract ink
 * instead of adding a wash of their own.
 */
export function markerStrokeStyle(
  swatch: StickySwatch,
  isDark: boolean,
  seed: number,
): CSSProperties {
  const ink = isDark ? swatch.markerDark : swatch.marker
  const veil = isDark ? '0 0 0' : '255 255 255'
  // Each end gets its own chisel angle, so the stroke is a hand-drawn
  // trapezoid rather than a mechanical parallelogram.
  const slantL = span(seed, 1, 1, 6.5)
  const slantR = span(seed, 5, 1, 6.5)
  const tilt = span(seed, 2, -1.8, 1.8)
  const dryAt = span(seed, 3, 26, 46)
  // Hand height varies per stroke — nobody lands the pen twice alike. Kept
  // inside the line box's slack so a stroke never drifts off its own text.
  const dy = span(seed, 6, -2.6, 2.6)

  const clip = `polygon(
    ${slantL.toFixed(1)}px ${Math.max(0, tilt).toFixed(1)}px,
    100% ${Math.max(0, -tilt).toFixed(1)}px,
    calc(100% - ${slantR.toFixed(1)}px) 100%,
    0% 100%
  )`

  return {
    backgroundImage: [
      // fibre grain of the felt tip
      `repeating-linear-gradient(87deg, rgb(${veil} / 0) 0 2px, rgb(${veil} / 0.1) 2px 3px)`,
      // dry stripe where the tip lifted slightly
      `linear-gradient(180deg, rgb(${veil} / 0) ${dryAt - 7}%, rgb(${veil} / 0.16) ${dryAt}%, rgb(${veil} / 0) ${dryAt + 8}%)`,
      // ink settling along the bottom edge
      `linear-gradient(180deg, rgb(0 0 0 / 0) 58%, ${ink.deep} 100%)`,
      // pen dwell at both ends
      `linear-gradient(90deg, ${ink.deep} 0px, ${ink.base} 7px, ${ink.base} calc(100% - 9px), ${ink.deep} 100%)`,
    ].join(','),
    clipPath: clip,
    WebkitClipPath: clip,
    transform: `translateY(${dy.toFixed(2)}px) rotate(${span(seed, 4, -0.4, 0.4).toFixed(2)}deg)`,
    filter: 'blur(0.4px)',
    mixBlendMode: isDark ? 'screen' : 'multiply',
  }
}

export interface StickyPaperProps {
  swatch: StickySwatch
  isDark?: boolean
  width?: number
  minHeight?: number
  /** Degrees of hand-placed skew */
  rotate?: number
  children?: ReactNode
  className?: string
  style?: CSSProperties
}

/**
 * A 3M Post-it sheet.
 *
 * Modelled on a note stuck to a wall: the adhesive strip holds the **top**
 * edge — tight contact shadow, slight sheen — while the sheet leans away from
 * the wall toward the bottom. That lean is carried entirely by light and
 * shadow (sheet dims downward, cast shadow spreads downward, a 1px lit lip for
 * paper thickness); the sheet itself stays a clean rectangle.
 */
export function StickyPaper({
  swatch,
  isDark = false,
  width = 200,
  minHeight = 184,
  rotate = 1.1,
  children,
  className,
  style,
}: StickyPaperProps) {
  const p = swatch.paper
  const cast = isDark ? 0.5 : 0.22

  return (
    <div
      className={className}
      style={{
        position: 'relative',
        width,
        transform: `rotate(${rotate}deg)`,
        filter: [
          // tight contact shadow along the stuck top edge
          `drop-shadow(0 0.5px 0.5px rgb(0 0 0 / ${(cast * 0.55).toFixed(2)}))`,
          // the sheet leans off the wall toward the bottom, so its cast shadow
          // sits lower and softer than a uniform box shadow would
          `drop-shadow(0 4px 5px rgb(0 0 0 / ${(cast * 0.45).toFixed(2)}))`,
          `drop-shadow(0 9px 12px rgb(0 0 0 / ${(cast * 0.4).toFixed(2)}))`,
        ].join(' '),
        ...style,
      }}
    >
      <div
        style={{
          position: 'relative',
          minHeight,
          backgroundImage: [
            // satin sheen over the adhesive strip along the top
            'linear-gradient(180deg, rgb(255 255 255 / 0.26) 0%, rgb(255 255 255 / 0.05) 9%, rgb(255 255 255 / 0) 22%)',
            // the sheet bows slightly outward, so its middle catches more light
            'radial-gradient(120% 80% at 46% 34%, rgb(255 255 255 / 0.14) 0%, rgb(255 255 255 / 0) 70%)',
            // leaning away from the wall = less light toward the bottom
            'linear-gradient(180deg, rgb(0 0 0 / 0) 62%, rgb(0 0 0 / 0.05) 100%)',
            // sheet body
            `linear-gradient(177deg, ${p.top} 0%, ${p.base} 34%, ${p.base} 74%, ${p.deep} 100%)`,
          ].join(','),
          // 1px lit lip = the paper's own thickness at the free edge
          boxShadow: `inset 0 -1px 0 ${p.back}`,
          filter: isDark ? 'brightness(0.93) saturate(0.94)' : undefined,
        }}
      >
        {children}
      </div>
    </div>
  )
}

export interface StickyPinProps {
  swatch: StickySwatch
  isDark?: boolean
  index: number
  size?: number
}

/** Collapsed note: a mini Post-it square carrying the comment number. */
export function StickyPinFace({ swatch, isDark = false, index, size = 18 }: StickyPinProps) {
  const p = swatch.paper
  return (
    <span
      style={{
        display: 'flex',
        width: size,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundImage: `linear-gradient(176deg, ${p.top} 0%, ${p.base} 48%, ${p.deep} 100%)`,
        boxShadow: `inset 0 -1px 0 ${p.back}`,
        color: swatch.text,
        fontSize: size * 0.56,
        fontWeight: 600,
        lineHeight: 1,
        filter: isDark ? 'brightness(0.93) saturate(0.94)' : undefined,
      }}
    >
      {index + 1}
    </span>
  )
}
