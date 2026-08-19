/**
 * The timeline model: every loaded record projected onto the wall clock.
 *
 * This is the view the ledger cannot give. A ledger row answers "what
 * happened next"; the timeline answers "where did the time actually go" —
 * which is the question a trajectory is usually opened to settle. The fold
 * already records `startedAt`, `durationMs`, and `ttftMs`, so nothing here
 * invents timing: a record whose duration is unknown projects as an instant,
 * never as a bar stretched to "now".
 */

import type {
  TrajectoryProjection,
  TrajectoryRecord,
  TrajectoryRecordKind,
} from '@superone/shared/trajectory-types'

/** Which of the three lanes a record occupies. */
export type TimelineLane = 0 | 1 | 2

/** One record projected onto the time domain. */
export interface TimelineSpan {
  /** The owning record's stable id. */
  id: string
  index: number
  lane: TimelineLane
  kind: TrajectoryRecordKind
  start: number
  end: number
  /**
   * When the first token arrived, for an assistant span that reported a TTFT.
   * Splits the bar into waiting and decoding rather than one opaque block.
   */
  firstToken: number | null
  isError: boolean
  label: string
}

/** One turn boundary, drawn as a rule across every lane. */
export interface TimelineBoundary {
  turn: number
  time: number
}

/** An inclusive selection in the time domain. */
export interface TimelineRange {
  start: number
  end: number
}

/** The full-domain model the overview draws. */
export interface TimelineModel extends TimelineRange {
  spans: TimelineSpan[]
  boundaries: TimelineBoundary[]
}

/**
 * The lane a record kind belongs to.
 *
 * Three lanes, not one per kind: the useful comparison is between what the
 * *user or the harness* put in, what the *model* spent, and what *tools* spent,
 * and a lane per kind would spread that comparison over rows too thin to read.
 * @param kind - the record kind.
 * @returns its lane.
 */
export function laneFor(kind: TrajectoryRecordKind): TimelineLane {
  if (kind === 'tool') return 2
  if (kind === 'message' || kind === 'compacted') return 1
  return 0
}

/**
 * Project one record onto the time domain.
 * @param record - the ledger record.
 * @returns its span.
 */
function spanFor(record: TrajectoryRecord): TimelineSpan {
  const duration = record.durationMs === null || !Number.isFinite(record.durationMs)
    ? 0
    : Math.max(0, record.durationMs)
  const ttft = record.kind === 'message' && record.ttftMs !== null && record.ttftMs >= 0
    ? record.startedAt + Math.min(record.ttftMs, duration)
    : null
  return {
    id: record.id,
    index: record.index,
    lane: laneFor(record.kind),
    kind: record.kind,
    start: record.startedAt,
    end: record.startedAt + duration,
    firstToken: ttft,
    isError: record.kind === 'tool' && record.isError,
    label: record.summary,
  }
}

/**
 * Build the timeline over a loaded window.
 * @param projection - the loaded window.
 * @returns the model, or `null` when no record carries a usable start time.
 */
export function buildTimeline(projection: TrajectoryProjection): TimelineModel | null {
  const spans: TimelineSpan[] = []
  for (const record of projection.records) {
    if (!Number.isFinite(record.startedAt)) continue
    spans.push(spanFor(record))
  }
  if (spans.length === 0) return null

  let start = Number.POSITIVE_INFINITY
  let end = Number.NEGATIVE_INFINITY
  for (const span of spans) {
    if (span.start < start) start = span.start
    if (span.end > end) end = span.end
  }

  const loaded = new Set<number>()
  for (const record of projection.records) {
    if (record.turn !== null) loaded.add(record.turn)
  }
  const boundaries = projection.turns
    .filter((turn) => loaded.has(turn.turn) && turn.startedAt >= start && turn.startedAt <= end)
    .map((turn) => ({ turn: turn.turn, time: turn.startedAt }))

  // A window where everything happened in one instant would divide by zero
  // downstream; one millisecond keeps every projection finite and honest about
  // the fact that nothing is separable at this scale.
  return { spans, boundaries, start, end: end > start ? end : start + 1 }
}

/**
 * Whether one span overlaps an inclusive range.
 *
 * Inclusive on both edges, so dragging a selection that ends exactly on a
 * record's start keeps that record — the same rule DevTools' network panel
 * uses, and the one users expect from a drag.
 * @param span - the span to test.
 * @param range - the selection.
 * @returns whether they overlap.
 */
