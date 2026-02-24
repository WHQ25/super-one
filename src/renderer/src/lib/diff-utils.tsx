import { useState, useEffect, forwardRef } from 'react'
import { cn } from '@/lib/utils'
import { codePlugin } from '@/components/chat/chat-shared'

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

export function useHighlightedTokens(code: string, language: string): HLToken[][] | null {
  const [tokens, setTokens] = useState<HLToken[][] | null>(null)

  useEffect(() => {
    if (!code) { setTokens(null); return }
    const lang = codePlugin.supportsLanguage(language as never) ? language : 'md'
    const themes = codePlugin.getThemes()
    const extract = (res: { tokens: Array<Array<{ content: string; color?: string; bgColor?: string; htmlStyle?: Record<string, string> }>> }): HLToken[][] =>
      res.tokens.map((line) => line.map((t) => {
        const s: React.CSSProperties = { ...(t.htmlStyle ?? {}) }
        if (t.color) s.color = t.color
        if (t.bgColor) s.backgroundColor = t.bgColor
        return { content: t.content, style: Object.keys(s).length ? s : undefined }
      }))
    const result = codePlugin.highlight(
      { code, language: lang as never, themes },
      (res) => setTokens(extract(res)),
    )
    if (result) setTokens(extract(result))
  }, [code, language])

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
      result.push({ ...line, sourceIdx: sourceIdx++ })
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

export const DiffView = forwardRef<HTMLDivElement, {
  lines: DiffLine[]
  oldTokens?: HLToken[][] | null
  newTokens?: HLToken[][] | null
  maxHeight?: string
  className?: string
  hideScrollbar?: boolean
}>(function DiffView({ lines, oldTokens, newTokens, maxHeight, className, hideScrollbar }, ref) {
  const maxLine = lines.reduce((m, l) => Math.max(m, l.lineNum), 0)
  const gw = gutterWidth(maxLine)

  return (
    <div ref={ref} className={cn('overflow-auto rounded bg-background/70 p-2 text-[11px] font-mono leading-relaxed text-foreground', maxHeight ?? 'max-h-[300px]', hideScrollbar && 'hide-scrollbar', className)}>
      <div className="inline-block min-w-full">
        {lines.map((line, i) => {
          const s = LINE_STYLE[line.kind]
          const tokens = line.kind === 'removed'
            ? oldTokens?.[line.sourceIdx]
            : (newTokens ?? oldTokens)?.[line.sourceIdx]
          return (
            <div key={i} className={cn('whitespace-pre', s.bg)}>
              <span className="inline-block select-none text-right text-muted-foreground/50 mr-1" style={{ width: `${gw}ch` }}>
                {line.lineNum}
              </span>
              <span className={cn('inline-block w-[1ch] select-none text-center mr-1', s.markerColor)}>{s.marker}</span>
              {tokens
                ? tokens.map((t, j) => (
                    <span key={j} style={t.style}>{t.content}</span>
                  ))
                : (line.text || ' ')}
            </div>
          )
        })}
      </div>
    </div>
  )
})
