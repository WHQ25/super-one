import { useRef } from 'react'

/** A labelled stop on a `CommitSlider`. Pressing it seeks when the slider seeks, and commits otherwise. */
export interface CommitSliderMark {
  value: number
  label: string
}

/** The thumb's centre runs from half its size in from either end, not edge to edge. */
const THUMB_PX = 16
/** Movement below this is a click. A fast drag still follows the pointer. */
const POINTER_SLOP_PX = 4

/**
 * A stepped slider that drafts while dragged and commits once on release, because
 * every commit is a device command that takes a while to land.
 * With `onSeek`, a press that never moves travels to where it landed instead of jumping.
 */
export function CommitSlider({ min = 0, max, value, disabled, label, valueText, marks, onDraft, onCommit, onSeek }: {
  min?: number
  max: number
  value: number
  disabled: boolean
  label: string
  valueText?: string
  marks?: readonly CommitSliderMark[]
  onDraft: (value: number) => void
  onCommit: (value: number) => void
  /** A click, as opposed to a drag. The thumb stays until this moves it. */
  onSeek?: (value: number) => void
}) {
  const fraction = (at: number) => max > min ? (at - min) / (max - min) : 0
  const under = (at: number) => `calc(${THUMB_PX / 2}px + (100% - ${THUMB_PX}px) * ${fraction(at)})`
  const gesture = useRef<{ x: number; y: number; moved: boolean; pending: number | null } | null>(null)
  const commit = (event: { currentTarget: HTMLInputElement }) => onCommit(Number(event.currentTarget.value))
  const endPointer = (event: { currentTarget: HTMLInputElement; pointerId: number }, cancelled: boolean) => {
    const current = gesture.current
    gesture.current = null
    const node = event.currentTarget
    if (current && node.hasPointerCapture?.(event.pointerId)) node.releasePointerCapture(event.pointerId)
    if (cancelled) {
      if (current?.moved) commit(event)
      return
    }
    if (onSeek && current && !current.moved && current.pending !== null) {
      onSeek(current.pending)
      return
    }
    commit(event)
  }
  return <div>
    <div className="relative flex h-6 items-center">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 h-1.5 rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${fraction(value) * 100}%` }} />
      </div>
      {marks?.map((mark) => <span key={mark.value} aria-hidden="true"
        className="pointer-events-none absolute h-3 w-px -translate-x-1/2 bg-muted-foreground/60"
        style={{ left: under(mark.value) }} />)}
      <input type="range" min={min} max={max} step={1} value={value} disabled={disabled}
        aria-label={label} aria-valuetext={valueText}
        onPointerDown={(event) => {
          if (!onSeek) return
          gesture.current = { x: event.clientX, y: event.clientY, moved: false, pending: null }
          try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* already released */ }
        }}
        onPointerMove={(event) => {
          const current = gesture.current
          if (!current || current.moved) return
          if (Math.hypot(event.clientX - current.x, event.clientY - current.y) < POINTER_SLOP_PX) return
          current.moved = true
          if (current.pending !== null) onDraft(current.pending)
        }}
        onChange={(event) => {
          const next = Number(event.currentTarget.value)
          const current = gesture.current
          if (onSeek && current && !current.moved) {
            current.pending = next
            // A controlled thumb would otherwise flash to the click before the seek starts.
            event.currentTarget.value = String(value)
            return
          }
          onDraft(next)
        }}
        onPointerUp={(event) => endPointer(event, false)}
        onPointerCancel={(event) => endPointer(event, true)}
        onKeyUp={commit} onBlur={commit}
        className="relative h-6 w-full cursor-pointer appearance-none bg-transparent disabled:cursor-not-allowed disabled:opacity-50 [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-primary [&::-moz-range-thumb]:bg-card [&::-moz-range-track]:h-1.5 [&::-moz-range-track]:bg-transparent [&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-thumb]:-mt-[5px] [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-primary [&::-webkit-slider-thumb]:bg-card" />
    </div>
    {marks && <div className="relative h-4 text-[11px] text-muted-foreground">
      {marks.map((mark) => {
        // The end labels sit inside the track rather than centred past its ends.
        const end = fraction(mark.value)
        return <button key={mark.value} type="button" disabled={disabled}
          onClick={() => { if (onSeek) onSeek(mark.value); else { onDraft(mark.value); onCommit(mark.value) } }}
          className="absolute whitespace-nowrap hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
          style={end <= 0 ? { left: 0 } : end >= 1 ? { right: 0 } : { left: under(mark.value), transform: 'translateX(-50%)' }}
        >{mark.label}</button>
      })}
    </div>}
  </div>
}
