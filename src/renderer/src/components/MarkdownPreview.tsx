import { useEffect, useState, useRef } from 'react'
import { Streamdown } from 'streamdown'
import { createCodePlugin } from '@streamdown/code'
import { createStreamdownCodeComponent } from '@/components/chat/CodeBlock'

const codePlugin = createCodePlugin({ themes: ['github-dark', 'github-dark'] })
const streamdownPlugins = { code: codePlugin }
const streamdownComponents = { code: createStreamdownCodeComponent(codePlugin) }

interface TokenLine {
  tokens: Array<{ content: string; color?: string; htmlStyle?: Record<string, string> }>
}

export function FileContentView({ code, language }: { code: string; language: string }) {
  const [lines, setLines] = useState<TokenLine[] | null>(null)
  const [fg, setFg] = useState<string | undefined>(undefined)
  const prevKey = useRef('')

  useEffect(() => {
    const themes = codePlugin.getThemes()
    const lang = language.trim().toLowerCase() || 'md'
    const key = `${lang}:${themes.join(',')}:${code.length}`
    if (key === prevKey.current) return
    prevKey.current = key

    if (!codePlugin.supportsLanguage(lang as never)) {
      setLines(null)
      return
    }

    const apply = (res: { fg?: string; tokens: Array<Array<{ content: string; color?: string; htmlStyle?: Record<string, string> }>> }) => {
      setFg(res.fg)
      setLines(res.tokens.map((line) => ({ tokens: line.map((t) => ({ content: t.content, color: t.color, htmlStyle: t.htmlStyle })) })))
    }

    const result = codePlugin.highlight({ code, language: lang as never, themes }, (res) => apply(res))
    if (result) apply(result)
  }, [code, language])

  return (
    <pre className="whitespace-pre-wrap break-words overflow-x-hidden px-1 text-xs leading-relaxed" style={{ color: fg }}>
      <code>
        {lines
          ? lines.map((line, i) => (
              <span key={i}>
                {line.tokens.map((t, j) => (
                  <span key={j} style={t.color || t.htmlStyle ? { color: t.color, ...(t.htmlStyle ?? {}) } as React.CSSProperties : undefined}>
                    {t.content}
                  </span>
                ))}
                {i < lines.length - 1 && '\n'}
              </span>
            ))
          : code}
      </code>
    </pre>
  )
}

type FrontmatterValue = string | { [key: string]: FrontmatterValue }

export function parseFrontmatter(content: string): { meta: Record<string, FrontmatterValue> | null; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  if (!match) return { meta: null, body: content }

  const lines = match[1].split('\n')
  const root: Record<string, FrontmatterValue> = {}
  let currentKey: string | null = null

  for (const line of lines) {
    if (!line.trim()) continue
    const indent = line.search(/\S/)
    const idx = line.indexOf(':')
    if (idx <= 0) continue
    const key = line.slice(0, idx).trim()
    const value = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '')

    if (indent === 0) {
      currentKey = key
      root[key] = value || {}
    } else if (currentKey && indent > 0) {
      const parent = root[currentKey]
      if (typeof parent === 'object') {
        parent[key] = value
      }
    }
  }

  const meta = Object.keys(root).length > 0 ? root : null
  return { meta, body: match[2] }
}

export function FrontmatterTable({ meta, nested }: { meta: Record<string, FrontmatterValue>; nested?: boolean }) {
  return (
    <table className={`w-full border-collapse border border-border text-xs ${nested ? '' : 'mb-3 rounded-md'}`}>
      <tbody>
        {Object.entries(meta).map(([key, value]) => (
          <tr key={key} className="border-b border-border last:border-b-0">
            <td className="whitespace-nowrap bg-muted/50 px-3 py-1.5 align-top font-medium text-muted-foreground">{key}</td>
            <td className="px-3 py-1.5 text-foreground">
              {typeof value === 'object' ? <FrontmatterTable meta={value} nested /> : value}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function MarkdownView({ content }: { content: string }) {
  const { meta, body } = parseFrontmatter(content)
  return (
    <div className="px-1">
      {meta && <FrontmatterTable meta={meta} />}
      <div className="prose prose-sm dark:prose-invert max-w-none text-sm">
        <Streamdown plugins={streamdownPlugins} components={streamdownComponents}>
          {body}
        </Streamdown>
      </div>
    </div>
  )
}

const EXT_LANG_MAP: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  json: 'json',
  md: 'markdown',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  py: 'python',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  css: 'css',
  html: 'html',
  xml: 'xml',
  sql: 'sql',
  rs: 'rust',
  go: 'go',
  rb: 'ruby',
}

export function inferLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  return EXT_LANG_MAP[ext] ?? 'text'
}
