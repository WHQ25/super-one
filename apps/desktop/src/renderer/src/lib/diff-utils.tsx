import { useState, useEffect, useRef, useImperativeHandle, forwardRef, useMemo, useCallback, useLayoutEffect, memo, startTransition } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { createHighlighter, type Highlighter, type ThemedToken, type GrammarState, type BundledLanguage, type BundledTheme } from 'shiki'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import { cn } from '@superone/ui/lib/utils'
import { measureMaxLineWidth, getMonoFont, getMonoCharWidth, MONO_FONT_FAMILY } from '@/lib/pretext-utils'
import { codePlugin, codePluginLight } from '@/components/chat/chat-shared'
import { useIsDark } from '@/hooks/use-is-dark'
import { buildHighlightKey, type HighlightCache } from './highlight-cache'

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

export interface HLToken { content: string; style?: React.CSSProperties }

const HIGHLIGHT_LINE_LIMIT = 10000
const HIGHLIGHT_CHUNK_SIZE = 100

const COMPANION_LANGS: Record<string, string[]> = {
  html: ['javascript', 'css'],
  vue: ['javascript', 'typescript', 'css', 'html'],
  svelte: ['javascript', 'typescript', 'css'],
  astro: ['javascript', 'typescript', 'css'],
  mdx: ['javascript', 'typescript'],
}

function hasCompanions(lang: string): boolean {
  return (COMPANION_LANGS[lang]?.length ?? 0) > 0
}

function langsToLoad(lang: string): string[] {
  const companions = COMPANION_LANGS[lang] ?? []
  return [lang, ...companions]
}

const fileHLEngine = createJavaScriptRegexEngine({ forgiving: true })
let fileHLPromise: Promise<Highlighter> | null = null
let fileHLResolved: Highlighter | null = null
const fileHLLangs = new Set<string>()
const fileHLThemes = new Set<string>()

function getFileHighlighterSync(theme: string, lang: string): Highlighter | null {
  if (!fileHLResolved) return null
  if (!fileHLThemes.has(theme)) return null
  for (const l of langsToLoad(lang)) {
    if (!fileHLLangs.has(l)) return null
  }
  return fileHLResolved
}

async function getFileHighlighter(theme: string, lang: string): Promise<Highlighter> {
  const required = langsToLoad(lang)
  if (!fileHLPromise) {
    fileHLPromise = createHighlighter({ themes: [theme as BundledTheme], langs: required as BundledLanguage[], engine: fileHLEngine })
    required.forEach((l) => fileHLLangs.add(l))
    fileHLThemes.add(theme)
    fileHLResolved = await fileHLPromise
    return fileHLResolved
  }
  const hl = await fileHLPromise
  fileHLResolved = hl
  const loads: Promise<void>[] = []
  if (!fileHLThemes.has(theme)) loads.push(hl.loadTheme(theme as BundledTheme).then(() => { fileHLThemes.add(theme) }))
  for (const l of required) {
    if (!fileHLLangs.has(l)) loads.push(hl.loadLanguage(l as BundledLanguage).then(() => { fileHLLangs.add(l) }))
  }
  if (loads.length) await Promise.all(loads)
  return hl
}

const PRELOAD_LANGS = ['typescript', 'python', 'javascript', 'markdown', 'json']

export function preloadFileHighlighter(): void {
  for (const theme of ['github-dark', 'github-light']) {
    for (const lang of PRELOAD_LANGS) {
      getFileHighlighter(theme, lang).catch(() => {})
    }
  }
}

type HighlightRawToken = { content: string; color?: string; bgColor?: string; htmlStyle?: Record<string, string> }

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

function resolveHighlightLanguage(plugin: { supportsLanguage(lang: never): boolean }, language: string): string {
  return plugin.supportsLanguage(language as never) ? language : 'md'
}

function toHLTokens(tokens: ThemedToken[][]): HLToken[][] {
  return tokens.map((line) => line.map((t) => ({ content: t.content, style: internStyle(t as HighlightRawToken) })))
}