export function spanInRange(span: TimelineSpan, range: TimelineRange): boolean {
  return span.start <= range.end && span.end >= range.start
}

/**
 * The record ids inside a range.
 * @param model - the timeline model.
 * @param range - the selection, or `null` for no filtering.
 * @returns the ids, or `null` when nothing is filtered out.
 */
export function idsInRange(model: TimelineModel, range: TimelineRange | null): Set<string> | null {
  if (range === null) return null
  const ids = new Set<string>()
  for (const span of model.spans) {
    if (spanInRange(span, range)) ids.add(span.id)
  }
  return ids
}

/**
 * Clamp a viewport to the model's domain, keeping a minimum width.
 * @param range - the proposed viewport.
 * @param model - the full domain.
 * @returns the clamped viewport.
 */
export function clampViewport(range: TimelineRange, model: TimelineModel): TimelineRange {
  const domain = model.end - model.start
  const width = Math.min(Math.max(range.end - range.start, Math.max(1, domain / 5_000)), domain)
  let start = Math.max(model.start, Math.min(range.start, model.end - width))
  if (!Number.isFinite(start)) start = model.start
  return { start, end: start + width }
}

/**
 * Tick steps a reader can do arithmetic with, in ms.
 *
 * Powers of ten interleaved with their halves and the units a clock actually
 * uses (15s, 30s, 5m). A step of "137ms" is technically evenly spaced and
 * useless: the point of a ruler is that the gap between two lines is a number
 * you already know.
 */
const TICK_STEPS = [
  1, 2, 5, 10, 25, 50, 100, 250, 500,
  1_000, 2_000, 5_000, 10_000, 15_000, 30_000,
  60_000, 120_000, 300_000, 600_000, 900_000, 1_800_000, 3_600_000,
]

/** One labelled ruler tick. */
export interface TimelineTick {
  /** Absolute time, for positioning. */
  time: number
  /** Offset from the session start, for the label. */
  offset: number
}

/**
 * The ruler for one viewport.
 *
 * Ticks are aligned to the session's own start rather than to the viewport, so
 * a label keeps its value while the view is panned or zoomed — the ruler moves
 * under the reading, not the other way round.
 * @param viewport - the visible time domain.
 * @param origin - the session start every label is measured from.
 * @param target - roughly how many labels to aim for.
 * @returns the step in ms and the ticks inside the viewport.
 */
export function timelineTicks(
  viewport: TimelineRange,
  origin: number,
  target = 6,
): { step: number; ticks: TimelineTick[] } {
  const span = Math.max(viewport.end - viewport.start, 1)
  const wanted = span / Math.max(target, 1)
  const step = TICK_STEPS.find((candidate) => candidate >= wanted) ?? TICK_STEPS[TICK_STEPS.length - 1]!

  const ticks: TimelineTick[] = []
  const firstOffset = Math.ceil((viewport.start - origin) / step) * step
  for (let offset = firstOffset; origin + offset <= viewport.end; offset += step) {
    ticks.push({ time: origin + offset, offset })
    // A viewport narrower than one step still gets its bounding tick; the guard
    // keeps a pathological span from filling memory.
    if (ticks.length > 64) break
  }
  return { step, ticks }
}

/**
 * Whether a viewport shows less than the whole domain.
 * @param viewport - the visible time domain.
 * @param model - the full domain.
 * @returns whether the view is zoomed in.
 */
export function isZoomed(viewport: TimelineRange, model: TimelineModel): boolean {
  return viewport.start > model.start || viewport.end < model.end
}

/**
 * How the overview is divided.
 *
 * Even ticks answer "how long did this take"; turn and request segments answer
 * "which turn was that" and "which call was that" — the questions a trajectory
 * is usually open for. The domain is the wall clock either way; only the marks
 * on it change.
 */
export type TimelineSegmentation = 'time' | 'turn' | 'request'

/** One labelled division of the domain. */
export interface TimelineSegment {
  key: string
  label: string
  /** The turn number or request ordinal this segment stands for. */
  ordinal: number
  start: number
  end: number
  /** Whether this segment is a compaction call rather than a generation. */
  aside?: boolean
}

/**
 * Close open-ended segments against their successor.
 *
 * A turn or call that is still running has no duration, and one that ended
 * without a recorded end has none either. Rather than inventing a length, the
 * segment runs up to whatever starts next — which is what a reader sees anyway.
 * @param raw - segments in start order, `end` possibly equal to `start`.
 * @param domainEnd - where the last open segment stops.
 * @returns the closed segments.
 */
