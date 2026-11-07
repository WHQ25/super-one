import { Children, forwardRef, isValidElement, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type ReactElement, type ReactNode, type Ref } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Copy, Expand, RotateCcwSquare, RotateCwSquare } from 'lucide-react'
import { tableDataToMarkdown } from 'streamdown'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { Kbd } from '@superone/ui/components/ui/kbd'
import { tryCopy } from '@/lib/clipboard'
import { FullscreenGlassDialog } from './FullscreenGlassDialog'

type CellProps = { children?: ReactNode }

type MarkedCell = {
  /** Stable across orientations: original row and column, so the flip can follow a cell. */
  key: string
  /** True when this cell was a column header before any transpose. The mark travels with it. */
  header: boolean
  content: ReactNode
}

const headerCellClass = 'whitespace-nowrap px-4 py-2 text-left font-semibold text-sm'
const bodyCellClass = 'px-4 py-2 text-sm'
const FLIP_MS = 320

function elementName(element: ReactElement): string | undefined {
  const type = element.type as { displayName?: string }
  return type?.displayName
}

/** Rows of cell content, header section first. Ragged rows stay short. */
function readCells(children: ReactNode): MarkedCell[][] {
  const matrix: MarkedCell[][] = []
  let rowIndex = 0
  Children.forEach(children, (section) => {
    if (!isValidElement<CellProps>(section)) return
    const sectionHeader = elementName(section) === 'MarkdownThead'
    Children.forEach(section.props.children, (row) => {
      if (!isValidElement<CellProps>(row)) return
      const cells: MarkedCell[] = []
      let column = 0
      Children.forEach(row.props.children, (cell) => {
        if (cell == null || cell === false || cell === true) return
        if (typeof cell === 'string' && cell.trim() === '') return
        const element = isValidElement<CellProps>(cell) ? cell : null
        const header = sectionHeader || (element != null && elementName(element) === 'MarkdownTh')
        cells.push({
          key: `${rowIndex}:${column}`,
          header,
          content: element ? element.props.children : cell,
        })
        column += 1
      })
      if (cells.length === 0) return
      matrix.push(cells)
      rowIndex += 1
    })
  })
  // GFM always has a header row. If the renderer did not label it, the first row still is one.
  if (matrix.length > 0 && matrix.every((row) => row.every((cell) => !cell.header))) {
    matrix[0] = matrix[0].map((cell) => ({ ...cell, header: true }))
  }
  return matrix
}

function transposeCells(matrix: MarkedCell[][]): MarkedCell[][] {
  const width = matrix.reduce((max, row) => Math.max(max, row.length), 0)
  const transposed: MarkedCell[][] = []
  for (let column = 0; column < width; column++) {
    const row: MarkedCell[] = []
    for (let rowIndex = 0; rowIndex < matrix.length; rowIndex++) {
      row.push(matrix[rowIndex][column] ?? { key: `${rowIndex}:${column}`, header: false, content: null })
    }
    transposed.push(row)
  }
  return transposed
}

function renderRow(row: MarkedCell[], kind: 'header' | 'body') {
  return (
    <tr key={row[0]?.key ?? row.length} data-streamdown="table-row">
      {row.map((cell) => {
        // A transposed table keeps the original header mark on those cells, now
        // a column of row labels. The new first row is the old first column
        // (Owner, State), and those cells stay ordinary body cells.
        if (kind === 'body' && cell.header) {
          return (
            <th
              key={cell.key}
              scope="row"
              data-table-cell={cell.key}
              data-streamdown="table-cell"
              data-table-mark=""
              className={headerCellClass}
            >
              {cell.content}
            </th>
          )
        }
        if (kind === 'header') {
          return (
            <th key={cell.key} data-table-cell={cell.key} data-streamdown="table-header-cell" className={headerCellClass}>
              {cell.content}
            </th>
          )
        }
        return (
          <td key={cell.key} data-table-cell={cell.key} data-streamdown="table-cell" className={bodyCellClass}>
            {cell.content}
          </td>
        )
      })}
    </tr>
  )
}

