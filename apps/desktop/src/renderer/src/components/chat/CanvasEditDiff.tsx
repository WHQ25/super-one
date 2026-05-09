import { useEffect, useMemo, useRef } from 'react'
import { gutterWidth, inferLanguage, useHighlightedTokens, useIncrementalHighlightedLines, type HLToken } from '@/lib/diff-utils'
import { getHighlightCache } from '@/lib/highlight-cache'
import { useChatStore } from '@/stores/chat'
import { getMonoCharWidth, MONO_FONT_FAMILY } from '@/lib/pretext-utils'
import { useIsDark } from '@/hooks/use-is-dark'

export type LineEvent =
  | { kind: 'match'; newLineIdx: number; oldLineIdx: number; text: string }
  | { kind: 'added'; newLineIdx: number; text: string }
  | { kind: 'deleted'; oldLineIdx: number; text: string }

export function greedyLineDiff(oldLines: string[], newLines: string[], streamDone: boolean): LineEvent[] {
  const events: LineEvent[] = []
  let cursor = 0
  for (let i = 0; i < newLines.length; i++) {
    const n = newLines[i]
    let foundIdx = -1
    for (let j = cursor; j < oldLines.length; j++) {
      if (oldLines[j] === n) { foundIdx = j; break }
    }
    if (foundIdx >= 0) {
      for (let k = cursor; k < foundIdx; k++) {
        events.push({ kind: 'deleted', oldLineIdx: k, text: oldLines[k] })
      }
      events.push({ kind: 'match', newLineIdx: i, oldLineIdx: foundIdx, text: n })
      cursor = foundIdx + 1
    } else {
      events.push({ kind: 'added', newLineIdx: i, text: n })
    }
  }
  if (streamDone) {
    for (let k = cursor; k < oldLines.length; k++) {
      events.push({ kind: 'deleted', oldLineIdx: k, text: oldLines[k] })
    }
  }
  return events
}

export function snapCommittedLines(newStr: string, isDone: boolean): string[] {
  if (!newStr) return []
  if (isDone) {
    const all = newStr.split('\n')
    if (all.length > 0 && all[all.length - 1] === '') all.pop()
    return all
  }
  const idx = newStr.lastIndexOf('\n')
  if (idx === -1) return []
  return newStr.slice(0, idx).split('\n')
}

export type DisplayLineKind = 'match' | 'added' | 'deleted' | 'oldPending'

export interface DisplayLine {
  key: string
  kind: DisplayLineKind
  text: string
  lineNum: number
  tokens?: HLToken[]
}

export function buildDisplayLines(
  events: LineEvent[],
  oldLines: string[],
  oldTokens: HLToken[][] | null,
  newTokens: HLToken[][] | null,
): DisplayLine[] {
  const lines: DisplayLine[] = []
  let oldCursor = 0
  let displayLineNum = 1
  for (const e of events) {
    if (e.kind === 'match') {
      lines.push({
        key: `old:${e.oldLineIdx}`,
        kind: 'match',
        text: e.text,
        lineNum: displayLineNum++,
        tokens: newTokens?.[e.newLineIdx] ?? oldTokens?.[e.oldLineIdx],
      })
      oldCursor = e.oldLineIdx + 1
    } else if (e.kind === 'added') {
      lines.push({
        key: `new:${e.newLineIdx}`,
        kind: 'added',
        text: e.text,
        lineNum: displayLineNum++,
        tokens: newTokens?.[e.newLineIdx],
      })
    } else {
      lines.push({
        key: `old:${e.oldLineIdx}`,
        kind: 'deleted',
        text: e.text,
        lineNum: displayLineNum++,
        tokens: oldTokens?.[e.oldLineIdx],
      })
      oldCursor = e.oldLineIdx + 1
    }
  }
  for (let k = oldCursor; k < oldLines.length; k++) {
    lines.push({
      key: `old:${k}`,
      kind: 'oldPending',
      text: oldLines[k],
      lineNum: displayLineNum++,
      tokens: oldTokens?.[k],
    })
  }
  return lines
}

const FONT_SIZE = 11
const LINE_HEIGHT = FONT_SIZE * 1.625
const PAD_X = 8
const PAD_Y = 8
const GUTTER_LEFT_PAD = 8
const GUTTER_RIGHT_PAD = 4
const MARKER_WIDTH_CH = 1
const MARKER_RIGHT_PAD = 4

