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

export function highlightCodeSync(code: string, filePath: string): DiffTokenLine[] | null {
  if (!highlighter) return null
  const ext = filePath.split('/').pop()?.split('.').pop()?.toLowerCase() ?? ''
  const lang = EXT_LANG[ext]
  if (!lang) return null

  try {
    const result = highlighter.codeToTokens(code, { lang: lang as never, theme: 'github-dark' })
    return result.tokens.map((line) =>
      line.map((token): DiffToken => [token.content, token.color ?? null])
    )
  } catch {
    return null
  }
}
