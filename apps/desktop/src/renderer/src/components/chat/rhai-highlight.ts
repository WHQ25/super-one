/**
 * Shiki highlighter for Rhai using the official vscode-rhai TextMate grammar.
 * @streamdown/code only loads Shiki bundled languages; Rhai is not among them.
 */

import {
  createHighlighter,
  type Highlighter,
  type BundledTheme,
  type LanguageRegistration,
  type TokensResult,
} from 'shiki'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import rhaiTmLanguage from './syntaxes/rhai.tmLanguage.json'

export type RhaiHighlightResult = {
  fg?: string
  bg?: string
  tokens: Array<Array<{ content: string; color?: string; bgColor?: string; htmlStyle?: Record<string, string> }>>
}

const engine = createJavaScriptRegexEngine({ forgiving: true })

/** Official TextMate grammar (MPL-2.0) registered as Shiki language id `rhai`. */
export const rhaiLanguageRegistration: LanguageRegistration = {
  ...(rhaiTmLanguage as unknown as LanguageRegistration),
  name: 'rhai',
  scopeName: (rhaiTmLanguage as { scopeName?: string }).scopeName ?? 'source.rhai',
}

let highlighterPromise: Promise<Highlighter> | null = null
const loadedThemes = new Set<string>()
const resultCache = new Map<string, RhaiHighlightResult>()
const pendingCallbacks = new Map<string, Set<(result: RhaiHighlightResult) => void>>()

function themeName(theme: string | { name?: string }): string {
  return typeof theme === 'string' ? theme : (theme.name ?? 'custom')
}

function cacheKey(code: string, light: string, dark: string): string {
  const head = code.slice(0, 100)
  const tail = code.length > 100 ? code.slice(-100) : ''
  return `rhai:${light}:${dark}:${code.length}:${head}:${tail}`
}

async function getHighlighter(themes: [string, string]): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: [themes[0] as BundledTheme, themes[1] as BundledTheme],
      langs: [rhaiLanguageRegistration],
      engine,
    })
    loadedThemes.add(themes[0])
    loadedThemes.add(themes[1])
    return highlighterPromise
  }
  const hl = await highlighterPromise
  const loads: Promise<void>[] = []
  for (const t of themes) {
    if (!loadedThemes.has(t)) {
      loads.push(
        hl.loadTheme(t as BundledTheme).then(() => {
          loadedThemes.add(t)
        }),
      )
    }
  }
  if (loads.length) await Promise.all(loads)
  return hl
}

function toResult(tokens: TokensResult): RhaiHighlightResult {
  return {
    fg: tokens.fg,
    bg: tokens.bg,
    tokens: tokens.tokens.map((line) =>
      line.map((t) => ({
        content: t.content,
        color: t.color,
        bgColor: t.bgColor,
        htmlStyle: t.htmlStyle as Record<string, string> | undefined,
      })),
    ),
  }
}

export function isRhaiLanguage(language: string | undefined | null): boolean {
  return (language ?? '').trim().toLowerCase() === 'rhai'
}

/**
 * Highlight Rhai source. Mirrors @streamdown/code plugin: returns cached result
 * synchronously when ready, otherwise null and invokes callback when done.
 */
export function highlightRhai(
  code: string,
  themes: [string | { name?: string }, string | { name?: string }],
  callback?: (result: RhaiHighlightResult) => void,
): RhaiHighlightResult | null {
  const light = themeName(themes[0])
  const dark = themeName(themes[1])
  const key = cacheKey(code, light, dark)
  const cached = resultCache.get(key)
  if (cached) return cached

  if (callback) {
    let set = pendingCallbacks.get(key)
    if (!set) {
      set = new Set()
      pendingCallbacks.set(key, set)
    }
    set.add(callback)
  }

  // CodeBlock picks dark/light plugins that pass the same theme twice (e.g.
  // [github-dark, github-dark]). Use single-theme tokens so `color` is set
  // (dual-theme mode only fills htmlStyle / CSS variables).
  const theme = dark || light

  void getHighlighter([light, dark])
    .then((hl) => {
      // Custom language loaded via LanguageRegistration (not a BundledLanguage id).
      const tokens = hl.codeToTokens(code, {
        lang: 'rhai',
        theme,
      } as unknown as Parameters<Highlighter['codeToTokens']>[1])
      const result = toResult(tokens)
      resultCache.set(key, result)
      const waiters = pendingCallbacks.get(key)
      if (waiters) {
        for (const cb of waiters) cb(result)
        pendingCallbacks.delete(key)
      }
    })
    .catch((err) => {
      console.error('[rhai-highlight] failed:', err)
      pendingCallbacks.delete(key)
    })

  return null
}

/** Test helper — clear highlighter singleton + caches. */
export function resetRhaiHighlighterForTests(): void {
  highlighterPromise = null
  loadedThemes.clear()
  resultCache.clear()
  pendingCallbacks.clear()
}
