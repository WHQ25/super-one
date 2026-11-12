import { useState, useEffect, useRef, useImperativeHandle, forwardRef, useMemo, useCallback, useLayoutEffect, memo } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { cn } from '@superone/ui/lib/utils'
import { measureMaxLineWidth, getMonoFont, getMonoCharWidth, MONO_FONT_FAMILY } from '@/lib/pretext-utils'
import {
  inferLanguage,
  preloadFileHighlighter,
  useHighlightedTokens,
  useIncrementalHighlightedLines,
  type HLToken,
  type UseHighlightedTokensOptions,
} from './shiki-highlighter'
import { splitContentLines } from './text-lines'

export {
  inferLanguage,
  preloadFileHighlighter,
  useHighlightedTokens,
  useIncrementalHighlightedLines,
  splitContentLines,
  type HLToken,
  type UseHighlightedTokensOptions,
}

export interface DiffLine {
  kind: 'added' | 'removed' | 'unchanged'
  lineNum: number
  text: string
  sourceIdx: number
}

export function buildUnifiedFileChangeDiffLines(unifiedDiff: string): DiffLine[] {
  const rows = splitContentLines(unifiedDiff)
  const result: DiffLine[] = []
  let oldLine = 1
  let newLine = 1
  let oldIdx = 0
  let newIdx = 0
  let inHunk = false

  for (const row of rows) {
    if (row.startsWith('@@')) {
      const match = row.match(/^@@\s*-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s*@@/)
      if (match) {
        oldLine = Number(match[1])
        newLine = Number(match[2])
      }
      inHunk = true
      continue
    }

    if (!inHunk || row.startsWith('\\')) continue

    if (row.startsWith('+')) {
      result.push({ kind: 'added', lineNum: newLine++, text: row.slice(1), sourceIdx: newIdx++ })
      continue
    }
    if (row.startsWith('-')) {
      result.push({ kind: 'removed', lineNum: oldLine++, text: row.slice(1), sourceIdx: oldIdx++ })
      continue
    }

    const text = row.startsWith(' ') ? row.slice(1) : row
    result.push({ kind: 'unchanged', lineNum: newLine, text, sourceIdx: newIdx })
    oldLine++
    newLine++
    oldIdx++
    newIdx++
  }

  return result
}

interface DiffHunk {
  newStart: number
  newCount: number
  lines: DiffLine[]
}

function parseHunks(unifiedDiff: string): DiffHunk[] {
  const rows = splitContentLines(unifiedDiff)
  const hunks: DiffHunk[] = []
  let current: DiffHunk | null = null
  let oldLine = 1
  let newLine = 1
  let oldIdx = 0
  let newIdx = 0

  for (const row of rows) {
    if (row.startsWith('@@')) {
      const match = row.match(/^@@\s*-(\d+)(?:,\d+)?\s+\+(\d+)(?:,(\d+))?\s*@@/)
      if (match) {
        oldLine = Number(match[1])
        newLine = Number(match[2])
        const newCount = match[3] !== undefined ? Number(match[3]) : 1
        current = { newStart: newLine, newCount, lines: [] }
        hunks.push(current)
        oldIdx = 0
        newIdx = 0
      }
      continue
    }
    if (!current || row.startsWith('\\')) continue
    if (row.startsWith('+')) {
      current.lines.push({ kind: 'added', lineNum: newLine++, text: row.slice(1), sourceIdx: newIdx++ })
    } else if (row.startsWith('-')) {
      current.lines.push({ kind: 'removed', lineNum: oldLine++, text: row.slice(1), sourceIdx: oldIdx++ })
    } else {
      const text = row.startsWith(' ') ? row.slice(1) : row
      current.lines.push({ kind: 'unchanged', lineNum: newLine, text, sourceIdx: newIdx })
      oldLine++
      newLine++
      oldIdx++
      newIdx++
    }
  }
  return hunks
}

