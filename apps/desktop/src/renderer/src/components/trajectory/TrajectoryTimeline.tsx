import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Maximize2, MoreHorizontal } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import { formatClock, formatDuration, formatDurationRange } from './trajectory-format'
import {
  clampViewport,
  isZoomed,
  linearProjector,
  segmentAt,
  segmentedProjector,
  timelineTicks,
  type TimelineModel,
  type TimelineRange,
  type TimelineSegment,
  type TimelineSegmentation,
  type TimelineSpan,
} from './trajectory-timeline'

/** Lane height in px; three lanes plus the ruler set the overview height. */
const LANE_HEIGHT = 18

/** Height of the ruler above the lanes. */
const RULER_HEIGHT = 16

/** The segmentation modes, in the order the switch offers them. */
const SEGMENTATIONS: TimelineSegmentation[] = ['time', 'turn', 'request']

/** How far a pointer must travel before a press counts as a range drag. */
const DRAG_THRESHOLD_PX = 3

/** How long a span must be hovered before its exact timing is computed. */
const TOOLTIP_DELAY_MS = 500

/** Reserved width for the scrub readout, used to flip it at the right edge. */
const CURSOR_LABEL_WIDTH = 52

/** A hovered span plus where to anchor its readout, in track-local px. */
interface Hover {
  span: TimelineSpan
  offsetX: number
}

/**
 * An in-flight gesture.
 *
 * `anchor` is the end that stays put: the press point while a selection is
 * being drawn, and the opposite edge while one is being resized. Both then
 * reduce to "the moving end follows the pointer".
 */
interface Drag {
  kind: 'create' | 'resize'
  anchor: number
  startX: number
}

export interface TrajectoryTimelineProps {
  model: TimelineModel
  viewport: TimelineRange
  onViewportChange: (viewport: TimelineRange) => void
  /** The committed range filter, or `null` when the ledger is unfiltered. */
  range: TimelineRange | null
  onRangeChange: (range: TimelineRange | null) => void
  /** How the domain is divided. */
  segmentation: TimelineSegmentation
  onSegmentationChange: (segmentation: TimelineSegmentation) => void
  /** The divisions for the active segmentation; empty in `time` mode. */
  segments: TimelineSegment[]
  /** Whether an earlier page can still be loaded. */
  canLoadEarlier: boolean
  onLoadEarlier: () => void
  paging: boolean
  selectedId: string | null
  onSelect: (recordId: string) => void
}

/**
 * The overview: every loaded record on three lanes, over the wall clock.
 *
 * Drag selects an inclusive range and focuses the ledger on it; its edges then
 * become handles that resize it. The wheel zooms the viewport around the
 * cursor; right-click clears the selection. The full domain stays drawn while a
 * selection is active, so narrowing the ledger never costs the user their place
 * in the session.
 *
 * Every pointer gesture paints straight to the DOM and commits once on release.
 * Routing a drag through state re-renders every span in the overview on every
 * pointer frame, which is what made the scrub line stutter.
 */