/**
 * Swap axes so each original row becomes one column. Header marks travel with
 * the cells that had them. The transposed grid has no header row: its first
 * row is the original first column, which was body text.
 */
function renderCells(matrix: MarkedCell[][], transposed: boolean): ReactNode | null {
  if (matrix.length === 0) return null
  const rows = transposed ? transposeCells(matrix) : matrix
  if (transposed) {
    return <tbody data-streamdown="table-body">{rows.map((row) => renderRow(row, 'body'))}</tbody>
  }
  const [header = [], ...body] = rows
  return (
    <>
      <thead data-streamdown="table-header" className="bg-muted/80">
        {renderRow(header, 'header')}
      </thead>
      {body.length > 0 && (
        <tbody data-streamdown="table-body">
          {body.map((row) => renderRow(row, 'body'))}
        </tbody>
      )}
    </>
  )
}

/** Every visible cell, including row labels. Streamdown's extractor skips `th` outside `thead`. */
function markdownFromTable(table: HTMLTableElement): string {
  const grid = [...table.rows].map((row) => [...row.cells].map((cell) => (cell.textContent ?? '').trim()))
  const [headers = [], ...rows] = grid
  return tableDataToMarkdown({ headers, rows })
}

type CellRects = Map<string, DOMRect>

function captureCellRects(table: HTMLTableElement | null): CellRects {
  const rects: CellRects = new Map()
  table?.querySelectorAll<HTMLElement>('[data-table-cell]').forEach((cell) => {
    const id = cell.getAttribute('data-table-cell')
    if (id) rects.set(id, cell.getBoundingClientRect())
  })
  return rects
}

function animateCells(table: HTMLTableElement | null, from: CellRects) {
  if (!table || from.size === 0) return
  if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const sample = table.querySelector<HTMLElement>('[data-table-cell]')
  if (!sample || typeof sample.animate !== 'function') return
  const scroller = table.parentElement
  if (scroller) scroller.style.overflow = 'visible'
  const animations: Animation[] = []
  table.querySelectorAll<HTMLElement>('[data-table-cell]').forEach((cell) => {
    const id = cell.getAttribute('data-table-cell')
    const start = id ? from.get(id) : undefined
    if (!start) return
    const next = cell.getBoundingClientRect()
    const dx = start.left - next.left
    const dy = start.top - next.top
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return
    cell.style.position = 'relative'
    cell.style.zIndex = '3'
    const animation = cell.animate(
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
      { duration: FLIP_MS, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    )
    animation.finished.finally(() => {
      cell.style.position = ''
      cell.style.zIndex = ''
    }).catch(() => {})
    animations.push(animation)
  })
  if (!scroller) return
  if (animations.length === 0) {
    scroller.style.overflow = ''
    return
  }
  void Promise.all(animations.map((animation) => animation.finished.catch(() => undefined))).finally(() => {
    scroller.style.overflow = ''
  })
}

type FlipHandle = { capture: () => void }

const FlipTable = forwardRef(function FlipTable({ transposed, children, ...rest }: ComponentProps<'table'> & { transposed: boolean }, ref: Ref<FlipHandle>) {
  const tableRef = useRef<HTMLTableElement>(null)
  const pending = useRef<CellRects | null>(null)
  useImperativeHandle(ref, () => ({
    capture() { pending.current = captureCellRects(tableRef.current) },
  }), [])
  useLayoutEffect(() => {
    const from = pending.current
    pending.current = null
    if (from) animateCells(tableRef.current, from)
  }, [transposed])
  return <table data-streamdown="table" {...rest} ref={tableRef}>{children}</table>
})

function TransposeButton({ transposed, onToggle, className }: {
  transposed: boolean
  onToggle: () => void
  className?: string
}) {
  const { t } = useTranslation()
  return (
    <IconButton
      size="xs"
      variant="ghost"
      onClick={onToggle}
      aria-pressed={transposed}
      className={className}
      tooltip={transposed ? t('tooltips.restoreTable') : t('tooltips.transposeTable')}
    >
      {transposed ? <RotateCcwSquare className="size-3" /> : <RotateCwSquare className="size-3" />}
    </IconButton>
  )
}

function TableFullscreen({ open, onOpenChange, transposed, onTranspose, flipRef, children }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  transposed: boolean
  onTranspose: () => void
  flipRef: Ref<FlipHandle>
  children: ReactNode
}) {
  return (
    <FullscreenGlassDialog open={open} onOpenChange={onOpenChange} title="Table">
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-end gap-1 px-4 py-2 text-xs text-muted-foreground/70">
          <TransposeButton transposed={transposed} onToggle={onTranspose} />
          <Kbd>esc</Kbd> exit
        </div>
        <div className="md-table-full flex-1 overflow-auto" data-table-transposed={transposed ? '' : undefined}>
          <div className="flex min-h-full min-w-full items-center justify-center p-4 pt-0">
            <FlipTable ref={flipRef} transposed={transposed}>{children}</FlipTable>
          </div>
        </div>
      </div>
    </FullscreenGlassDialog>
  )
}

