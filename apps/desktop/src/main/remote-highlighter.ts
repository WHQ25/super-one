import { createHighlighter, type Highlighter } from 'shiki'

let highlighter: Highlighter | null = null
let initPromise: Promise<void> | null = null

const LANGS = [
  'typescript', 'tsx', 'javascript', 'jsx',
  'dart', 'python', 'rust', 'go', 'java', 'kotlin', 'swift',
  'c', 'cpp', 'csharp', 'ruby', 'lua', 'bash', 'shell',
  'sql', 'html', 'css', 'scss', 'json', 'yaml', 'toml',
  'xml', 'markdown', 'graphql', 'php', 'scala', 'r',
  'elixir', 'dockerfile', 'diff',
] as const

const EXT_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'tsx', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'jsx', mjs: 'javascript', cjs: 'javascript',
  dart: 'dart', py: 'python', rs: 'rust', go: 'go', java: 'java',
  kt: 'kotlin', swift: 'swift', c: 'c', cpp: 'cpp', cc: 'cpp',
  cs: 'csharp', rb: 'ruby', lua: 'lua',
  sh: 'bash', zsh: 'bash', bash: 'bash', fish: 'bash',
  sql: 'sql', html: 'html', htm: 'html', css: 'css', scss: 'scss',
  json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
  xml: 'xml', svg: 'xml', md: 'markdown', mdx: 'markdown',
  graphql: 'graphql', gql: 'graphql', php: 'php', scala: 'scala', r: 'r',
  ex: 'elixir', exs: 'elixir', dockerfile: 'dockerfile',
}

async function ensureInit(): Promise<void> {
  if (highlighter) return
  if (initPromise) return initPromise
  initPromise = (async () => {
    highlighter = await createHighlighter({
      themes: ['github-dark', 'github-light'],
      langs: [...LANGS],
    })
  })()
  return initPromise
}

export type DiffToken = [string, string | null]
export type DiffTokenLine = DiffToken[]

export function initHighlighter(): void {
  ensureInit()
}

const SGR_COLORS: Record<number, string> = {
  30: '#6e7681', 31: '#ff7b72', 32: '#7ee787', 33: '#e3b341',
  34: '#79c0ff', 35: '#d2a8ff', 36: '#a5d6ff', 37: '#c9d1d9',
  90: '#8b949e', 91: '#ffa198', 92: '#9beeac', 93: '#f0d674',
  94: '#a5c6ff', 95: '#e2c5ff', 96: '#bce8ff', 97: '#f0f6fc',
}

export function parseAnsiTokens(text: string): DiffTokenLine[] {
  const lines = text.split('\n')
  const result: DiffTokenLine[] = []
  let color: string | null = null
  for (const line of lines) {
    const tokens: DiffToken[] = []
    let pos = 0
    const re = /\x1b\[([0-9;]*)m/g
    let m: RegExpExecArray | null
    while ((m = re.exec(line)) !== null) {
      if (m.index > pos) tokens.push([line.slice(pos, m.index), color])
      pos = m.index + m[0].length
      const codes = m[1] ? m[1].split(';').map(Number) : [0]
      for (let i = 0; i < codes.length; i++) {
        const c = codes[i]
        if (c === 0 || c === 39) color = null
        else if (c === 1 || c === 22) { /* bold/unbold */ }
        else if (SGR_COLORS[c]) color = SGR_COLORS[c]
        else if (c === 38 && codes[i + 1] === 2) {
          const r = codes[i + 2] ?? 0, g = codes[i + 3] ?? 0, b = codes[i + 4] ?? 0
          color = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
          i += 4
        } else if (c === 38 && codes[i + 1] === 5) {
          i += 2
        }
      }
    }
    if (pos < line.length) tokens.push([line.slice(pos), color])
    if (tokens.length === 0) tokens.push(['', null])
    result.push(tokens)
  }
  return result
}

export function highlightCodeSync(code: string, filePath: string): DiffTokenLine[] | null {
  if (!highlighter) return null
  const ext = filePath.split('/').pop()?.split('.').pop()?.toLowerCase() ?? ''
  const lang = EXT_LANG[ext]
  if (!lang) return null
  return highlightWithLang(code, lang)
}

const LANG_ALIASES: Record<string, string> = {
  js: 'javascript', jsx: 'jsx', ts: 'typescript', tsx: 'tsx',
  py: 'python', rb: 'ruby', sh: 'bash', zsh: 'bash',
  yml: 'yaml', cs: 'csharp', kt: 'kotlin', rs: 'rust',
  md: 'markdown', gql: 'graphql', ex: 'elixir',
}

export function highlightCodeByLang(code: string, language: string): { lang: string; tokens: DiffTokenLine[] } | null {
  if (!highlighter) return null
  const lang = LANG_ALIASES[language] ?? language
  if (!(LANGS as readonly string[]).includes(lang)) return null
  const tokens = highlightWithLang(code, lang)
  return tokens ? { lang, tokens } : null
}

function highlightWithLang(code: string, lang: string): DiffTokenLine[] | null {
  try {
    const result = highlighter!.codeToTokens(code, { lang: lang as never, theme: 'github-dark' })
    return result.tokens.map((line) =>
      line.map((token): DiffToken => [token.content, token.color ?? null])
    )
  } catch {
    return null
  }
}
