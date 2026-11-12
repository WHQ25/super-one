import { useMemo } from 'react'
import { parseDiffBody, parseFilePrefix, lineKindToMarker, type LineKind } from '@superone/shared/file-quote-prefix'
import { cn } from '@superone/ui/lib/utils'
import { inferLanguage, useHighlightedTokens, type HLToken } from '@/lib/shiki-highlighter'

export type QuoteSegment =
  | { type: 'text'; text: string }
  | { type: 'inline'; code: string }
  | { type: 'fence'; lang: string; code: string }

/** Split a prose quote into text, inline code, and fenced blocks. */
export function quoteSegments(quote: string): QuoteSegment[] {
  const out: QuoteSegment[] = []
  let i = 0
  while (i < quote.length) {
    if (quote.startsWith('```', i)) {
      const nl = quote.indexOf('\n', i + 3)
      const end = quote.indexOf('```', nl === -1 ? i + 3 : nl + 1)
      if (nl !== -1 && end !== -1) {
        out.push({
          type: 'fence',
          lang: quote.slice(i + 3, nl).trim(),
          code: quote.slice(nl + 1, end).replace(/\n$/, ''),
        })
        i = end + 3
        continue
      }
    }
    if (quote[i] === '`') {
      const end = quote.indexOf('`', i + 1)
      if (end > i + 1 && !quote.slice(i + 1, end).includes('\n')) {
        out.push({ type: 'inline', code: quote.slice(i + 1, end) })
        i = end + 1
        continue
      }
    }
    let next = quote.length
    const fenceAt = quote.indexOf('```', i)
    const tickAt = quote.indexOf('`', i)
    if (fenceAt !== -1) next = Math.min(next, fenceAt)
    if (tickAt !== -1) next = Math.min(next, tickAt)
    if (next === i) next = i + 1
    out.push({ type: 'text', text: quote.slice(i, next) })
    i = next
  }
  return out
}

const DIFF_LINE: Record<LineKind, string> = {
  added: 'bg-green-500/15 text-green-700 dark:text-green-300',
  removed: 'bg-red-500/15 text-red-700 dark:text-red-300',
  unchanged: 'text-muted-foreground',
}

function TokenText({ tokens, text }: { tokens: HLToken[] | undefined; text: string }) {
  // A highlighter that hasn't loaded, or that returned a different line, keeps
  // the source text. An empty token list used to blank the line.
  if (!tokens || tokens.length === 0) return text || ' '
  if (tokens.map((token) => token.content).join('') !== text) return text || ' '
  return tokens.map((token, index) => (
    <span key={index} style={token.style}>{token.content}</span>
  ))
}

function CodeLines({ code, language, kinds }: { code: string; language: string; kinds: LineKind[] | null }) {
  const tokens = useHighlightedTokens(code, language || 'text')
  const lines = code.split('\n')
  return (
    <span className="block w-fit max-w-full overflow-x-auto font-mono text-xs leading-snug">
      {lines.map((text, index) => {
        const kind = kinds?.[index]
        return (
          <span
            key={index}
            {...(kind ? { 'data-comment-diff': kind } : {})}
            className={cn('block w-fit max-w-full whitespace-pre px-1.5', kind ? DIFF_LINE[kind] : 'text-foreground/85')}
          >
            {kind ? lineKindToMarker(kind) : null}
            <TokenText tokens={tokens?.[index]} text={text} />
          </span>
        )
      })}
    </span>
  )
}

function QuoteInlineCode({ code }: { code: string }) {
  return (
    <code className="rounded bg-primary/8 px-1 py-0.5 font-sans text-xs font-medium text-primary/90">
      {code}
    </code>
  )
}

function ProseQuote({ quote }: { quote: string }) {
  const segments = useMemo(() => quoteSegments(quote), [quote])
  const fenced = segments.some((segment) => segment.type === 'fence')
  return (
    <span className={cn(
      'block w-fit max-w-full text-left text-xs leading-snug text-muted-foreground',
      fenced ? 'max-h-28 overflow-auto' : 'line-clamp-2 border-l-2 border-border pl-1',
    )}>
      {segments.map((segment, index) => {
        if (segment.type === 'inline') return <QuoteInlineCode key={index} code={segment.code} />
        if (segment.type === 'fence') return <CodeLines key={index} code={segment.code} language={segment.lang} kinds={null} />
        return <span key={index}>{segment.text}</span>
      })}
    </span>
  )
}

/** The quoted passage under a comment: prose with inline code, a code block, or a diff. */
export function CommentQuote({ quote }: { quote: string }) {
  const parsed = parseFilePrefix(quote)
  if (!parsed) return <ProseQuote quote={quote} />
  const diff = parsed.isDiff ? parseDiffBody(parsed.body) : null
  const code = diff ? diff.map((line) => line.text).join('\n') : parsed.body
  return (
    <span className="mt-1 block w-fit max-w-full overflow-hidden rounded-md bg-background/70 text-left">
      <span className="block truncate px-1.5 pt-1 font-sans text-2xs leading-snug text-muted-foreground">{parsed.prefix}</span>
      <span className="block max-h-28 overflow-auto pb-1">
        <CodeLines code={code} language={inferLanguage(parsed.filePath)} kinds={diff ? diff.map((line) => line.kind) : null} />
      </span>
    </span>
  )
}
