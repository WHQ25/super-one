import { common, createLowlight } from 'lowlight'
import type { ElementContent, Root } from 'hast'
import type { MobileColorScheme } from '../theme/tokens'

/** One run of same-styled characters inside a code line. */
export type CodeSpan = { text: string; color?: string; bold?: boolean; italic?: boolean }
/** A highlighted line: its spans in order. A blank line is an empty array. */
export type CodeLine = CodeSpan[]

/**
 * Files past this size are shown plain: highlight.js is single-pass but still
 * O(size × grammar), and a listing this long is skimmed rather than read.
 */
export const HIGHLIGHT_MAX_BYTES = 128 * 1024

const lowlight = createLowlight(common)

/**
 * Filename extension → highlight.js language id. Only the `common` grammar set
 * is registered, so anything outside it (Dart, Zig, …) falls through to plain
 * text rather than a wrong-language guess.
 */
const EXTENSION_LANGUAGE: Readonly<Record<string, string>> = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  json: 'json', jsonc: 'json', json5: 'json',
  py: 'python', pyi: 'python',
  rb: 'ruby', php: 'php', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', kts: 'kotlin',
  swift: 'swift', c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp', hxx: 'cpp',
  cs: 'csharp', m: 'objectivec', mm: 'objectivec', lua: 'lua', pl: 'perl', r: 'r',
  sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'bash', ps1: 'powershell',
  css: 'css', scss: 'scss', less: 'less',
  html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml', plist: 'xml', xib: 'xml', storyboard: 'xml',
  md: 'markdown', markdown: 'markdown', mdx: 'markdown',
  yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini', cfg: 'ini', conf: 'ini', properties: 'ini',
  sql: 'sql', graphql: 'graphql', gql: 'graphql', diff: 'diff', patch: 'diff',
  makefile: 'makefile', mk: 'makefile', dockerfile: 'dockerfile', vb: 'vbnet', wasm: 'wasm',
}

/** Extension-less files highlight.js knows by name. */
const BASENAME_LANGUAGE: Readonly<Record<string, string>> = {
  makefile: 'makefile', dockerfile: 'dockerfile', gemfile: 'ruby', rakefile: 'ruby', podfile: 'ruby',
}

/** Resolve the grammar for a file name, or `null` when it should stay plain. */
export function languageForFileName(name: string): string | null {
  const base = name.split(/[\\/]/).pop()?.toLowerCase() ?? ''
  const byName = BASENAME_LANGUAGE[base]
  if (byName) return byName
  const dot = base.lastIndexOf('.')
  if (dot < 0) return null
  const language = EXTENSION_LANGUAGE[base.slice(dot + 1)]
  return language && lowlight.registered(language) ? language : null
}

type Palette = Readonly<Record<string, { color: string; bold?: boolean; italic?: boolean }>>

/**
 * GitHub's light and dark highlight.js themes, keyed by hljs scope (without
 * the `hljs-` prefix). Sub-scopes such as `title.function_` come through as
 * separate classes, so `title` and `function_` are both looked up.
 */
const LIGHT: Palette = {
  doctag: { color: '#d73a49' }, keyword: { color: '#d73a49' }, 'template-tag': { color: '#d73a49' },
  'template-variable': { color: '#d73a49' }, type: { color: '#d73a49' }, language_: { color: '#d73a49' },
  title: { color: '#6f42c1' }, class_: { color: '#6f42c1' }, function_: { color: '#6f42c1' },
  attr: { color: '#005cc5' }, attribute: { color: '#005cc5' }, literal: { color: '#005cc5' },
  meta: { color: '#005cc5' }, number: { color: '#005cc5' }, operator: { color: '#005cc5' },
  variable: { color: '#005cc5' }, 'selector-attr': { color: '#005cc5' }, 'selector-class': { color: '#005cc5' },
  'selector-id': { color: '#005cc5' },
  regexp: { color: '#032f62' }, string: { color: '#032f62' },
  built_in: { color: '#e36209' }, symbol: { color: '#e36209' },
  comment: { color: '#6a737d', italic: true }, code: { color: '#6a737d' }, formula: { color: '#6a737d' },
  name: { color: '#22863a' }, quote: { color: '#22863a' }, 'selector-tag': { color: '#22863a' },
  'selector-pseudo': { color: '#22863a' },
  section: { color: '#005cc5', bold: true }, bullet: { color: '#735c0f' },
  emphasis: { color: '#24292e', italic: true }, strong: { color: '#24292e', bold: true },
  addition: { color: '#22863a' }, deletion: { color: '#b31d28' },
}

