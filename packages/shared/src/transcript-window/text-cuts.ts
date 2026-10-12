import type { TextFragmentContext } from '../environment/transcript-window'
import { INSIGHT_FOOTER_LINE, INSIGHT_HEADER_LINE, INSIGHT_INLINE_FOOTER_LINE } from '../insight-markers'

/** Characters per text fragment: worst-case JSON escaping keeps a slice well under a fragment's byte ceiling. */
export const FRAGMENT_TEXT_CHARS = 4096

/**
 * Where a text block is sliced into fragments. A cut is fixed once the
 * `size` characters after the previous cut exist, and looks at nothing beyond
 * them, so appending text never moves an earlier cut: only the last slice grows.
 */
export interface TextCuts {
  /** Text length the cuts were computed for. */
  length: number
  /** Start offset of every slice, beginning with 0. */
  starts: number[]
  /** Rendering context at each start. */
  contexts: Array<TextFragmentContext | undefined>
  /** Markdown state after the last complete line before the last start. */
  scan: ScanState
}

interface ScanState {
  /** Next unscanned offset, always a line start. */
  pos: number
  fence: string | null
  fenceMarker: string
  /** First two rows of the table the scan is in. */
  table: string[] | null
  insight: string | null
}

const FENCE_OPEN = /^\s{0,3}(`{3,}|~{3,})/

export function textCuts(text: string, previous?: TextCuts, size = FRAGMENT_TEXT_CHARS): TextCuts {
  const reuse = previous && previous.length <= text.length
  const starts = reuse ? [...previous.starts] : [0]
  const contexts = reuse ? [...previous.contexts] : [undefined]
  let scan = reuse ? { ...previous.scan, table: previous.scan.table && [...previous.scan.table] } : emptyScan()
  let start = starts[starts.length - 1]
  while (text.length - start > size) {
    const cut = chooseCut(text, start, size)
    scan = scanTo(text, scan, cut)
    starts.push(cut)
    contexts.push(contextOf(scan))
    start = cut
  }
  return { length: text.length, starts, contexts, scan }
}

/** The slices `cuts` describe. */
export function textSlices(text: string, cuts: TextCuts): Array<{ offset: number; text: string; context?: TextFragmentContext }> {
  return cuts.starts.map((offset, i) => {
    const slice = { offset, text: text.slice(offset, cuts.starts[i + 1] ?? text.length) }
    const context = cuts.contexts[i]
    return context ? { ...slice, context } : slice
  })
}

/** Lines a slice starting mid-block needs before it to render as it did in place. */
export function textContextPrefix(context: TextFragmentContext | undefined): string {
  if (!context) return ''
  return [context.insight, context.fence, context.table].filter(Boolean).map((line) => `${line}\n`).join('')
}

function chooseCut(text: string, start: number, size: number): number {
  const window = text.slice(start, start + size)
  const floor = size >> 1
  const paragraph = window.lastIndexOf('\n\n')
  if (paragraph >= floor) return start + paragraph + 2
  const line = window.lastIndexOf('\n')
  if (line >= floor) return start + line + 1
  const space = window.lastIndexOf(' ')
  if (space >= floor) return start + space + 1
  const end = start + size
  const code = text.charCodeAt(end - 1)
  return code >= 0xd800 && code <= 0xdbff ? end - 1 : end
}

function emptyScan(): ScanState {
  return { pos: 0, fence: null, fenceMarker: '', table: null, insight: null }
}

/** Advance over every complete line that ends before `offset`. */
function scanTo(text: string, state: ScanState, offset: number): ScanState {
  const next = { ...state }
  while (next.pos < offset) {
    const newline = text.indexOf('\n', next.pos)
    if (newline < 0 || newline >= offset) break
    scanLine(next, text.slice(next.pos, newline))
    next.pos = newline + 1
  }
  return next
}

function scanLine(state: ScanState, line: string): void {
  if (state.fence) {
    if (line.trim().startsWith(state.fenceMarker) && line.trim().replace(/[`~]/g, '') === '') {
      state.fence = null
      state.fenceMarker = ''
    }
    return
  }
  const fence = line.match(FENCE_OPEN)
  if (fence) {
    state.fence = line
    state.fenceMarker = fence[1]
    state.table = null
    return
  }
  if (state.insight) {
    if (INSIGHT_FOOTER_LINE.test(line) || INSIGHT_INLINE_FOOTER_LINE.test(line)) state.insight = null
    else if (INSIGHT_HEADER_LINE.test(line)) state.insight = line
  } else if (INSIGHT_HEADER_LINE.test(line)) {
    state.insight = line
  }
  if (line.trimStart().startsWith('|')) {
    if (!state.table) state.table = [line]
    else if (state.table.length < 2) state.table.push(line)
  } else {
    state.table = null
  }
}

function contextOf(state: ScanState): TextFragmentContext | undefined {
  const context: TextFragmentContext = {}
  if (state.insight) context.insight = state.insight
  if (state.fence) context.fence = state.fence
  if (state.table && state.table.length === 2) context.table = state.table.join('\n')
  return Object.keys(context).length ? context : undefined
}
