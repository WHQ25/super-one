/**
 * nbformat 4 reader for the read-only notebook preview.
 *
 * Notebooks arrive as untrusted input (any cloned repo can carry one), so the
 * parser never surfaces `text/html` bundles — see `pickDisplayOutput`.
 */

export type NotebookOutput =
  | { kind: 'stream'; stream: 'stdout' | 'stderr'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'image'; mime: string; src: string }
  | { kind: 'error'; text: string }

export interface NotebookCell {
  type: 'code' | 'markdown' | 'raw'
  source: string
  executionCount: number | null
  outputs: NotebookOutput[]
}

export interface ParsedNotebook {
  language: string
  cells: NotebookCell[]
}

/** `source` / `text` / bundle values are either a string or a list of lines. */
function joinLines(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.filter((v) => typeof v === 'string').join('')
  return ''
}

// CSI sequences — tracebacks are the only place ANSI shows up in a notebook.
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '')
}

const BASE64_IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

function pickDisplayOutput(data: Record<string, unknown>): NotebookOutput | null {
  for (const mime of BASE64_IMAGE_MIMES) {
    const payload = joinLines(data[mime])
    // Jupyter wraps base64 at 76 columns; the data URL must not carry those breaks.
    if (payload) return { kind: 'image', mime, src: `data:${mime};base64,${payload.replace(/\s/g, '')}` }
  }
  const svg = joinLines(data['image/svg+xml'])
  if (svg) {
    return { kind: 'image', mime: 'image/svg+xml', src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` }
  }
  // `text/html` is deliberately skipped: rendering it would execute arbitrary
  // markup from the notebook author. Pandas/plotly always ship a text/plain twin.
  const text = joinLines(data['text/plain'])
  return text ? { kind: 'text', text } : null
}

function parseOutput(raw: unknown): NotebookOutput | null {
  if (!raw || typeof raw !== 'object') return null
  const out = raw as Record<string, unknown>
  switch (out.output_type) {
    case 'stream':
      return {
        kind: 'stream',
        stream: out.name === 'stderr' ? 'stderr' : 'stdout',
        text: joinLines(out.text),
      }
    case 'execute_result':
    case 'display_data':
      return out.data && typeof out.data === 'object'
        ? pickDisplayOutput(out.data as Record<string, unknown>)
        : null
    case 'error': {
      const traceback = Array.isArray(out.traceback)
        ? out.traceback.filter((l): l is string => typeof l === 'string').join('\n')
        : ''
      const text = traceback || [out.ename, out.evalue].filter(Boolean).join(': ')
      return text ? { kind: 'error', text: stripAnsi(text) } : null
    }
    default:
      return null
  }
}

function parseCell(raw: unknown): NotebookCell | null {
  if (!raw || typeof raw !== 'object') return null
  const cell = raw as Record<string, unknown>
  const type = cell.cell_type === 'code' ? 'code' : cell.cell_type === 'markdown' ? 'markdown' : 'raw'
  const outputs = Array.isArray(cell.outputs)
    ? cell.outputs.map(parseOutput).filter((o): o is NotebookOutput => o !== null)
    : []
  return {
    type,
    source: joinLines(cell.source),
    executionCount: typeof cell.execution_count === 'number' ? cell.execution_count : null,
    outputs,
  }
}

function readLanguage(metadata: unknown): string {
  if (!metadata || typeof metadata !== 'object') return 'python'
  const meta = metadata as Record<string, unknown>
  const info = meta.language_info as Record<string, unknown> | undefined
  if (info && typeof info.name === 'string' && info.name) return info.name
  const spec = meta.kernelspec as Record<string, unknown> | undefined
  if (spec && typeof spec.language === 'string' && spec.language) return spec.language
  return 'python'
}

/**
 * Below this, every cell is mounted directly — a short notebook is cheap and a
 * plain list keeps find-in-page and text selection working across all of it.
 * Above it, mounting each cell costs a Shiki highlight pass and (for plots) a
 * multi-MB data URL decode, so the list switches to a measured window.
 */
export const VIRTUALIZE_MIN_CELLS = 40


// Rough pixel geometry of the rendered cell, used only to seed the virtualizer
// before a row has been measured. Being wrong costs scrollbar jitter, not
// correctness — @tanstack/react-virtual remeasures every row it mounts.
const LINE_PX = 18
const MARKDOWN_LINE_PX = 24
const CELL_CHROME_PX = 20
/** matplotlib's default 6.4×4.8in figure lands near this once scaled to column width. */
const IMAGE_PX = 360
/** One pathological output (a 5k-line log) must not dominate the scroll range. */
const MAX_OUTPUT_PX = 400
/** Column width assumed when the caller has not measured one yet. */
export const DEFAULT_CHARS_PER_LINE = 80

/**
 * Visual line count. Cells render with `whitespace-pre-wrap break-words`, so a
 * long line occupies several rows — counting only `\n` badly underestimates
 * real notebooks and makes the virtualizer's scroll range jump on measure.
 */
function wrappedLineCount(text: string, charsPerLine: number): number {
  if (!text) return 1
  const width = charsPerLine > 0 ? charsPerLine : DEFAULT_CHARS_PER_LINE
  let rows = 0
  let lineLength = 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') {
      rows += Math.max(1, Math.ceil(lineLength / width))
      lineLength = 0
    } else {
      lineLength++
    }
  }
  rows += Math.max(1, Math.ceil(lineLength / width))
  return rows
}

function estimateOutputHeight(output: NotebookOutput, charsPerLine: number): number {
  if (output.kind === 'image') return IMAGE_PX
  return Math.min(wrappedLineCount(output.text, charsPerLine) * LINE_PX + 8, MAX_OUTPUT_PX)
}

/**
 * Estimated rendered height of `cell` in px, including its bottom gap.
 * `charsPerLine` is the measured column width in characters — the closer it is
 * to reality, the less the scrollbar shifts as rows get measured.
 */
export function estimateCellHeight(cell: NotebookCell, charsPerLine = DEFAULT_CHARS_PER_LINE): number {
  const perLine = cell.type === 'markdown' ? MARKDOWN_LINE_PX : LINE_PX
  let height = wrappedLineCount(cell.source, charsPerLine) * perLine + CELL_CHROME_PX
  for (const output of cell.outputs) height += estimateOutputHeight(output, charsPerLine)
  return height
}

/** Returns `null` for anything that isn't a readable notebook — the caller falls back to the raw view. */
export function parseNotebook(raw: string): ParsedNotebook | null {
  let doc: unknown
  try {
    doc = JSON.parse(raw)
  } catch {
    return null
  }
  if (!doc || typeof doc !== 'object') return null
  const nb = doc as Record<string, unknown>
  if (!Array.isArray(nb.cells)) return null
  return {
    language: readLanguage(nb.metadata),
    cells: nb.cells.map(parseCell).filter((c): c is NotebookCell => c !== null),
  }
}