export interface UseHighlightedTokensOptions {
  cache?: HighlightCache | null
}

export function useHighlightedTokens(code: string, language: string, options?: UseHighlightedTokensOptions): HLToken[][] | null {
  const [tokens, setTokens] = useState<HLToken[][] | null>(null)
  const isDark = useIsDark()
  const plugin = isDark ? codePlugin : codePluginLight
  const currentSeqRef = useRef(0)
  const committedSeqRef = useRef(0)
  const cache = options?.cache ?? null

  useEffect(() => {
    if (!code) { setTokens(null); return }
    const lineCount = code.split('\n').length
    if (lineCount > HIGHLIGHT_LINE_LIMIT) { setTokens(null); return }
    const mySeq = ++currentSeqRef.current
    const lang = resolveHighlightLanguage(plugin, language)
    const theme = (isDark ? 'github-dark' : 'github-light') as BundledTheme
    const needsCompanions = hasCompanions(lang)
    const cacheKey = cache ? buildHighlightKey(theme, lang, code) : null

    if (cache && cacheKey) {
      const hit = cache.get(cacheKey)
      if (hit) {
        committedSeqRef.current = mySeq
        setTokens(hit)
        return
      }
    }

    if (lineCount <= HIGHLIGHT_CHUNK_SIZE && !needsCompanions) {
      let cancelled = false
      getFileHighlighter(theme, lang).then((hl) => {
        if (cancelled) return
        const highlighted = hl.codeToTokensBase(code, { lang: lang as BundledLanguage, theme })
        if (mySeq < committedSeqRef.current) return
        committedSeqRef.current = mySeq
        const result = toHLTokens(highlighted)
        if (cache && cacheKey) cache.set(cacheKey, result)
        setTokens(result)
      }).catch(() => {})
      return () => { cancelled = true }
    }

    let cancelled = false
    const idleIds = new Set<number>()
    const scheduleIdle = (cb: () => void, timeout: number): void => {
      const idleId = requestIdleCallback(() => {
        idleIds.delete(idleId)
        cb()
      }, { timeout })
      idleIds.add(idleId)
    }

    scheduleIdle(() => {
      if (cancelled) return
      getFileHighlighter(theme, lang).then((hl) => {
        if (cancelled) return
        const codeLines = code.split('\n')
        const accumulated: (HLToken[] | undefined)[] = new Array(codeLines.length)
        let gramState: GrammarState | undefined

        const processChunk = (chunkIdx: number): void => {
          if (cancelled) return
          const start = chunkIdx * HIGHLIGHT_CHUNK_SIZE
          if (start >= codeLines.length) return
          const end = Math.min(start + HIGHLIGHT_CHUNK_SIZE, codeLines.length)
          const chunkCode = codeLines.slice(start, end).join('\n')

          const tokens = hl.codeToTokensBase(chunkCode, { lang: lang as BundledLanguage, theme, grammarState: gramState })
          gramState = hl.getLastGrammarState(tokens) as GrammarState | undefined
          const extracted = toHLTokens(tokens)
          for (let i = 0; i < extracted.length; i++) accumulated[start + i] = extracted[i]
          if (!cancelled) startTransition(() => setTokens([...accumulated] as HLToken[][]))
          if (end >= codeLines.length) {
            if (!cancelled && cache && cacheKey) {
              cache.set(cacheKey, accumulated as HLToken[][])
            }
            return
          }
          scheduleIdle(() => processChunk(chunkIdx + 1), 16)
        }
        processChunk(0)
      }).catch(() => {})
    }, 50)
    return () => {
      cancelled = true
      for (const idleId of idleIds) cancelIdleCallback(idleId)
      idleIds.clear()
    }
  }, [code, language, isDark, plugin, cache])

  return tokens
}