function closeSegments(raw: TimelineSegment[], domainEnd: number): TimelineSegment[] {
  return raw.map((segment, index) => {
    if (segment.end > segment.start) return segment
    const next = raw[index + 1]?.start ?? domainEnd
    return { ...segment, end: Math.max(segment.start, next) }
  })
}

/**
 * Divide the domain the way one segmentation mode asks for.
 * @param projection - the loaded window.
 * @param mode - the segmentation to build; `time` has no segments.
 * @param model - the domain, for clipping and for closing the last segment.
 * @returns the segments, in start order.
 */
export function buildSegments(
  projection: TrajectoryProjection,
  mode: TimelineSegmentation,
  model: TimelineModel,
): TimelineSegment[] {
  if (mode === 'time') return []

  const inDomain = (start: number) => start >= model.start && start <= model.end

  if (mode === 'turn') {
    const raw = projection.turns
      .filter((turn) => inDomain(turn.startedAt))
      .sort((a, b) => a.startedAt - b.startedAt)
      .map((turn) => ({
        key: `turn:${turn.turn}`,
        label: `Turn ${turn.turn}`,
        ordinal: turn.turn,
        start: turn.startedAt,
        end: turn.startedAt + Math.max(0, turn.durationMs ?? 0),
      }))
    return closeSegments(raw, model.end)
  }

  const raw = projection.requests
    .filter((request) => inDomain(request.startedAt))
    .sort((a, b) => a.startedAt - b.startedAt)
    .map((request) => ({
      key: `request:${request.ordinal}`,
      label: `#${request.ordinal}`,
      ordinal: request.ordinal,
      start: request.startedAt,
      end: request.startedAt + Math.max(0, request.durationMs ?? 0),
      aside: request.purpose === 'compaction',
    }))
  return closeSegments(raw, model.end)
}

/**
 * The segment covering one instant.
 * @param segments - segments in start order.
 * @param time - the instant to locate.
 * @returns the segment, or `null` when the instant falls in no segment.
 */
export function segmentAt(segments: readonly TimelineSegment[], time: number): TimelineSegment | null {
  for (const segment of segments) {
    if (time < segment.start) return null
    if (time <= segment.end) return segment
  }
  return null
}

/**
 * Maps between a time and its horizontal position, in both directions.
 *
 * The overview has two different horizontal axes. In `time` mode the axis *is*
 * the wall clock, so a wide bar means a slow operation. In the segmented modes
 * the axis is ordinal — every turn or call gets the same width — because the
 * question there is "which one", and a session whose first turn ran for four
 * minutes would otherwise squeeze the twenty that followed into a sliver.
 *
 * Both directions are needed: rendering asks time-to-position, while every
 * pointer gesture asks position-to-time.
 */
export interface TimelineProjector {
  toFraction(time: number): number
  toTime(fraction: number): number
}

/** The wall-clock axis: position is proportional to elapsed time. */
export function linearProjector(viewport: TimelineRange): TimelineProjector {
  const span = Math.max(viewport.end - viewport.start, 1)
  return {
    toFraction: (time) => (time - viewport.start) / span,
    toTime: (fraction) => viewport.start + fraction * span,
  }
}

/**
 * The ordinal axis: every segment occupies the same width.
 *
 * Time between segments collapses to a point. A record that falls in a gap —
 * a message typed between turns — lands on the boundary rather than opening a
 * span of dead air that carries no segment to label it.
 * @param segments - the visible segments, in start order.
 * @param viewport - the fallback domain when there are no segments.
 * @returns the projector.
 */
export function segmentedProjector(
  segments: readonly TimelineSegment[],
  viewport: TimelineRange,
): TimelineProjector {
  const count = segments.length
  if (count === 0) return linearProjector(viewport)
  const share = 1 / count

  return {
    toFraction: (time) => {
      for (let index = 0; index < count; index += 1) {
        const segment = segments[index]!
        if (time < segment.start) return index * share
        if (time <= segment.end) {
          const width = Math.max(segment.end - segment.start, 1)
          return (index + Math.min(Math.max((time - segment.start) / width, 0), 1)) * share
        }
      }
      return 1
    },
    toTime: (fraction) => {
      const scaled = Math.min(Math.max(fraction, 0), 1) * count
      const index = Math.min(Math.floor(scaled), count - 1)
      const segment = segments[index]!
      return segment.start + (scaled - index) * (segment.end - segment.start)
    },
  }
}