const BG_ADDED_MAX = 0.15
const BG_DELETED_MAX = 0.15
const MARKER_ALPHA_MAX = 0.6

const TYPE_SPEED_MS_PER_CHAR = 10
const CATCH_UP_FRAMES = 4
const MAX_CHARS_PER_LINE_PER_FRAME = 6

const MAX_CANVAS_LINES = 40

function useStableTokens(current: HLToken[][] | null): HLToken[][] | null {
  const ref = useRef<HLToken[][] | null>(null)
  if (current) ref.current = current
  return current ?? ref.current
}

interface AnimatedLine {
  key: string
  kind: DisplayLineKind
  text: string
  tokens?: HLToken[]
  lineNum: number
  y: number
  textCharsShown: number
  textCharsTarget: number
}

function reconcileLines(prev: AnimatedLine[], target: DisplayLine[]): AnimatedLine[] {
  const prevByKey = new Map(prev.map((l) => [l.key, l]))
  const result: AnimatedLine[] = []
  for (let i = 0; i < target.length; i++) {
    const t = target[i]
    const y = PAD_Y + i * LINE_HEIGHT
    const existing = prevByKey.get(t.key)
    if (existing) {
      existing.y = y
      existing.kind = t.kind
      existing.lineNum = t.lineNum
      existing.tokens = t.tokens
      if (existing.text !== t.text) {
        existing.text = t.text
        existing.textCharsTarget = t.text.length
        if (existing.textCharsShown > existing.textCharsTarget) {
          existing.textCharsShown = existing.textCharsTarget
        }
      }
      result.push(existing)
    } else {
      const isAdded = t.kind === 'added'
      const isOldPending = t.kind === 'oldPending'
      const typewriter = isAdded || isOldPending
      result.push({
        key: t.key,
        kind: t.kind,
        text: t.text,
        tokens: t.tokens,
        lineNum: t.lineNum,
        y,
        textCharsShown: typewriter ? 0 : t.text.length,
        textCharsTarget: t.text.length,
      })
    }
  }
  return result
}

function advanceAnimations(lines: AnimatedLine[], dt: number): void {
  let backlog = 0
  for (const line of lines) {
    backlog += Math.max(0, line.textCharsTarget - line.textCharsShown)
  }

  const naturalBudget = dt / TYPE_SPEED_MS_PER_CHAR
  const catchUpBudget = backlog / CATCH_UP_FRAMES
  let budget = Math.max(naturalBudget, catchUpBudget)
  for (const line of lines) {
    if (budget <= 0) break
    const want = line.textCharsTarget - line.textCharsShown
    if (want <= 0) continue
    const used = Math.min(want, budget, MAX_CHARS_PER_LINE_PER_FRAME)
    line.textCharsShown += used
    budget -= used
  }
}

function computeLayout(lines: AnimatedLine[], charWidth: number): {
  gw: number
  gutterTextRight: number
  markerColX: number
  textColX: number
  maxTextWidth: number
} {
  const gw = gutterWidth(Math.max(1, lines.length))
  const gutterTextLeft = GUTTER_LEFT_PAD
  const gutterTextRight = gutterTextLeft + gw * charWidth
  const markerColX = gutterTextRight + GUTTER_RIGHT_PAD
  const textColX = markerColX + MARKER_WIDTH_CH * charWidth + MARKER_RIGHT_PAD
  let maxTextWidth = 0
  for (const l of lines) {
    const w = l.text.length * charWidth
    if (w > maxTextWidth) maxTextWidth = w
  }
  return { gw, gutterTextRight, markerColX, textColX, maxTextWidth }
}

