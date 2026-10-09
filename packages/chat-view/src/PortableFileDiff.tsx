import { useContext, useMemo } from 'react'
import { cn } from '@superone/ui/lib/utils'
import { PortableTurnContext } from './portable-turn-context'
import { highlightPortableCode } from './portable-code-plugin'
import type { FileDiffPresenterProps } from './presenters/GenericToolRow'
import { parseNativeDiff, type NativeDiffLine } from './presenters/remote-diff'

const DIFF_ROW_TINT: Record<NativeDiffLine['kind'], string> = {
  added: 'bg-green-500/15',
  removed: 'bg-red-500/15',
  context: '',
}

const DIFF_MARKER: Record<NativeDiffLine['kind'], { glyph: string; className: string }> = {
  added: { glyph: '+', className: 'text-green-600/60 dark:text-green-400/60' },
  removed: { glyph: '-', className: 'text-red-600/60 dark:text-red-400/60' },
  context: { glyph: ' ', className: 'text-transparent' },
}

const FILE_LANGUAGE_ALIASES: Record<string, string> = { h: 'c', hpp: 'cpp', plist: 'xml', lock: 'json' }

/** The phone receives precomputed diffs; Codex details additionally need local tokens. */
export function PortableFileDiff({ toolName, params, toolDiff, toolDiffTokens }: FileDiffPresenterProps) {
  const { scheme } = useContext(PortableTurnContext)
  const diff = toolDiff ?? (typeof params.diff === 'string' ? params.diff : '')
  // Host-precomputed toolDiff already has patch prefixes; params.diff is Codex's raw detail.
  const sourceKind = toolDiff === undefined && toolName === 'FileChange' && (params.kind === 'add' || params.kind === 'delete') ? params.kind : undefined
  const filePath = typeof params.file_path === 'string' ? params.file_path : ''
  const lines = useMemo(() => {
    const parsed = parseNativeDiff(diff, toolDiffTokens, sourceKind)
    if (parsed.every(line => line.tokens)) return parsed
    const name = filePath.split(/[/\\]/).pop()?.toLowerCase() ?? ''
    const extension = name.split('.').pop() ?? ''
    const language = FILE_LANGUAGE_ALIASES[extension] ?? extension
    const theme = scheme === 'dark' ? 'github-dark' : 'github-light'
    // Tokenize each side with its context so multiline comments/strings retain state.
    const oldTokens = highlightPortableCode(parsed.filter(line => line.kind !== 'added').map(line => line.text).join('\n'), language, theme)?.tokens
    const newTokens = highlightPortableCode(parsed.filter(line => line.kind !== 'removed').map(line => line.text).join('\n'), language, theme)?.tokens
    let oldIndex = 0, newIndex = 0
    return parsed.map(line => {
      const source = line.kind === 'removed' ? oldTokens?.[oldIndex] : newTokens?.[newIndex]
      if (line.kind !== 'added') oldIndex++
      if (line.kind !== 'removed') newIndex++
      const tokens = line.tokens ?? (source?.map(token => token.content).join('') === line.text
        ? source.map(token => [token.content, token.color ?? null] as [string, string | null]) : undefined)
      return { ...line, tokens }
    })
  }, [diff, toolDiffTokens, sourceKind, filePath, scheme])
  const gutterCh = Math.max(2, String(lines.reduce((widest, line) => Math.max(widest, line.line), 0)).length)
  if (lines.length === 0) return null
  return (
    // One viewport owns both axes. A nested overflow-x:auto would also scroll vertically.
    <div className="max-h-[300px] overflow-auto rounded bg-background/70 py-2 font-mono text-[12px] leading-relaxed text-foreground">
      <div className="w-max min-w-full">
        {lines.map((line, index) => (
          <div key={index} className={cn('flex', DIFF_ROW_TINT[line.kind])}>
            <div className="sticky left-0 shrink-0 bg-background" style={{ width: `calc(${gutterCh}ch + 1.25rem)` }}>
              <div className={cn('h-full pr-2', DIFF_ROW_TINT[line.kind])}>
                <span className="inline-block w-full select-none pr-1.5 text-right text-muted-foreground/50">{line.line}</span>
              </div>
            </div>
            <div className="whitespace-pre pr-2">
              <span className={cn('mr-1 inline-block w-[1ch] select-none text-center', DIFF_MARKER[line.kind].className)}>
                {DIFF_MARKER[line.kind].glyph}
              </span>
              {line.tokens
                ? line.tokens.map(([text, color], i) => <span key={i} style={color ? { color } : undefined}>{text}</span>)
                : (line.text || ' ')}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
