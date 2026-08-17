import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { cn } from '@superone/ui/lib/utils'
import { FileContentView, MarkdownView } from '@/components/MarkdownPreview'
import {
  DEFAULT_CHARS_PER_LINE,
  VIRTUALIZE_MIN_CELLS,
  estimateCellHeight,
  parseNotebook,
  type NotebookCell,
  type NotebookOutput,
} from './notebook-codec'

function OutputView({ output }: { output: NotebookOutput }) {
  if (output.kind === 'image') {
    return (
      <img
        src={output.src}
        alt=""
        // matplotlib often saves with a transparent background, which turns dark
        // axis labels invisible in dark mode — pin a white canvas behind rasters.
        className={cn('max-w-full', output.mime !== 'image/svg+xml' && 'rounded-sm bg-white')}
      />
    )
  }
  return (
    <pre
      className={cn(
        'overflow-x-auto whitespace-pre-wrap break-words px-1 text-xs leading-relaxed',
        output.kind === 'error' || (output.kind === 'stream' && output.stream === 'stderr')
          ? 'text-destructive'
          : 'text-foreground',
      )}
    >
      {output.text}
    </pre>
  )
}

function CellGutter({ label }: { label: string }) {
  return (
    <div className="w-14 shrink-0 select-none pt-0.5 text-right font-mono text-[10px] text-muted-foreground">
      {label}
    </div>
  )
}

function CellView({ cell, language }: { cell: NotebookCell; language: string }) {
  if (cell.type === 'markdown') {
    return <MarkdownView content={cell.source} className="px-0 py-0" />
  }
  if (cell.type === 'raw') {
    return (
      <div className="flex gap-2">
        <CellGutter label="" />
        <pre className="min-w-0 flex-1 whitespace-pre-wrap break-words rounded-md border border-border bg-muted/30 px-2 py-1.5 text-xs text-muted-foreground">
          {cell.source}
        </pre>
      </div>
    )
  }
  return (
    <div className="flex gap-2">
      <CellGutter label={cell.executionCount != null ? `In [${cell.executionCount}]:` : 'In [ ]:'} />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="overflow-x-auto rounded-md border border-border bg-muted/30 py-1.5">
          <FileContentView code={cell.source} language={language} />
        </div>
        {cell.outputs.map((output, i) => (
          <OutputView key={i} output={output} />
        ))}
      </div>
    </div>
  )
}

interface CellListProps {
  cells: NotebookCell[]
  language: string
  className?: string
}

/** Mono glyph advance at the cells' `text-xs`, used to turn px width into columns. */
const MONO_CHAR_PX = 7.2
/** Gutter + padding that the code column does not get. */
const CELL_INSET_PX = 80

/**
 * Windowed cell list for long notebooks. Heights are unknown up front (a cell
 * can be one line or a full-width plot), so rows are measured after mount —
 * `estimateCellHeight` only seeds the scroll range. Measurement also covers
 * images growing the row once their data URL decodes.
 */
function VirtualCellList({ cells, language, className }: CellListProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [charsPerLine, setCharsPerLine] = useState(DEFAULT_CHARS_PER_LINE)

  // Column width drives the wrap estimate; re-measure so a panel resize does not
  // leave every unmeasured row estimated against a stale width.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = () => {
      const usable = el.clientWidth - CELL_INSET_PX
      if (usable > 0) setCharsPerLine(Math.max(20, Math.floor(usable / MONO_CHAR_PX)))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Precomputed so the virtualizer's estimateSize stays O(1) — it is called for
  // every not-yet-measured row on each range recalculation.
  const estimates = useMemo(
    () => cells.map((cell) => estimateCellHeight(cell, charsPerLine)),
    [cells, charsPerLine],
  )
  const estimateSize = useCallback((index: number) => estimates[index], [estimates])
  const virtualizer = useVirtualizer({
    count: cells.length,
    getScrollElement: () => scrollRef.current,
    estimateSize,
    overscan: 6,
  })

  return (
    <div ref={scrollRef} className={cn('h-full overflow-auto px-2 py-4', className)}>
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => (
          <div
            key={item.key}
            data-index={item.index}
            ref={virtualizer.measureElement}
            className="absolute top-0 left-0 w-full pb-3"
            style={{ transform: `translateY(${item.start}px)` }}
          >
            <CellView cell={cells[item.index]} language={language} />
          </div>
        ))}
      </div>
    </div>
  )
}

function PlainCellList({ cells, language, className }: CellListProps) {
  return (
    <div className={cn('space-y-3 px-2 py-4', className)}>
      {cells.map((cell, i) => (
        <CellView key={i} cell={cell} language={language} />
      ))}
    </div>
  )
}

interface NotebookPreviewProps {
  content: string
  className?: string
}

export function NotebookPreview({ content, className }: NotebookPreviewProps) {
  const notebook = useMemo(() => parseNotebook(content), [content])

  if (!notebook) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-xs text-muted-foreground">
        Not a valid notebook — open the File tab to see the raw JSON
      </div>
    )
  }

  const List = notebook.cells.length >= VIRTUALIZE_MIN_CELLS ? VirtualCellList : PlainCellList
  return <List cells={notebook.cells} language={notebook.language} className={className} />
}