export function reconstructOldContent(newContent: string, unifiedDiff: string): string {
  if (!unifiedDiff) return newContent
  const hunks = parseHunks(unifiedDiff)
  if (hunks.length === 0) return newContent
  const lines = splitContentLines(newContent)
  for (let i = hunks.length - 1; i >= 0; i--) {
    const hunk = hunks[i]
    const oldHunkLines: string[] = []
    for (const line of hunk.lines) {
      if (line.kind === 'removed' || line.kind === 'unchanged') {
        oldHunkLines.push(line.text)
      }
    }
    lines.splice(hunk.newStart - 1, hunk.newCount, ...oldHunkLines)
  }
  return lines.join('\n')
}

export function buildFullFileWithDiff(fullContent: string, unifiedDiff: string): DiffLine[] {
  const fileLines = splitContentLines(fullContent)
  if (!unifiedDiff) {
    return fileLines.map((text, i) => ({ kind: 'unchanged' as const, lineNum: i + 1, text, sourceIdx: i }))
  }

  const hunks = parseHunks(unifiedDiff)
  if (hunks.length === 0) {
    return fileLines.map((text, i) => ({ kind: 'unchanged' as const, lineNum: i + 1, text, sourceIdx: i }))
  }

  const result: DiffLine[] = []
  let fileLineIdx = 0
  let sourceIdx = 0

  for (const hunk of hunks) {
    while (fileLineIdx < hunk.newStart - 1 && fileLineIdx < fileLines.length) {
      result.push({ kind: 'unchanged', lineNum: fileLineIdx + 1, text: fileLines[fileLineIdx], sourceIdx: sourceIdx++ })
      fileLineIdx++
    }
    for (const line of hunk.lines) {
      result.push({ ...line, sourceIdx: line.kind === 'removed' ? line.lineNum - 1 : sourceIdx++ })
      if (line.kind !== 'removed') fileLineIdx++
    }
  }

  while (fileLineIdx < fileLines.length) {
    result.push({ kind: 'unchanged', lineNum: fileLineIdx + 1, text: fileLines[fileLineIdx], sourceIdx: sourceIdx++ })
    fileLineIdx++
  }

  return result
}

export function gutterWidth(maxLine: number): number {
  return Math.max(2, String(maxLine).length)
}

export const LINE_STYLE: Record<DiffLine['kind'], { bg: string; marker: string; markerColor: string }> = {
  removed: { bg: 'bg-red-500/15', marker: '-', markerColor: 'text-red-600/60 dark:text-red-400/60' },
  added: { bg: 'bg-green-500/15', marker: '+', markerColor: 'text-green-600/60 dark:text-green-400/60' },
  unchanged: { bg: '', marker: ' ', markerColor: 'text-transparent' },
}

const ROW_BASE = 'absolute left-0 right-0 whitespace-pre pr-2'
const ROW_HIGHLIGHT = `${ROW_BASE} bg-yellow-600/25 dark:bg-yellow-400/25`
const ROW_CLASS: Record<DiffLine['kind'], string> = {
  removed: `${ROW_BASE} bg-red-500/15`,
  added: `${ROW_BASE} bg-green-500/15`,
  unchanged: ROW_BASE,
}
const ROW_CLASS_FADE: Record<DiffLine['kind'], string> = {
  removed: `${ROW_BASE} bg-red-500/15 transition-colors duration-1000`,
  added: `${ROW_BASE} bg-green-500/15 transition-colors duration-1000`,
  unchanged: `${ROW_BASE} transition-colors duration-1000`,
}
const MARKER_CLASS: Record<DiffLine['kind'], string> = {
  removed: 'inline-block w-[1ch] select-none text-center mr-1 text-red-600/60 dark:text-red-400/60',
  added: 'inline-block w-[1ch] select-none text-center mr-1 text-green-600/60 dark:text-green-400/60',
  unchanged: 'inline-block w-[1ch] select-none text-center mr-1 text-transparent',
}

