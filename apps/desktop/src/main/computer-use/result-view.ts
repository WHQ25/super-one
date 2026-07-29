import {
  DEFAULT_OUTPUT_MAX_CHARS,
  DEFAULT_OUTPUT_PREVIEW_CHARS,
} from './types'

export interface OutputBoundOptions {
  maxChars?: number
  previewChars?: number
}

export interface BoundOutput {
  text: string
  truncated: boolean
  /** When truncated, an immutable continuation handle (not a live re-query). */
  continuationRef?: string
  totalChars: number
}

let outputSeq = 0
const continuations = new Map<string, string>()

/** Bound a large string payload; oversized results get an immutable `@o` ref. */
export function boundText(text: string, options: OutputBoundOptions = {}): BoundOutput {
  const maxChars = options.maxChars ?? DEFAULT_OUTPUT_MAX_CHARS
  const previewChars = options.previewChars ?? DEFAULT_OUTPUT_PREVIEW_CHARS
  const totalChars = text.length
  if (totalChars <= maxChars) {
    return { text, truncated: false, totalChars }
  }
  outputSeq += 1
  const continuationRef = `@o${outputSeq}`
  continuations.set(continuationRef, text)
  return {
    text: text.slice(0, previewChars),
    truncated: true,
    continuationRef,
    totalChars,
  }
}

/** Read a previously spilled continuation by UTF-16 offset (P0: character offset). */
export function readContinuation(
  ref: string,
  offset = 0,
  limit = DEFAULT_OUTPUT_PREVIEW_CHARS,
): { text: string; offset: number; done: boolean; totalChars: number } | undefined {
  const full = continuations.get(ref)
  if (full === undefined) return undefined
  const slice = full.slice(offset, offset + limit)
  return {
    text: slice,
    offset,
    done: offset + slice.length >= full.length,
    totalChars: full.length,
  }
}

/** Test helper — wipe continuation store. */
export function clearContinuations(): void {
  continuations.clear()
  outputSeq = 0
}

/** Continuations are immutable: re-read always returns the same payload. */
export function getContinuationRaw(ref: string): string | undefined {
  return continuations.get(ref)
}
