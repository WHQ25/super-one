import { useState, useEffect, useRef, useImperativeHandle, forwardRef, useMemo, useCallback, useLayoutEffect, memo, startTransition } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { createHighlighter, type Highlighter, type ThemedToken, type GrammarState, type BundledLanguage, type BundledTheme } from 'shiki'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import { cn } from '@/lib/utils'
import { measureMaxLineWidth, getMonoFont, getMonoCharWidth, MONO_FONT_FAMILY } from '@/lib/pretext-utils'
import { codePlugin, codePluginLight } from '@/components/chat/chat-shared'
import { useIsDark } from '@/hooks/use-is-dark'

const EXT_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'tsx', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'jsx', mjs: 'javascript', cjs: 'javascript',
  py: 'python', rb: 'ruby', rs: 'rust', go: 'go', java: 'java',
  json: 'json', jsonc: 'jsonc', json5: 'json5', lock: 'json',
  yaml: 'yaml', yml: 'yaml', toml: 'toml', ini: 'ini',
  html: 'html', css: 'css', scss: 'scss', less: 'less', sass: 'sass',
  md: 'markdown', mdx: 'mdx',
  sh: 'bash', bash: 'bash', zsh: 'zsh', fish: 'fish',
  sql: 'sql', graphql: 'graphql', gql: 'graphql', prisma: 'prisma',
  swift: 'swift', kt: 'kotlin', c: 'c', cpp: 'cpp', cs: 'csharp', php: 'php',
  vue: 'vue', svelte: 'svelte', astro: 'astro',
  xml: 'xml', svg: 'xml', plist: 'xml',
  dart: 'dart', r: 'r', lua: 'lua', scala: 'scala', zig: 'zig',
  ex: 'elixir', exs: 'elixir', erl: 'erlang', hs: 'haskell', clj: 'clojure',
  tf: 'terraform', hcl: 'hcl', proto: 'protobuf',
  diff: 'diff', patch: 'diff', dockerfile: 'dockerfile',
}

const NAME_LANG: Record<string, string> = {
  dockerfile: 'dockerfile', makefile: 'makefile',
}

export function inferLanguage(filePath: string): string {
  const name = filePath.split('/').pop()?.toLowerCase() ?? ''
  if (NAME_LANG[name]) return NAME_LANG[name]
  const ext = name.split('.').pop() ?? ''
  return EXT_LANG[ext] ?? 'text'
}

const fileHLEngine = createJavaScriptRegexEngine({ forgiving: true })
let fileHLPromise: Promise<Highlighter> | null = null
const fileHLLangs = new Set<string>()
const fileHLThemes = new Set<string>()

async function getFileHighlighter(theme: string, lang: string): Promise<Highlighter> {
  if (!fileHLPromise) {
    fileHLPromise = createHighlighter({ themes: [theme as BundledTheme], langs: [lang as BundledLanguage], engine: fileHLEngine })
    fileHLLangs.add(lang)
    fileHLThemes.add(theme)
    return fileHLPromise
  }
  const hl = await fileHLPromise
  const loads: Promise<void>[] = []
  if (!fileHLThemes.has(theme)) loads.push(hl.loadTheme(theme as BundledTheme).then(() => { fileHLThemes.add(theme) }))
  if (!fileHLLangs.has(lang)) loads.push(hl.loadLanguage(lang as BundledLanguage).then(() => { fileHLLangs.add(lang) }))
  if (loads.length) await Promise.all(loads)
  return hl
}

export interface HLToken { content: string; style?: React.CSSProperties }

const HIGHLIGHT_LINE_LIMIT = 10000
const HIGHLIGHT_CHUNK_SIZE = 100


type HighlightRawToken = { content: string; color?: string; bgColor?: string; htmlStyle?: Record<string, string> }
type HighlightResult = { tokens: HighlightRawToken[][] }

const globalStyleCache = new Map<string, React.CSSProperties | undefined>()