function renderFrame(
  canvas: HTMLCanvasElement,
  container: HTMLDivElement,
  lines: AnimatedLine[],
  now: number,
  isDark: boolean,
  inEditPhase: boolean,
): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const charWidth = getMonoCharWidth()
  const layout = computeLayout(lines, charWidth)

  const cssWidth = Math.max(1, container.clientWidth)
  const cssHeight = Math.max(
    LINE_HEIGHT + PAD_Y * 2,
    Math.ceil(PAD_Y + lines.length * LINE_HEIGHT + PAD_Y),
  )
  const dpr = window.devicePixelRatio || 1
  const targetW = Math.ceil(cssWidth * dpr)
  const targetH = Math.ceil(cssHeight * dpr)
  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW
    canvas.height = targetH
    canvas.style.width = `${cssWidth}px`
    canvas.style.height = `${cssHeight}px`
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, cssWidth, cssHeight)
  ctx.font = `${FONT_SIZE}px ${MONO_FONT_FAMILY}`
  ctx.textBaseline = 'alphabetic'

  const defaultColor = isDark ? '#c9d1d9' : '#24292e'
  const gutterColor = isDark ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.35)'
  const baselineOffset = FONT_SIZE + (LINE_HEIGHT - FONT_SIZE) / 2 - 1

  let cursorX = -1
  let cursorY = -1

  for (const line of lines) {
    const y = line.y
    const baselineY = y + baselineOffset

    if (line.kind === 'added') {
      ctx.fillStyle = `rgba(34,197,94,${BG_ADDED_MAX})`
      ctx.fillRect(layout.markerColX, y, cssWidth - layout.markerColX, LINE_HEIGHT)
    } else if (line.kind === 'deleted') {
      ctx.fillStyle = `rgba(239,68,68,${BG_DELETED_MAX})`
      ctx.fillRect(layout.markerColX, y, cssWidth - layout.markerColX, LINE_HEIGHT)
    }

    ctx.fillStyle = gutterColor
    const lineNumStr = String(line.lineNum)
    const lineNumX = layout.gutterTextRight - lineNumStr.length * charWidth
    ctx.fillText(lineNumStr, lineNumX, baselineY)

    if (line.kind === 'added') {
      ctx.fillStyle = `rgba(74,222,128,${MARKER_ALPHA_MAX})`
      ctx.fillText('+', layout.markerColX, baselineY)
    } else if (line.kind === 'deleted') {
      ctx.fillStyle = `rgba(248,113,113,${MARKER_ALPHA_MAX})`
      ctx.fillText('-', layout.markerColX, baselineY)
    }

    const charsShown = Math.floor(line.textCharsShown)
    const tokens = line.tokens
    let xOffset = 0
    if (tokens && tokens.length > 0) {
      let charsDrawn = 0
      for (const tk of tokens) {
        if (charsDrawn >= charsShown) break
        const color = ((tk.style as React.CSSProperties | undefined)?.color as string | undefined) ?? defaultColor
        ctx.fillStyle = color
        const remaining = charsShown - charsDrawn
        const content = tk.content.length <= remaining ? tk.content : tk.content.slice(0, remaining)
        if (content.length > 0) ctx.fillText(content, layout.textColX + xOffset, baselineY)
        xOffset += tk.content.length * charWidth
        charsDrawn += tk.content.length
      }
    } else {
      ctx.fillStyle = defaultColor
      const visible = line.text.slice(0, charsShown)
      if (visible.length > 0) ctx.fillText(visible, layout.textColX, baselineY)
    }
  }

  let typingIdx = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].textCharsShown < lines[i].textCharsTarget) { typingIdx = i; break }
  }
  if (typingIdx >= 0) {
    const l = lines[typingIdx]
    cursorX = layout.textColX + l.textCharsShown * charWidth
    cursorY = l.y
  } else if (lines.length > 0) {
    if (inEditPhase) {
      const firstPendingIdx = lines.findIndex((l) => l.kind === 'oldPending')
      if (firstPendingIdx >= 0) {
        cursorX = layout.textColX
        cursorY = lines[firstPendingIdx].y
      } else {
        const last = lines[lines.length - 1]
        cursorX = layout.textColX + last.text.length * charWidth
        cursorY = last.y
      }
    } else {
      const last = lines[lines.length - 1]
      cursorX = layout.textColX + last.text.length * charWidth
      cursorY = last.y
    }
  }

  if (cursorX >= 0 && cursorY >= 0) {
    const blink = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(now * 2 * Math.PI / 700))
    ctx.fillStyle = isDark ? `rgba(255,179,102,${blink})` : `rgba(200,80,20,${blink})`
    ctx.fillRect(cursorX, cursorY + 2, 2, LINE_HEIGHT - 4)
  }

  if (cursorY >= 0) {
    const margin = LINE_HEIGHT
    const visibleTop = container.scrollTop
    const visibleBottom = visibleTop + container.clientHeight
    const cursorBottom = cursorY + LINE_HEIGHT
    if (cursorBottom > visibleBottom - margin) {
      container.scrollTop = cursorBottom - container.clientHeight + margin
    } else if (cursorY < visibleTop + margin) {
      container.scrollTop = Math.max(0, cursorY - margin)
    }
  }
}