const ESTIMATED_LINE_HEIGHT = 20
const DIFF_LINE_HEIGHT_RATIO = 1.625
const DIFF_OVERSCAN = 8
const DIFF_SCROLLBAR_SIZE = 6

function rowClassFor(line: DiffLine, isHighlighted: boolean, wasFading: boolean): string {
  return isHighlighted ? ROW_HIGHLIGHT : wasFading ? ROW_CLASS_FADE[line.kind] : ROW_CLASS[line.kind]
}

const DiffGutterCell = memo(function DiffGutterCell({ line, size, start, isHighlighted, wasFading }: {
  line: DiffLine
  size: number
  start: number
  isHighlighted: boolean
  wasFading: boolean
}) {
  return (
    <div
      className={rowClassFor(line, isHighlighted, wasFading)}
      style={{ height: size, transform: `translateY(${start}px)` }}
    >
      <span className="inline-block w-full select-none pr-1.5 text-right text-muted-foreground/50">{line.lineNum}</span>
    </div>
  )
})

const DiffCodeCell = memo(function DiffCodeCell({ line, tokens, size, start, isHighlighted, wasFading }: {
  line: DiffLine
  tokens: HLToken[] | undefined
  size: number
  start: number
  isHighlighted: boolean
  wasFading: boolean
}) {
  const s = LINE_STYLE[line.kind]
  return (
    <div
      data-line={line.lineNum}
      data-line-kind={line.kind}
      className={rowClassFor(line, isHighlighted, wasFading)}
      style={{ height: size, transform: `translateY(${start}px)` }}
    >
      <span className={MARKER_CLASS[line.kind]}>{s.marker}</span>
      {tokens
        ? tokens.map((t, j) => <span key={j} style={t.style}>{t.content}</span>)
        : (line.text || ' ')}
    </div>
  )
})