const DARK: Palette = {
  doctag: { color: '#ff7b72' }, keyword: { color: '#ff7b72' }, 'template-tag': { color: '#ff7b72' },
  'template-variable': { color: '#ff7b72' }, type: { color: '#ff7b72' }, language_: { color: '#ff7b72' },
  title: { color: '#d2a8ff' }, class_: { color: '#d2a8ff' }, function_: { color: '#d2a8ff' },
  attr: { color: '#79c0ff' }, attribute: { color: '#79c0ff' }, literal: { color: '#79c0ff' },
  meta: { color: '#79c0ff' }, number: { color: '#79c0ff' }, operator: { color: '#79c0ff' },
  variable: { color: '#79c0ff' }, 'selector-attr': { color: '#79c0ff' }, 'selector-class': { color: '#79c0ff' },
  'selector-id': { color: '#79c0ff' },
  regexp: { color: '#a5d6ff' }, string: { color: '#a5d6ff' },
  built_in: { color: '#ffa657' }, symbol: { color: '#ffa657' },
  comment: { color: '#8b949e', italic: true }, code: { color: '#8b949e' }, formula: { color: '#8b949e' },
  name: { color: '#7ee787' }, quote: { color: '#7ee787' }, 'selector-tag': { color: '#7ee787' },
  'selector-pseudo': { color: '#7ee787' },
  section: { color: '#1f6feb', bold: true }, bullet: { color: '#f2cc60' },
  emphasis: { color: '#c9d1d9', italic: true }, strong: { color: '#c9d1d9', bold: true },
  addition: { color: '#aff5b4' }, deletion: { color: '#ffdcd7' },
}

type SpanStyle = Omit<CodeSpan, 'text'>

/** Fold the hljs classes on one element into the style its text should carry. */
function styleForClasses(classes: readonly string[], inherited: SpanStyle, palette: Palette): SpanStyle {
  let style = inherited
  for (const cls of classes) {
    const entry = palette[cls.startsWith('hljs-') ? cls.slice(5) : cls]
    if (!entry) continue
    style = {
      color: entry.color,
      ...(entry.bold || style.bold ? { bold: true } : {}),
      ...(entry.italic || style.italic ? { italic: true } : {}),
    }
  }
  return style
}

/**
 * Walk the hast tree once, splitting text nodes on `\n` so every span belongs
 * to exactly one line. Adjacent spans with the same style are merged, which
 * keeps the `Text` count per row close to the number of tokens the eye sees.
 */
function flattenLines(root: Root, palette: Palette): CodeLine[] {
  const lines: CodeLine[] = [[]]
  const push = (text: string, style: SpanStyle) => {
    if (!text) return
    const line = lines[lines.length - 1]
    const last = line[line.length - 1]
    if (last && last.color === style.color && !!last.bold === !!style.bold && !!last.italic === !!style.italic) {
      last.text += text
      return
    }
    line.push({ text, ...style })
  }
  const visit = (node: ElementContent, style: SpanStyle) => {
    if (node.type === 'text') {
      const parts = node.value.split('\n')
      parts.forEach((part, index) => {
        if (index > 0) lines.push([])
        push(part, style)
      })
      return
    }
    if (node.type !== 'element') return
    const classes = node.properties?.className
    const next = Array.isArray(classes) ? styleForClasses(classes.map(String), style, palette) : style
    for (const child of node.children) visit(child, next)
  }
  for (const child of root.children) visit(child as ElementContent, {})
  // A trailing newline terminates the last line rather than opening an empty one.
  if (lines.length > 1 && lines[lines.length - 1].length === 0) lines.pop()
  return lines
}

/** Plain lines, used when there is no grammar or the file is too large to bother. */
export function plainLines(text: string): CodeLine[] {
  const rows = text.split('\n')
  if (rows.length > 1 && rows[rows.length - 1] === '') rows.pop()
  return rows.map((row) => (row ? [{ text: row }] : []))
}

/**
 * Highlight `text` for the file `name`, one entry per line. Unknown languages,
 * oversized files and grammar errors all degrade to `plainLines`, so callers
 * never need a fallback of their own.
 */
export function highlightLines(text: string, name: string, scheme: MobileColorScheme): CodeLine[] {
  const language = languageForFileName(name)
  if (!language || text.length > HIGHLIGHT_MAX_BYTES) return plainLines(text)
  try {
    const tree = lowlight.highlight(language, text)
    return flattenLines(tree, scheme === 'dark' ? DARK : LIGHT)
  } catch {
    return plainLines(text)
  }
}