interface CanvasEditDiffProps {
  params: Record<string, unknown>
}

export function CanvasEditDiff({ params }: CanvasEditDiffProps) {
  const oldStr = String(params.old_string ?? '')
  const newStr = String(params.new_string ?? '')
  const filePath = String(params.file_path ?? '')
  const language = inferLanguage(filePath)
  const isDark = useIsDark()

  const newStringFieldStarted = 'new_string' in params && params.new_string !== undefined
  const inEditPhase = newStringFieldStarted

  const fullOldLines = useMemo(() => {
    if (!oldStr) return []
    const stripped = oldStr.replace(/\n$/, '')
    return stripped.split('\n')
  }, [oldStr])
  const committedOldStr = useMemo(() => {
    if (!oldStr) return ''
    const lastNewline = oldStr.lastIndexOf('\n')
    if (lastNewline === -1) return ''
    return oldStr.slice(0, lastNewline + 1)
  }, [oldStr])
  const committedNewLines = useMemo(() => snapCommittedLines(newStr, false), [newStr])
  const events = useMemo(
    () => greedyLineDiff(fullOldLines, committedNewLines, false),
    [fullOldLines, committedNewLines],
  )

  const activeProject = useChatStore((s) => s.activeProject)
  const cache = useMemo(() => getHighlightCache(activeProject), [activeProject])
  const oldTokensFresh = useHighlightedTokens(committedOldStr, language, { cache })
  const newTokensFresh = useIncrementalHighlightedLines(committedNewLines, language)
  const oldTokens = useStableTokens(oldTokensFresh)
  const newTokens = useStableTokens(newTokensFresh)

  const displayLines = useMemo<DisplayLine[]>(() => {
    const all = !inEditPhase
      ? fullOldLines.map((text, i) => ({
          key: `old:${i}`,
          kind: 'oldPending' as const,
          text,
          lineNum: i + 1,
          tokens: oldTokens?.[i],
        }))
      : buildDisplayLines(events, fullOldLines, oldTokens, newTokens)
    if (all.length <= MAX_CANVAS_LINES) return all
    if (!inEditPhase) return all.slice(-MAX_CANVAS_LINES)
    const half = Math.floor(MAX_CANVAS_LINES / 2)
    const startIdx = Math.max(0, Math.min(all.length - MAX_CANVAS_LINES, events.length - half))
    return all.slice(startIdx, startIdx + MAX_CANVAS_LINES)
  }, [inEditPhase, events, fullOldLines, oldTokens, newTokens])

  const animatedLinesRef = useRef<AnimatedLine[]>([])
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.app?.trace?.('canvas-edit', 'mount', {})
    return () => { window.app?.trace?.('canvas-edit', 'unmount', {}) }
  }, [])

  useEffect(() => {
    animatedLinesRef.current = reconcileLines(animatedLinesRef.current, displayLines)
  }, [displayLines])

  const inEditPhaseRef = useRef(inEditPhase)
  inEditPhaseRef.current = inEditPhase

  useEffect(() => {
    let last = performance.now()
    let rafId = 0
    const tick = (now: number): void => {
      const dt = Math.min(64, now - last)
      last = now
      advanceAnimations(animatedLinesRef.current, dt)
      const canvas = canvasRef.current
      const container = containerRef.current
      if (canvas && container) renderFrame(canvas, container, animatedLinesRef.current, now, isDark, inEditPhaseRef.current)
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [isDark])

  if (!oldStr && !newStr) return null

  return (
    <div
      ref={containerRef}
      className="rounded bg-background/70 text-[11px] font-mono leading-relaxed text-foreground overflow-hidden max-h-[300px]"
      style={{ contain: 'inline-size' }}
    >
      <canvas ref={canvasRef} className="block" />
    </div>
  )
}
