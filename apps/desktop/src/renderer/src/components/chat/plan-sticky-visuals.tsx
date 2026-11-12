import type { CSSProperties, ReactNode, Ref } from 'react'
import { X } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import type { StickySwatch } from './plan-sticky-palette'
import type { HighlightBand, ViewportCorner } from './plan-annotation-dom'

/**
 * Physical-media look for sticky annotations: chisel-tip marker strokes and
 * 3M Post-it sheets. Pure presentation — no DOM measuring, no state — so
 * `PlanLineReview`, reply comments and Storybook render the exact same pixels.
 */

/** Marks sticky UI, so selection and blur handlers leave clicks on it alone. */
export const STICKY_UI_ATTR = 'data-plan-sticky-ui'

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

/** How a stroke meets the page. One group shares this; strokes inside it do not. */
export function markerBlendMode(isDark: boolean): CSSProperties['mixBlendMode'] {
  return isDark ? 'screen' : 'multiply'
}

/**
 * A chisel-tip highlighter stroke.
 *
 * Light mode layers grain, a dry stripe, and darker ink at the ends: under
 * `multiply`, more ink reads darker. Dark mode is a flat `base` fill. Under
 * `screen`, darker ink is *brighter*, so a bottom ramp lit the ends of a line.
 * A second band on the same line — inline code sits a few pixels off the text
 * and used to be its own stroke — screened again and lit that whole line.
 * `blend` is false when a parent group already blends the passage once;
 * overlapping strokes then cannot screen (or multiply) on top of each other.
 */
export function markerStrokeStyle(
  swatch: StickySwatch,
  isDark: boolean,
  seed: number,
  blend = true,
): CSSProperties {
  const ink = isDark ? swatch.markerDark : swatch.marker
  const veil = '255 255 255'
  // Each end gets its own chisel angle, so the stroke is a hand-drawn
  // trapezoid rather than a mechanical parallelogram. No vertical shift:
  // a moved stroke overlaps the next line and the seam picks up extra ink.
  const slantL = span(seed, 1, 1, 6.5)
  const slantR = span(seed, 5, 1, 6.5)
  const dryAt = span(seed, 3, 26, 46)

  const clip = `polygon(
    ${slantL.toFixed(1)}px 0px,
    100% 0px,
    calc(100% - ${slantR.toFixed(1)}px) 100%,
    0% 100%
  )`

  const paint: CSSProperties = isDark
    ? { backgroundColor: ink.base }
    : {
        backgroundImage: [
          `repeating-linear-gradient(87deg, rgb(${veil} / 0) 0 2px, rgb(${veil} / 0.1) 2px 3px)`,
          `linear-gradient(180deg, rgb(${veil} / 0) ${dryAt - 7}%, rgb(${veil} / 0.16) ${dryAt}%, rgb(${veil} / 0) ${dryAt + 8}%)`,
          `linear-gradient(180deg, rgb(0 0 0 / 0) 58%, ${ink.deep} 100%)`,
          `linear-gradient(90deg, ${ink.deep} 0px, ${ink.base} 7px, ${ink.base} calc(100% - 9px), ${ink.deep} 100%)`,
        ].join(','),
      }

  return {
    ...paint,
    clipPath: clip,
    WebkitClipPath: clip,
    filter: 'blur(0.3px)',
    ...(blend ? { mixBlendMode: markerBlendMode(isDark) } : {}),
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

export interface MarkerStrokeProps {
  band: HighlightBand
  swatch: StickySwatch
  isDark: boolean
  seed: number
  /** Positioning (`fixed` / `absolute`) and stacking. */
  className?: string
  /**
   * False when this stroke sits in a `markerBlendMode` group. The group blends
   * the whole passage once, so line overlaps stay the same brightness.
   */
  blend?: boolean
}

/** One line of highlighter ink over a highlight band. */
export function MarkerStroke({ band, swatch, isDark, seed, className, blend = true }: MarkerStrokeProps) {
  return (
    <div
      aria-hidden
      className={cn('pointer-events-none', className)}
      style={{
        top: band.top,
        left: band.left - MARKER_OVERSHOOT,
        width: Math.max(band.width, 8) + MARKER_OVERSHOOT * 2,
        height: band.height,
        ...markerStrokeStyle(swatch, isDark, seed, blend),
      }}
    />
  )
}

export interface StickyPinButtonProps extends StickyPinProps {
  position: ViewportCorner
  label: string
  /** Positioning (`fixed` / `absolute`) and stacking. */
  className?: string
  onClick: () => void
}

/** A collapsed note stuck at a highlight's corner; opens the note. */
export function StickyPinButton({ swatch, isDark = false, index, size = 18, position, label, className, onClick }: StickyPinButtonProps) {
  return (
    <button
      type="button"
      data-plan-sticky-ui
      aria-label={label}
      className={cn('flex cursor-pointer items-center justify-center transition-[filter] hover:brightness-[1.06]', className)}
      style={{
        top: position.top,
        left: position.left,
        transform: `rotate(${index % 2 === 0 ? -3 : 2.5}deg)`,
        filter: `drop-shadow(1px 1.5px 1.5px rgb(0 0 0 / ${isDark ? 0.5 : 0.28}))`,
      }}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={onClick}
    >
      <StickyPinFace swatch={swatch} isDark={isDark} index={index} size={size} />
    </button>
  )
}

export interface StickyNoteEditorProps {
  swatch: StickySwatch
  isDark: boolean
  value: string
  placeholder: string
  /** The corner button: cancels a new note, deletes a saved one. */
  dismissLabel: string
  inputRef?: Ref<HTMLTextAreaElement>
  autoFocus?: boolean
  onChange: (text: string) => void
  onDismiss: () => void
  /** Focus left the note for anything but other sticky UI. */
  onCommit: () => void
}

/** An open Post-it the user writes a comment on. */
export function StickyNoteEditor({
  swatch, isDark, value, placeholder, dismissLabel, inputRef, autoFocus, onChange, onDismiss, onCommit,
}: StickyNoteEditorProps) {
  return (
    <StickyPaper swatch={swatch} isDark={isDark} width={202} minHeight={190}>
      <button
        type="button"
        className="absolute right-1.5 top-1 z-[1] flex size-5 items-center justify-center opacity-35 hover:opacity-80"
        style={{ color: swatch.text }}
        aria-label={dismissLabel}
        onClick={onDismiss}
      >
        <X className="size-3.5" strokeWidth={2.25} />
      </button>
      <textarea
        ref={inputRef}
        data-plan-draft
        rows={5}
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => {
          const related = e.relatedTarget as HTMLElement | null
          if (related?.closest?.(`[${STICKY_UI_ATTR}]`)) return
          onCommit()
        }}
        placeholder={placeholder}
        className="relative z-0 w-full resize-none bg-transparent text-xs leading-relaxed placeholder:opacity-40 focus:outline-none"
        style={{
          minHeight: 128,
          padding: '24px 16px 20px',
          color: swatch.text,
        }}
      />
    </StickyPaper>
  )
}