// The 12px glyph is pinned to the right of the 20px hit target so it lines up
// with the table edge. The button ring would outline that empty left side.
const tableActionClass =
  'justify-end opacity-50 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-0 focus-visible:[&_svg]:rounded-[2px] focus-visible:[&_svg]:outline-2 focus-visible:[&_svg]:outline-offset-1 focus-visible:[&_svg]:outline-ring/50'

export function MarkdownTable({ node: _node, children, ...rest }: ComponentProps<'table'> & { node?: unknown }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [transposed, setTransposed] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const inlineFlip = useRef<FlipHandle>(null)
  const dialogFlip = useRef<FlipHandle>(null)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const matrix = useMemo(() => readCells(children), [children])
  const shown = renderCells(matrix, transposed) ?? children

  useEffect(() => () => clearTimeout(copiedTimer.current), [])

  function toggleTranspose() {
    inlineFlip.current?.capture()
    dialogFlip.current?.capture()
    setTransposed((current) => !current)
  }

  async function handleCopy() {
    const table = rootRef.current?.querySelector('table')
    if (!table) return
    const markdown = markdownFromTable(table)
    if (!(await tryCopy(markdown))) return
    setCopied(true)
    clearTimeout(copiedTimer.current)
    copiedTimer.current = setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="flex justify-center">
      <div
        ref={rootRef}
        data-streamdown="table-wrapper"
        data-table-transposed={transposed ? '' : undefined}
        className="group/mdtable relative w-full min-w-0 hover:z-30 focus-within:z-30"
      >
        <div data-table-toolbar className="absolute right-0 top-0 z-30 flex items-center gap-1 opacity-0 transition-opacity group-hover/mdtable:opacity-100 group-focus-within/mdtable:opacity-100 [@media(hover:none)]:opacity-100">
          <TransposeButton
            transposed={transposed}
            onToggle={toggleTranspose}
            className={tableActionClass}
          />
          <IconButton
            size="xs"
            variant="ghost"
            onClick={handleCopy}
            className={tableActionClass}
            tooltip={t('tooltips.copyTable')}
          >
            {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          </IconButton>
          <IconButton
            size="xs"
            variant="ghost"
            onClick={() => setOpen(true)}
            className={tableActionClass}
            tooltip={t('tooltips.expand')}
          >
            <Expand className="size-3" />
          </IconButton>
        </div>
        <div className="overflow-x-auto pt-5">
          <FlipTable {...rest} ref={inlineFlip} transposed={transposed}>{shown}</FlipTable>
        </div>
        <TableFullscreen open={open} onOpenChange={setOpen} transposed={transposed} onTranspose={toggleTranspose} flipRef={dialogFlip}>
          {shown}
        </TableFullscreen>
      </div>
    </div>
  )
}