export function TrajectoryTimeline({
  model,
  viewport,
  onViewportChange,
  range,
  onRangeChange,
  segmentation,
  onSegmentationChange,
  segments,
  canLoadEarlier,
  onLoadEarlier,
  paging,
  selectedId,
  onSelect,
}: TrajectoryTimelineProps) {
  const { t } = useTranslation()
  const trackRef = useRef<HTMLDivElement>(null)
  const cursorRef = useRef<HTMLDivElement>(null)
  const cursorLabelRef = useRef<HTMLSpanElement>(null)
  const highlightRef = useRef<HTMLDivElement>(null)
  const maskLeftRef = useRef<HTMLDivElement>(null)
  const maskRightRef = useRef<HTMLDivElement>(null)
  const edgeStartRef = useRef<HTMLDivElement>(null)
  const edgeEndRef = useRef<HTMLDivElement>(null)

  const [hover, setHover] = useState<Hover | null>(null)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const span = viewport.end - viewport.start

  const visible = useMemo(
    () => model.spans.filter((item) => item.end >= viewport.start && item.start <= viewport.end),
    [model.spans, viewport.start, viewport.end],
  )

  // A zoom that changes nothing but the width of the bars is hard to perceive:
  // without a ruler there is no fixed reference to read the change against.
  const ruler = useMemo(
    () => (segmentation === 'time' ? timelineTicks(viewport, model.start) : { step: 0, ticks: [] }),
    [segmentation, viewport, model.start],
  )
  const visibleSegments = useMemo(
    () => segments.filter((segment) => segment.end >= viewport.start && segment.start <= viewport.end),
    [segments, viewport.start, viewport.end],
  )
  const zoomed = isZoomed(viewport, model)

  /**
   * What the zoom is showing, against what there is.
   *
   * Stated in the active axis's own units — an elapsed span on the wall clock,
   * a run of turns or calls on the ordinal axis — and always as part over
   * whole, because "4–10s" only means something next to the 20s it is part of.
   */
  const zoomReadout = useMemo(() => {
    if (segmentation === 'time') {
      const from = viewport.start - model.start
      const to = viewport.end - model.start
      return `${formatDurationRange(from, to)} / ${formatDuration(model.end - model.start)}`
    }
    const first = visibleSegments[0]?.ordinal
    const last = visibleSegments[visibleSegments.length - 1]?.ordinal
    const range = first === undefined || last === undefined
      ? '0'
      : first === last ? `${first}` : `${first}-${last}`
    return t(`trajectory.segmentRange.${segmentation}`, { range, total: segments.length })
  }, [t, segmentation, viewport, model, visibleSegments, segments.length])

  const projector = useMemo(
    () => (segmentation === 'time'
      ? linearProjector(viewport)
      : segmentedProjector(visibleSegments, viewport)),
    [segmentation, viewport, visibleSegments],
  )
  /** Time to fraction-of-width, for absolute positioning. */
  const ratio = useCallback((time: number) => projector.toFraction(time), [projector])

  // The track's geometry, re-read when a gesture starts rather than on every
  // move: `getBoundingClientRect` forces layout, and a scrub asks for this on
  // every frame.
  const boxRef = useRef({ left: 0, width: 0 })
  const measure = useCallback(() => {
    const box = trackRef.current?.getBoundingClientRect()
    boxRef.current = { left: box?.left ?? 0, width: box?.width ?? 0 }
  }, [])

  const dragRef = useRef<Drag | null>(null)
  /** The range being drawn or resized, committed to state on release. */
  const previewRef = useRef<TimelineRange | null>(null)

  /** Pointer x to a time in the active axis. */
  const timeAt = useCallback((clientX: number): number => {
    const { left, width } = boxRef.current
    if (width === 0) return viewport.start
    return projector.toTime(Math.min(Math.max((clientX - left) / width, 0), 1))
  }, [projector, viewport.start])

  /** Paint one range's mask and edges. `null` clears the selection chrome. */
  const paintRange = useCallback((next: TimelineRange | null) => {
    const maskLeft = maskLeftRef.current
    const maskRight = maskRightRef.current
    const edgeStart = edgeStartRef.current
    const edgeEnd = edgeEndRef.current
    if (!maskLeft || !maskRight || !edgeStart || !edgeEnd) return
    if (next === null) {
      maskLeft.style.width = '0%'
      maskRight.style.width = '0%'
      for (const edge of [edgeStart, edgeEnd]) {
        edge.style.opacity = '0'
        edge.style.pointerEvents = 'none'
      }
      return
    }
    const clamp = (value: number) => Math.min(Math.max(value, 0), 1)
    const from = clamp(ratio(next.start))
    const to = clamp(ratio(next.end))
    maskLeft.style.width = `${from * 100}%`
    maskRight.style.width = `${(1 - to) * 100}%`
    edgeStart.style.left = `${from * 100}%`
    edgeEnd.style.left = `${to * 100}%`
    for (const edge of [edgeStart, edgeEnd]) {
      edge.style.opacity = '1'
      edge.style.pointerEvents = 'auto'
    }
  }, [ratio])

  /**
   * Highlight the segment under one instant.
   *
   * Segmented modes answer "which turn is this" — a question that is only
   * answered if the whole turn lights up, not the one bar the pointer happens
   * to be over.
   * @param time - the instant, or `null` to clear.
   */
  const paintHighlight = useCallback((time: number | null) => {
    const layer = highlightRef.current
    if (layer === null) return
    const segment = time === null ? null : segmentAt(segments, time)
    if (segment === null) {
      layer.style.opacity = '0'
      return
    }
    const clamp = (value: number) => Math.min(Math.max(value, 0), 1)
    const from = clamp(ratio(segment.start))
    const to = clamp(ratio(segment.end))
    layer.style.opacity = '1'
    layer.style.left = `${from * 100}%`
    layer.style.width = `${Math.max(to - from, 0) * 100}%`
  }, [segments, ratio])

  /** Move the scrub line and its readout. `null` hides them. */
  const paintCursor = useCallback((clientX: number | null) => {
    const line = cursorRef.current
    if (line === null) return
    const { left, width } = boxRef.current
    if (clientX === null || width === 0) {
      line.style.opacity = '0'
      return
    }
    const x = Math.min(Math.max(clientX - left, 0), width)
    line.style.opacity = '1'
    line.style.transform = `translateX(${x}px)`
    const label = cursorLabelRef.current
    if (label === null) return
    if (segmentation !== 'time') {
      // On the ordinal axis, position is a rank rather than an elapsed time —
      // the segment lit under the pointer already says which one it is.
      label.textContent = ''
      return
    }
    label.textContent = formatDuration(projector.toTime(x / width) - model.start)
    // Flip the readout to the other side of the line near the right edge, so it
    // never leaves the track.
    if (x > width - CURSOR_LABEL_WIDTH) label.dataset.flip = 'true'
    else delete label.dataset.flip
  }, [segmentation, projector, model.start])

  // One write per frame for the whole gesture. `requestAnimationFrame` is the
  // right scheduler here — unlike a background stream, a pointer gesture only
  // exists while the surface is visible, so it cannot be starved.
  const frameRef = useRef<number | null>(null)
  const workRef = useRef<(() => void) | null>(null)
  const schedule = useCallback((work: () => void) => {
    workRef.current = work
    if (frameRef.current !== null) return
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null
      workRef.current?.()
      workRef.current = null
    })
  }, [])

  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
  }, [])

  // Keep the painted selection in step with committed state, a zoom, or a
  // window that grew — the gesture owns the DOM only while it is running.
  useLayoutEffect(() => {
    if (dragRef.current === null) paintRange(range)
  }, [range, paintRange])

  const onPointerEnter = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    measure()
    paintCursor(event.clientX)
    paintHighlight(timeAt(event.clientX))
  }, [measure, paintCursor, paintHighlight, timeAt])

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    measure()
    event.currentTarget.setPointerCapture(event.pointerId)
    const grabbed = (event.target as HTMLElement).closest<HTMLElement>('[data-edge]')?.dataset.edge
    if (grabbed !== undefined && range !== null) {
      // Resizing pivots on the edge the user did not grab.
      dragRef.current = {
        kind: 'resize',
        anchor: grabbed === 'start' ? range.end : range.start,
        startX: event.clientX,
      }
      previewRef.current = range
      return
    }
    const time = timeAt(event.clientX)
    dragRef.current = { kind: 'create', anchor: time, startX: event.clientX }
    previewRef.current = { start: time, end: time }
  }, [measure, range, timeAt])

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    const clientX = event.clientX
    if (drag === null) {
      schedule(() => {
        paintCursor(clientX)
        paintHighlight(timeAt(clientX))
      })
      return
    }
    const moving = timeAt(clientX)
    const next = { start: Math.min(drag.anchor, moving), end: Math.max(drag.anchor, moving) }
    previewRef.current = next
    schedule(() => {
      paintCursor(clientX)
      paintHighlight(moving)
      paintRange(next)
    })
  }, [schedule, paintCursor, paintHighlight, paintRange, timeAt])

  const onPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (drag === null) return
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (drag.kind === 'create' && Math.abs(event.clientX - drag.startX) < DRAG_THRESHOLD_PX) {
      // A press without travel is a click, and a click on a filtered overview
      // is the fastest way back to the whole session.
      previewRef.current = null
      paintRange(null)
      onRangeChange(null)
      return
    }
    onRangeChange(previewRef.current)
  }, [onRangeChange, paintRange])

  // Wheel zoom is registered natively: React's synthetic wheel handler is
  // passive, so `preventDefault` there cannot stop the panel from scrolling
  // underneath the gesture.
  useEffect(() => {
    const track = trackRef.current
    if (track === null) return
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY === 0) return
      event.preventDefault()
      const box = track.getBoundingClientRect()
      if (box.width === 0) return
      boxRef.current = { left: box.left, width: box.width }
      const anchor = projector.toTime((event.clientX - box.left) / box.width)
      const factor = event.deltaY > 0 ? 1.2 : 1 / 1.2
      const width = span * factor
      const fraction = (anchor - viewport.start) / span
      onViewportChange(clampViewport(
        { start: anchor - fraction * width, end: anchor + (1 - fraction) * width },
        model,
      ))
    }
    track.addEventListener('wheel', onWheel, { passive: false })
    return () => track.removeEventListener('wheel', onWheel)
  }, [viewport.start, span, model, projector, onViewportChange])

  const beginHover = useCallback((item: TimelineSpan, clientX: number) => {
    // A running gesture owns the pointer; opening a readout mid-drag would
    // re-render the overview that the drag deliberately does not touch.
    if (dragRef.current !== null) return
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    const { left } = boxRef.current
    hoverTimer.current = setTimeout(
      () => setHover({ span: item, offsetX: Math.max(0, clientX - left) }),
      TOOLTIP_DELAY_MS,
    )
  }, [])

  const endHover = useCallback(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    setHover(null)
  }, [])

  const onPointerLeave = useCallback(() => {
    paintCursor(null)
    paintHighlight(null)
    endHover()
  }, [paintCursor, paintHighlight, endHover])

  // A mode switch invalidates whatever was lit; the next move re-lights it.
  useEffect(() => {
    paintHighlight(null)
  }, [segmentation, paintHighlight])

  /** One draggable selection edge, with the grab area a hairline cannot offer. */
  const edge = (side: 'start' | 'end', ref: React.RefObject<HTMLDivElement | null>) => (
    <div
      ref={ref}
      data-edge={side}
      className="absolute inset-y-0 left-0 z-[2] w-px bg-primary opacity-0"
      style={{ pointerEvents: 'none' }}
    >
      <div className="absolute inset-y-0 -left-[3px] w-[7px] cursor-col-resize" data-edge={side} />
      <div className="absolute -top-px -left-px h-1.5 w-[3px] rounded-[1px] bg-primary" data-edge={side} />
      <div className="absolute -bottom-px -left-px h-1.5 w-[3px] rounded-[1px] bg-primary" data-edge={side} />
    </div>
  )

  return (
    <div className="relative shrink-0 border-b border-border bg-muted/15 px-2 py-1.5">
      <div className="relative w-full select-none" style={{ height: RULER_HEIGHT }}>
        {ruler.ticks.map((tick) => (
          <div
            key={tick.offset}
            aria-hidden
            className="absolute bottom-0 top-1 border-l border-border/70"
            style={{ left: `${ratio(tick.time) * 100}%` }}
          >
            <span className="absolute bottom-[1px] left-1 whitespace-nowrap font-mono text-[9px] leading-none text-muted-foreground/70">
              {formatDuration(tick.offset)}
            </span>
          </div>
        ))}

        {visibleSegments.map((segment) => {
          const from = ratio(segment.start)
          const to = ratio(segment.end)
          return (
            <div
              key={segment.key}
              aria-hidden
              className={cn(
                'absolute bottom-0 top-1 overflow-hidden border-l border-border/70',
                segment.aside && 'border-dashed',
              )}
              style={{ left: `${from * 100}%`, width: `${Math.max(to - from, 0) * 100}%` }}
            >
              <span className="block truncate pl-1 font-mono text-[9px] leading-[11px] text-muted-foreground/70">
                {segment.label}
              </span>
            </div>
          )
        })}

        <div className="absolute right-0 top-0 flex items-center gap-1">
          {zoomed && (
            <button
              type="button"
              onClick={() => onViewportChange({ start: model.start, end: model.end })}
              title={t('trajectory.resetZoom')}
              className={cn(
                'flex items-center gap-1 rounded-sm bg-card/90 px-1',
                'font-mono text-[9px] leading-[14px] text-muted-foreground hover:text-foreground',
              )}
            >
              <Maximize2 className="size-2.5" />
              {zoomReadout}
            </button>
          )}
          <div
            role="group"
            aria-label={t('trajectory.segmentAria')}
            className="flex items-center gap-0.5 rounded-sm bg-card/90 px-0.5"
          >
            {SEGMENTATIONS.map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={segmentation === mode}
                onClick={() => onSegmentationChange(mode)}
                className={cn(
                  'rounded-[2px] px-1 font-mono text-[9px] leading-[14px] transition-colors',
                  segmentation === mode
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground/70 hover:text-foreground',
                )}
              >
                {t(`trajectory.segment.${mode}`)}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div
        ref={highlightRef}
        aria-hidden
        className="pointer-events-none absolute inset-y-1.5 left-0 w-0 rounded-sm bg-primary/10 opacity-0"
      />

      <div
        ref={trackRef}
        role="presentation"
        className="relative w-full cursor-crosshair select-none"
        style={{ height: LANE_HEIGHT * 3 }}
        onPointerEnter={onPointerEnter}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerLeave}
        onContextMenu={(event) => {
          event.preventDefault()
          paintRange(null)
          onRangeChange(null)
        }}
      >
        {model.boundaries.map((boundary) => (
          <div
            key={boundary.turn}
            aria-hidden
            className="pointer-events-none absolute top-0 bottom-0 w-px bg-border"
            style={{ left: `${ratio(boundary.time) * 100}%` }}
          />
        ))}

        {visible.map((item) => {
          const left = ratio(item.start)
          const width = Math.max(ratio(item.end) - left, 0)
          const decoding = item.firstToken === null ? null : ratio(item.firstToken) - left
          return (
            <button
              type="button"
              key={item.id}
              aria-label={item.label}
              onClick={() => onSelect(item.id)}
              onPointerEnter={(event) => beginHover(item, event.clientX)}
              onPointerLeave={endHover}
              className={cn(
                'absolute rounded-[1px]',
                item.id === selectedId && 'ring-1 ring-primary',
              )}
              style={{
                left: `${left * 100}%`,
                width: `max(2px, ${width * 100}%)`,
                top: item.lane * LANE_HEIGHT + 3,
                height: LANE_HEIGHT - 6,
              }}
            >
              <span
                aria-hidden
                className={cn(
                  'absolute inset-0 rounded-[1px]',
                  item.isError && 'bg-destructive/70',
                  !item.isError && item.lane === 0 && 'bg-muted-foreground/40',
                  // Waiting for the first token, drawn lighter than decoding so
                  // a slow provider and a long answer never look alike.
                  !item.isError && item.lane === 1 && (decoding === null ? 'bg-primary/55' : 'bg-primary/20'),
                  !item.isError && item.lane === 2 && 'bg-foreground/30',
                )}
              />
              {decoding !== null && !item.isError && (
                <span
                  aria-hidden
                  className="absolute inset-y-0 right-0 rounded-[1px] bg-primary/70"
                  style={{ left: `${width === 0 ? 0 : Math.min(Math.max(decoding / width, 0), 1) * 100}%` }}
                />
              )}
            </button>
          )
        })}

        <div
          ref={maskLeftRef}
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 w-0 bg-card/70"
        />
        <div
          ref={maskRightRef}
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 w-0 bg-card/70"
        />
        {edge('start', edgeStartRef)}
        {edge('end', edgeEndRef)}

        <div
          ref={cursorRef}
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 z-[1] w-px bg-foreground/50 opacity-0"
        >
          <span
            ref={cursorLabelRef}
            className={cn(
              'absolute -top-px left-1 rounded-sm bg-card px-1 font-mono text-[9px] leading-[13px]',
              'text-muted-foreground data-[flip=true]:left-auto data-[flip=true]:right-1',
            )}
          />
        </div>

        {canLoadEarlier && (
          <button
            type="button"
            aria-label={t('trajectory.loadEarlier')}
            title={t('trajectory.loadEarlier')}
            disabled={paging}
            // Scrubbing across the truncation control would read its position
            // as a time in a domain that is not loaded yet.
            onPointerEnter={() => paintCursor(null)}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onLoadEarlier}
            className={cn(
              'absolute left-0 top-0 bottom-0 z-[3] flex w-5 items-center justify-center',
              'bg-gradient-to-r from-card to-transparent text-muted-foreground',
              'hover:text-foreground disabled:opacity-50',
            )}
          >
            <MoreHorizontal className="size-3.5" />
          </button>
        )}
      </div>

      {hover !== null && (
        <div
          role="tooltip"
          className={cn(
            'pointer-events-none absolute z-10 min-w-40 rounded-md border border-border',
            'bg-popover px-2 py-1.5 font-mono text-[10px] leading-4 text-popover-foreground shadow-md',
          )}
          style={{ top: LANE_HEIGHT * 3 + 8, left: hover.offsetX }}
        >
          <div className="truncate font-sans text-[11px]">{hover.span.label}</div>
          <div>{formatClock(hover.span.start)} → {formatClock(hover.span.end)}</div>
          <div>
            {t('trajectory.inspector.duration')}: {formatDuration(hover.span.end - hover.span.start)}
          </div>
          {hover.span.firstToken !== null && (
            <div>
              {t('trajectory.inspector.ttft')}: {formatDuration(hover.span.firstToken - hover.span.start)}
              {' · '}
              {t('trajectory.decode')}: {formatDuration(hover.span.end - hover.span.firstToken)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
