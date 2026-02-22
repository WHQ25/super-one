import { useMemo } from 'react'

interface ReleaseEntry {
  version: string
  items: string[]
}

function parseReleaseNotes(raw: string): ReleaseEntry[] {
  const entries: ReleaseEntry[] = []
  let current: ReleaseEntry | null = null

  for (const line of raw.split('\n')) {
    const versionMatch = line.match(/^Version\s+([\d.]+):/)
    if (versionMatch) {
      current = { version: versionMatch[1], items: [] }
      entries.push(current)
      continue
    }
    if (current && line.startsWith('•')) {
      current.items.push(line.slice(1).trim())
    }
  }

  return entries
}

/** Render inline markdown: **bold**, `code`, and [link](url). */
function InlineMarkdown({ text }: { text: string }) {
  const parts = useMemo(() => {
    const result: Array<{ type: 'text' | 'bold' | 'code' | 'link'; text: string; href?: string }> = []
    // Match **bold**, `code`, [text](url)
    const regex = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)/g
    let last = 0
    let match: RegExpExecArray | null

    while ((match = regex.exec(text)) !== null) {
      if (match.index > last) {
        result.push({ type: 'text', text: text.slice(last, match.index) })
      }
      if (match[1] !== undefined) {
        result.push({ type: 'bold', text: match[1] })
      } else if (match[2] !== undefined) {
        result.push({ type: 'code', text: match[2] })
      } else if (match[3] !== undefined) {
        result.push({ type: 'link', text: match[3], href: match[4] })
      }
      last = match.index + match[0].length
    }

    if (last < text.length) {
      result.push({ type: 'text', text: text.slice(last) })
    }

    return result
  }, [text])

  return (
    <>
      {parts.map((p, i) => {
        switch (p.type) {
          case 'bold':
            return <strong key={i} className="font-semibold text-foreground">{p.text}</strong>
          case 'code':
            return <code key={i} className="rounded bg-muted px-1 py-0.5 text-[11px] text-blue-300">{p.text}</code>
          case 'link':
            return <span key={i} className="text-blue-400 underline">{p.text}</span>
          default:
            return <span key={i}>{p.text}</span>
        }
      })}
    </>
  )
}

export function ReleaseNotesView({ content }: { content: string }) {
  const entries = useMemo(() => parseReleaseNotes(content), [content])

  if (entries.length === 0) {
    return (
      <pre className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{content}</pre>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {entries.map((entry) => (
        <div key={entry.version}>
          <div className="mb-1.5 text-sm font-semibold text-foreground">
            v{entry.version}
          </div>
          <ul className="flex flex-col gap-1">
            {entry.items.map((item, i) => (
              <li key={i} className="flex gap-1.5 text-xs leading-relaxed text-muted-foreground">
                <span className="mt-0.5 shrink-0 text-muted-foreground/50">•</span>
                <span><InlineMarkdown text={item} /></span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