export function useIncrementalHighlightedLines(lines: string[], language: string): HLToken[][] | null {
  const isDark = useIsDark()
  const plugin = isDark ? codePlugin : codePluginLight
  const theme: BundledTheme = isDark ? 'github-dark' : 'github-light'
  const lang = resolveHighlightLanguage(plugin, language)

  const prevLinesRef = useRef<string[]>([])
  const prevTokensRef = useRef<HLToken[][] | null>(null)
  const prevEndStateRef = useRef<GrammarState | undefined>(undefined)
  const themeRef = useRef<BundledTheme | null>(null)
  const langRef = useRef<string | null>(null)
  const [, setReadyTick] = useState(0)

  useMemo(() => {
    if (getFileHighlighterSync(theme, lang)) return
    getFileHighlighter(theme, lang).then(() => {
      setReadyTick((t) => t + 1)
    }).catch(() => {})
  }, [theme, lang])

  if (lines.length === 0 || lines.length > HIGHLIGHT_LINE_LIMIT) {
    prevLinesRef.current = []
    prevTokensRef.current = null
    prevEndStateRef.current = undefined
    themeRef.current = null
    langRef.current = null
    return null
  }

  const hl = getFileHighlighterSync(theme, lang)
  if (!hl) return prevTokensRef.current

  const prevLines = prevLinesRef.current
  const prevTokens = prevTokensRef.current
  const canReuse = themeRef.current === theme &&
    langRef.current === lang &&
    prevTokens !== null

  if (canReuse && prevLines.length === lines.length) {
    let identical = true
    for (let i = 0; i < prevLines.length; i++) {
      if (prevLines[i] !== lines[i]) { identical = false; break }
    }
    if (identical) return prevTokens
  }

  let isPureAppend = false
  if (canReuse && prevTokens && lines.length > prevLines.length) {
    isPureAppend = true
    for (let i = 0; i < prevLines.length; i++) {
      if (prevLines[i] !== lines[i]) { isPureAppend = false; break }
    }
  }

  let nextTokens: HLToken[][]
  let endState: GrammarState | undefined
  if (isPureAppend && prevTokens) {
    const appendedCode = lines.slice(prevLines.length).join('\n')
    const raw = hl.codeToTokensBase(appendedCode, {
      lang: lang as BundledLanguage,
      theme,
      grammarState: prevEndStateRef.current,
    })
    endState = hl.getLastGrammarState(raw) as GrammarState | undefined
    nextTokens = prevTokens.concat(toHLTokens(raw))
  } else {
    const raw = hl.codeToTokensBase(lines.join('\n'), {
      lang: lang as BundledLanguage,
      theme,
    })
    endState = hl.getLastGrammarState(raw) as GrammarState | undefined
    nextTokens = toHLTokens(raw)
  }

  prevLinesRef.current = lines
  prevTokensRef.current = nextTokens
  prevEndStateRef.current = endState
  themeRef.current = theme
  langRef.current = lang

  window.app?.trace?.('highlight.incremental', isPureAppend ? 'append' : 'full', {
    lines: nextTokens.length,
    language: lang,
    appended: isPureAppend ? lines.length - prevLines.length : lines.length,
  })

  return nextTokens
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
      data-line={line.lineNum}
      data-line-kind={line.kind}
      className={isHighlighted ? ROW_HIGHLIGHT : wasFading ? ROW_CLASS_FADE[line.kind] : ROW_CLASS[line.kind]}
      style={{ height: size, transform: `translateY(${start}px)` }}
    >
      <span className="sticky left-0 z-10 inline-block select-none bg-[var(--diff-gutter-bg,var(--background))] text-right text-muted-foreground/50 pl-2 pr-1" style={{ width: `calc(${gw}ch + 0.75rem)` }}>
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
      'rounded bg-background/70 py-2 text-[11px] font-mono leading-relaxed text-foreground',
      autoScrollBottom ? 'overflow-hidden' : 'overflow-auto',
      maxHeight ?? 'max-h-[300px]',
      hideScrollbar && 'hide-scrollbar',
      className,
    ),
    [autoScrollBottom, maxHeight, hideScrollbar, className],
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