function internStyle(t: HighlightRawToken): React.CSSProperties | undefined {
  const key = `${t.color ?? ''}|${t.bgColor ?? ''}|${t.htmlStyle ? JSON.stringify(t.htmlStyle) : ''}`
  let cached = globalStyleCache.get(key)
  if (cached !== undefined || globalStyleCache.has(key)) return cached
  const s: React.CSSProperties = { ...(t.htmlStyle ?? {}) }
  if (t.color) s.color = t.color
  if (t.bgColor) s.backgroundColor = t.bgColor
  cached = Object.keys(s).length ? s : undefined
  globalStyleCache.set(key, cached)
  return cached
}

function extractTokens(res: HighlightResult): HLToken[][] {
  return res.tokens.map((line) => line.map((t) => ({ content: t.content, style: internStyle(t) })))
}

export function useHighlightedTokens(code: string, language: string): HLToken[][] | null {
  const [tokens, setTokens] = useState<HLToken[][] | null>(null)
  const isDark = useIsDark()
  const plugin = isDark ? codePlugin : codePluginLight

  useEffect(() => {
    if (!code) { setTokens(null); return }
    const lineCount = code.split('\n').length
    if (lineCount > HIGHLIGHT_LINE_LIMIT) { setTokens(null); return }
    let cancelled = false
    const lang = plugin.supportsLanguage(language as never) ? language : 'md'
    const themes = plugin.getThemes()

    if (lineCount <= HIGHLIGHT_CHUNK_SIZE) {
      let handled = false
      const apply = (res: HighlightResult) => {
        if (cancelled || handled) return
        handled = true
        const extracted = extractTokens(res)
        startTransition(() => { if (!cancelled) setTokens(extracted) })
      }
      const idleId = requestIdleCallback(() => {
        if (cancelled) return
        const result = plugin.highlight({ code, language: lang as never, themes }, apply)
        if (result) apply(result)
      }, { timeout: 80 })
      return () => { cancelled = true; cancelIdleCallback(idleId) }
    }

    const theme = (isDark ? 'github-dark' : 'github-light') as BundledTheme
    const idleId = requestIdleCallback(() => {
      if (cancelled) return
      getFileHighlighter(theme, lang).then((hl) => {
        if (cancelled) return
        const codeLines = code.split('\n')
        const accumulated: (HLToken[] | undefined)[] = new Array(codeLines.length)
        let gramState: GrammarState | undefined

        const processChunk = (chunkIdx: number) => {
          if (cancelled) return
          const start = chunkIdx * HIGHLIGHT_CHUNK_SIZE
          if (start >= codeLines.length) return
          const end = Math.min(start + HIGHLIGHT_CHUNK_SIZE, codeLines.length)
          const chunkCode = codeLines.slice(start, end).join('\n')

          const tokens = hl.codeToTokensBase(chunkCode, { lang: lang as BundledLanguage, theme, grammarState: gramState })
          gramState = hl.getLastGrammarState(tokens) as GrammarState | undefined
          const extracted = tokens.map((line: ThemedToken[]) => line.map((t) => ({ content: t.content, style: internStyle(t as HighlightRawToken) })))
          for (let i = 0; i < extracted.length; i++) accumulated[start + i] = extracted[i]
          startTransition(() => { if (!cancelled) setTokens([...accumulated] as HLToken[][]) })
          requestIdleCallback(() => processChunk(chunkIdx + 1), { timeout: 16 })
        }
        processChunk(0)
      }).catch(() => {})
    }, { timeout: 50 })
    return () => { cancelled = true; cancelIdleCallback(idleId) }
  }, [code, language, isDark, plugin])

  return tokens
}

export interface DiffLine {
  kind: 'added' | 'removed' | 'unchanged'
  lineNum: number
  text: string
  sourceIdx: number
}

export function splitContentLines(text: string): string[] {
  if (!text) return []
  return text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n')
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
      result.push({ ...line, sourceIdx: line.kind === 'removed' ? -1 : sourceIdx++ })
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
  removed: { bg: 'bg-red-500/15', marker: '-', markerColor: 'text-red-400/60' },
  added: { bg: 'bg-green-500/15', marker: '+', markerColor: 'text-green-400/60' },
  unchanged: { bg: '', marker: ' ', markerColor: 'text-transparent' },
}

