import { useState, useEffect, useRef, useMemo, startTransition } from 'react'
import { createHighlighter, type Highlighter, type ThemedToken, type GrammarState, type BundledLanguage, type BundledTheme, type LanguageRegistration } from 'shiki'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import { codePlugin, codePluginLight } from '@/components/chat/chat-shared'
import { isRhaiLanguage, rhaiLanguageRegistration } from '@/components/chat/rhai-highlight'
import { useIsDark } from '@/hooks/use-is-dark'
import { buildHighlightKey, type HighlightCache } from './highlight-cache'

const EXT_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'tsx', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'jsx', mjs: 'javascript', cjs: 'javascript',
  py: 'python', rb: 'ruby', rs: 'rust', rhai: 'rhai', go: 'go', java: 'java',
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

export const HIGHLIGHT_LINE_LIMIT = 25000
export const HIGHLIGHT_CHUNK_SIZE = 100

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

function langRegistration(lang: string): BundledLanguage | LanguageRegistration {
  if (lang === 'rhai') return rhaiLanguageRegistration
  return lang as BundledLanguage
}

const fileHLEngine = createJavaScriptRegexEngine({ forgiving: true })
let fileHLPromise: Promise<Highlighter> | null = null
let fileHLResolved: Highlighter | null = null
const fileHLLangs = new Set<string>()
const fileHLThemes = new Set<string>()

export function getFileHighlighterSync(theme: string, lang: string): Highlighter | null {
  if (!fileHLResolved) return null
  if (!fileHLThemes.has(theme)) return null
  for (const l of langsToLoad(lang)) {
    if (!fileHLLangs.has(l)) return null
  }
  return fileHLResolved
}

export async function getFileHighlighter(theme: string, lang: string): Promise<Highlighter> {
  const required = langsToLoad(lang)
  if (!fileHLPromise) {
    fileHLPromise = createHighlighter({
      themes: [theme as BundledTheme],
      langs: required.map(langRegistration),
      engine: fileHLEngine,
    })
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
    if (!fileHLLangs.has(l)) {
      loads.push(hl.loadLanguage(langRegistration(l)).then(() => { fileHLLangs.add(l) }))
    }
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
  if (isRhaiLanguage(language)) return 'rhai'
  return typeof plugin.supportsLanguage === 'function' && plugin.supportsLanguage(language as never) ? language : 'md'
}

export function getShikiTarget(isDark: boolean, language: string): { theme: BundledTheme; lang: string } {
  const plugin = isDark ? codePlugin : codePluginLight
  return {
    theme: (isDark ? 'github-dark' : 'github-light') as BundledTheme,
    lang: resolveHighlightLanguage(plugin, language),
  }
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
  const { theme, lang } = getShikiTarget(isDark, language)

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
