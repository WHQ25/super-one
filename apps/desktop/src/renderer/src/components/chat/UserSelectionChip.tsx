import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Quote, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Popover, PopoverContent, PopoverTrigger } from '@superone/ui/components/ui/popover'
import { FileIcon } from '@superone/ui/components/ui/FileIcon'
import { DiffView, inferLanguage, useHighlightedTokens, type DiffLine } from '@/lib/diff-utils'
import { getHighlightCache } from '@/lib/highlight-cache'
import { useEffectiveProjectRoot } from '@/stores/app'
import { parseFilePrefix, parseDiffBody, expandLineRanges, type ParsedFilePrefix } from '@/lib/file-quote-prefix'
import { mergeQuoteTokens } from '@/lib/quote-tokens'
import { cn } from '@superone/ui/lib/utils'

interface UserSelectionChipProps {
  selections: string[]
  onRemoveAt?: (index: number) => void
  onClear?: () => void
  readOnly?: boolean
}

function previewOf(text: string, max = 60): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? flat.slice(0, max) + '…' : flat
}

function basenameOf(p: string): string {
  return p.split(/[/\\]/).pop() || p
}

interface FileChipLabelProps {
  filePath: string
  rangeText: string
  size?: 'sm' | 'md'
  className?: string
}

function FileChipLabel({ filePath, rangeText, size = 'md', className }: FileChipLabelProps) {
  const name = basenameOf(filePath)
  const iconSize = size === 'sm' ? 11 : 13
  return (
    <span className={cn('inline-flex items-center gap-1 min-w-0 overflow-hidden align-middle', className)}>
      <FileIcon name={name} size={iconSize} className="shrink-0" />
      <span className="shrink-0 whitespace-nowrap font-medium">{name}</span>
      <span className="min-w-0 truncate font-mono text-muted-foreground/70">{rangeText}</span>
    </span>
  )
}

interface CodeBodyProps {
  body: string
  filePath: string
  lineNums: number[]
  isDiff: boolean
}

function useFullFileContent(filePath: string, fileRoot: string | null): string | null {
  const [content, setContent] = useState<string | null>(null)
  useEffect(() => {
    if (!fileRoot || !filePath) return
    const relPath = filePath.startsWith(fileRoot + '/')
      ? filePath.slice(fileRoot.length + 1)
      : null
    if (!relPath) return
    let cancelled = false
    window.app.readProjectFile?.(fileRoot, relPath).then((r) => {
      if (!cancelled && r?.content != null) setContent(r.content)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [filePath, fileRoot])
  return content
}

function CodeBody({ body, filePath, lineNums, isDiff }: CodeBodyProps) {
  const fileRoot = useEffectiveProjectRoot()
  const cache = useMemo(() => getHighlightCache(fileRoot), [fileRoot])
  const language = useMemo(() => inferLanguage(filePath), [filePath])

  const diffLines = useMemo(() => isDiff ? parseDiffBody(body) : null, [isDiff, body])
  const codeOnly = useMemo(
    () => diffLines ? diffLines.map((l) => l.text).join('\n') : body,
    [diffLines, body],
  )
  const hasRemoved = useMemo(
    () => diffLines ? diffLines.some((l) => l.kind === 'removed') : false,
    [diffLines],
  )

  const fullContent = useFullFileContent(filePath, fileRoot)
  const fullTokens = useHighlightedTokens(fullContent ?? '', language, { cache })
  const snippetTokens = useHighlightedTokens(
    hasRemoved || !fullTokens ? codeOnly : '',
    language,
    { cache },
  )

  const lines = useMemo<DiffLine[]>(() => {
    const codeLines = codeOnly.split('\n')
    return codeLines.map((text, i) => ({
      kind: diffLines?.[i]?.kind ?? 'unchanged',
      lineNum: lineNums[i] ?? i + 1,
      text,
      sourceIdx: i,
    }))
  }, [codeOnly, lineNums, diffLines])

  const tokens = useMemo(() => mergeQuoteTokens(lines, fullTokens, snippetTokens), [lines, fullTokens, snippetTokens])

  return <DiffView lines={lines} newTokens={tokens} oldTokens={tokens} maxHeight="max-h-64" className="text-xs" />
}

interface QuoteItemProps {
  text: string
  index: number
  onRemoveAt?: (index: number) => void
  readOnly: boolean
}

function QuoteItem({ text, index, onRemoveAt, readOnly }: QuoteItemProps) {
  const parsed = useMemo<ParsedFilePrefix | null>(() => parseFilePrefix(text), [text])
  const lineNums = useMemo(
    () => parsed ? expandLineRanges(parsed.rangeText) : [],
    [parsed],
  )

  return (
    <div className="group/quote relative rounded-md bg-muted p-2.5 pr-7">
      {parsed ? (
        <>
          <div className="mb-1.5 flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
            <FileChipLabel
              filePath={parsed.filePath}
              rangeText={parsed.rangeText}
              size="sm"
              className="max-w-full"
            />
          </div>
          <CodeBody body={parsed.body} filePath={parsed.filePath} lineNums={lineNums} isDiff={parsed.isDiff} />
        </>
      ) : (
        <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-muted-foreground">
          {text}
        </pre>
      )}
      {!readOnly && onRemoveAt && (
        <button
          type="button"
          onClick={() => onRemoveAt(index)}
          className="absolute right-1.5 top-1.5 rounded p-0.5 text-muted-foreground/60 opacity-0 transition-opacity hover:bg-background hover:text-foreground group-hover/quote:opacity-100"
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  )
}

export function UserSelectionChip({ selections, onRemoveAt, onClear, readOnly = false }: UserSelectionChipProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  if (selections.length === 0) return null

  const isMulti = selections.length > 1
  const firstParsed = !isMulti ? parseFilePrefix(selections[0]) : null
  let triggerContent: ReactNode
  if (isMulti) {
    triggerContent = (
      <>
        <Quote className="size-2.5 shrink-0 text-primary/50 transition-colors group-hover:text-primary/80" />
        <span className="max-w-55 truncate">
          {t('chat.userSelectionChip.title', { count: selections.length })}
        </span>
      </>
    )
  } else if (firstParsed) {
    triggerContent = (
      <FileChipLabel
        filePath={firstParsed.filePath}
        rangeText={firstParsed.rangeText}
        className="max-w-60"
      />
    )
  } else {
    triggerContent = (
      <>
        <Quote className="size-2.5 shrink-0 text-primary/50 transition-colors group-hover:text-primary/80" />
        <span className="max-w-55 truncate">{previewOf(selections[0])}</span>
      </>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="group inline-flex items-center gap-1.5 rounded-md bg-muted/40 px-2 py-1 text-sm text-foreground/85 whitespace-nowrap select-none cursor-pointer transition-colors hover:bg-background/70 hover:text-foreground"
        >
          {triggerContent}
          {!readOnly && onClear && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation()
                onClear()
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  e.stopPropagation()
                  onClear()
                }
              }}
              className="ml-0.5 cursor-pointer text-muted-foreground/70 hover:text-foreground"
            >
              <X className="size-3" />
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        className="w-[30rem] max-w-[calc(100vw-2rem)] p-3"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-foreground">
          <Quote className="size-2.5 text-primary/50" />
          <span>{t('chat.userSelectionChip.popoverTitle', { count: selections.length })}</span>
        </div>
        <div className="flex max-h-72 flex-col gap-2 overflow-y-auto">
          {selections.map((text, i) => (
            <QuoteItem
              key={i}
              text={text}
              index={i}
              onRemoveAt={onRemoveAt}
              readOnly={readOnly}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