const ROW_BASE = 'absolute left-0 right-0 whitespace-pre pr-2'
const ROW_HIGHLIGHT = `${ROW_BASE} bg-yellow-400/25`
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
  removed: 'inline-block w-[1ch] select-none text-center mr-1 text-red-400/60',
  added: 'inline-block w-[1ch] select-none text-center mr-1 text-green-400/60',
  unchanged: 'inline-block w-[1ch] select-none text-center mr-1 text-transparent',
}

const ESTIMATED_LINE_HEIGHT = 20
const DIFF_LINE_HEIGHT_RATIO = 1.625
const DIFF_OVERSCAN = 8

const DiffLineRow = memo(function DiffLineRow({ line, tokens, gw, size, start, isHighlighted, wasFading }: {
  line: DiffLine
  tokens: HLToken[] | undefined
  gw: number
  size: number
  start: number
  isHighlighted: boolean
  wasFading: boolean
}) {
  const s = LINE_STYLE[line.kind]
  return (
    <div
      className={isHighlighted ? ROW_HIGHLIGHT : wasFading ? ROW_CLASS_FADE[line.kind] : ROW_CLASS[line.kind]}
      style={{ height: size, transform: `translateY(${start}px)` }}
    >
      <span className="sticky left-0 z-10 inline-block select-none bg-background text-right text-muted-foreground/50 pl-2 pr-1" style={{ width: `calc(${gw}ch + 0.75rem)` }}>
        {line.lineNum}
      </span>
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
}>(function DiffView({ lines, oldTokens, newTokens, fontSize, maxHeight, className, hideScrollbar, scrollToLine }, ref) {
  const maxLine = useMemo(() => lines.reduce((m, l) => Math.max(m, l.lineNum), 0), [lines])
  const gw = gutterWidth(maxLine)
  const [minContentWidth, setMinContentWidth] = useState('0px')
  useEffect(() => {
    if (lines.length === 0) { setMinContentWidth('0px'); return }
    const id = requestIdleCallback(() => {
      const font = fontSize ? `${fontSize}px ${MONO_FONT_FAMILY}` : getMonoFont()
      const charW = fontSize ? measureMaxLineWidth('0', font) : getMonoCharWidth()
      const gutterPx = (gw + 2) * charW + 16
      let longest = ''
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].text.length > longest.length) longest = lines[i].text
      }
      const textW = measureMaxLineWidth(longest, font)
      setMinContentWidth(`${Math.ceil(textW + gutterPx)}px`)
    }, { timeout: 100 })
    return () => cancelIdleCallback(id)
  }, [lines, gw, fontSize])

  const scrollRef = useRef<HTMLDivElement>(null)
  useImperativeHandle(ref, () => scrollRef.current!, [])
  const [estimatedLineHeight, setEstimatedLineHeight] = useState(ESTIMATED_LINE_HEIGHT)

  const updateLineHeight = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const styles = window.getComputedStyle(el)
    const fontSize = Number.parseFloat(styles.fontSize) || 11
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
  }, [scrollToLine])

  const outerClassName = useMemo(() =>
    cn('overflow-auto rounded bg-background/70 py-2 text-[11px] font-mono leading-relaxed text-foreground', maxHeight ?? 'max-h-[300px]', hideScrollbar && 'hide-scrollbar', className),
    [maxHeight, hideScrollbar, className],
  )

  return (
    <div ref={scrollRef} className={outerClassName} style={{ contain: 'inline-size' }}>
      <div className="relative min-w-full" style={{ height: virtualizer.getTotalSize(), minWidth: minContentWidth }}>
        {virtualizer.getVirtualItems().map((vItem) => {
          const line = lines[vItem.index]
          const lineTokens = line.kind === 'removed'
            ? oldTokens?.[line.sourceIdx]
            : (newTokens ?? oldTokens)?.[line.sourceIdx]
          return (
            <DiffLineRow
              key={vItem.index}
              line={line}
              tokens={lineTokens}
              gw={gw}
              size={vItem.size}
              start={vItem.start}
              isHighlighted={vItem.index === highlightIdx}
              wasFading={vItem.index === fadingIdx}
            />
          )
        })}
      </div>
    </div>
  )
})