export const DiffView = forwardRef<HTMLDivElement, {
  lines: DiffLine[]
  oldTokens?: HLToken[][] | null
  newTokens?: HLToken[][] | null
  fontSize?: number
  maxHeight?: string
  className?: string
  hideScrollbar?: boolean
  scrollToLine?: { line: number; seq: number } | null
  autoScrollBottom?: boolean
}>(function DiffView({ lines, oldTokens, newTokens, fontSize, maxHeight, className, hideScrollbar, scrollToLine, autoScrollBottom }, ref) {
  const maxLine = useMemo(() => lines.reduce((m, l) => Math.max(m, l.lineNum), 0), [lines])
  const gw = gutterWidth(maxLine)
  const [minContentWidth, setMinContentWidth] = useState('0px')
  useEffect(() => {
    if (lines.length === 0) { setMinContentWidth('0px'); return }
    const id = requestIdleCallback(() => {
      const font = fontSize ? `${fontSize}px ${MONO_FONT_FAMILY}` : getMonoFont()
      const charW = fontSize ? measureMaxLineWidth('0', font) : getMonoCharWidth()
      let longest = ''
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].text.length > longest.length) longest = lines[i].text
      }
      const textW = measureMaxLineWidth(longest, font)
      setMinContentWidth(`${Math.ceil(textW + charW * 2 + 16)}px`)
    }, { timeout: 100 })
    return () => cancelIdleCallback(id)
  }, [lines, gw, fontSize])

  const scrollRef = useRef<HTMLDivElement>(null)
  useImperativeHandle(ref, () => scrollRef.current!, [])
  const codeColRef = useRef<HTMLDivElement>(null)
  const [scrollbarGutter, setScrollbarGutter] = useState(0)
  const [estimatedLineHeight, setEstimatedLineHeight] = useState(ESTIMATED_LINE_HEIGHT)

  const updateLineHeight = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const styles = window.getComputedStyle(el)
    const fontSize = Number.parseFloat(styles.fontSize) || 12
    const parsedLineHeight = Number.parseFloat(styles.lineHeight)
    const nextLineHeight = Number.isFinite(parsedLineHeight) && parsedLineHeight > 0
      ? parsedLineHeight
      : fontSize * DIFF_LINE_HEIGHT_RATIO
    setEstimatedLineHeight((prev) => Math.abs(prev - nextLineHeight) < 0.1 ? prev : nextLineHeight)
  }, [])

  useLayoutEffect(() => {
    updateLineHeight()
  }, [updateLineHeight, className, maxHeight, hideScrollbar])

  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimatedLineHeight,
    overscan: DIFF_OVERSCAN,
  })

  useEffect(() => {
    virtualizer.measure()
  }, [virtualizer, estimatedLineHeight, lines.length])

  useEffect(() => {
    const el = codeColRef.current
    if (!el) return
    const check = (): void => setScrollbarGutter(el.scrollWidth > el.clientWidth ? DIFF_SCROLLBAR_SIZE : 0)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [minContentWidth, lines.length])

  const [highlightIdx, setHighlightIdx] = useState<number | null>(null)
  const [fadingIdx, setFadingIdx] = useState<number | null>(null)
  const linesRef = useRef(lines)
  linesRef.current = lines
  const virtualizerRef = useRef(virtualizer)
  virtualizerRef.current = virtualizer
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    clearTimeout(highlightTimer.current)
    clearTimeout(fadeTimer.current)
    if (scrollToLine == null) { setHighlightIdx(null); setFadingIdx(null); return }
    const idx = linesRef.current.findIndex((l) => l.lineNum >= scrollToLine.line)
    if (idx >= 0) {
      virtualizerRef.current.scrollToIndex(idx, { align: 'center' })
      setHighlightIdx(idx)
      setFadingIdx(null)
      highlightTimer.current = setTimeout(() => {
        setHighlightIdx(null)
        setFadingIdx(idx)
        fadeTimer.current = setTimeout(() => setFadingIdx(null), 1100)
      }, 5000)
    }
    return () => {
      clearTimeout(highlightTimer.current)
      clearTimeout(fadeTimer.current)
    }
  }, [scrollToLine])

  useLayoutEffect(() => {
    if (!autoScrollBottom) return
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [autoScrollBottom, lines.length, virtualizer.getTotalSize()])

  const outerClassName = useMemo(() =>
    cn(
      'flex rounded bg-background/70 py-2 text-[12px] font-mono leading-relaxed text-foreground',
      autoScrollBottom ? 'overflow-hidden' : 'overflow-x-hidden overflow-y-auto',
      maxHeight ?? 'max-h-[300px]',
      hideScrollbar && 'hide-scrollbar',
      className,
    ),
    [autoScrollBottom, maxHeight, hideScrollbar, className],
  )
  const virtualItems = virtualizer.getVirtualItems()
  const totalSize = virtualizer.getTotalSize()

  return (
    <div ref={scrollRef} className={outerClassName} style={{ contain: 'inline-size' }}>
      <div className="flex" style={{ height: totalSize + scrollbarGutter, minWidth: '100%' }}>
        <div className="relative shrink-0" style={{ width: `calc(${gw}ch + 1.25rem)` }}>
          {virtualItems.map((vItem) => (
            <DiffGutterCell
              key={vItem.index}
              line={lines[vItem.index]}
              size={vItem.size}
              start={vItem.start}
              isHighlighted={vItem.index === highlightIdx}
              wasFading={vItem.index === fadingIdx}
            />
          ))}
        </div>
        <div ref={codeColRef} className="relative min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
          <div className="relative" style={{ height: totalSize, minWidth: minContentWidth }}>
            {virtualItems.map((vItem) => {
              const line = lines[vItem.index]
              const lineTokens = line.kind === 'removed'
                ? oldTokens?.[line.sourceIdx]
                : (newTokens ?? oldTokens)?.[line.sourceIdx]
              return (
                <DiffCodeCell
                  key={vItem.index}
                  line={line}
                  tokens={lineTokens}
                  size={vItem.size}
                  start={vItem.start}
                  isHighlighted={vItem.index === highlightIdx}
                  wasFading={vItem.index === fadingIdx}
                />
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
})
