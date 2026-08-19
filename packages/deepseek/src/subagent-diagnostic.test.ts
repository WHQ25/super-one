/**
 * The diagnostic parser, pinned against upstream's own composition.
 *
 * `dsh-tool-subagent`'s `withDiagnosticAndPartialText()` builds the string this
 * parses. The fixtures below are assembled the same way it does, so a change to
 * that wording fails here rather than silently costing every Task chip its
 * failure detail.
 */

import { describe, expect, it } from 'vitest'
import {
  SUBAGENT_DIAGNOSTIC_MAX_BYTES,
  extractSubagentDiagnostic,
  truncateUtf8,
} from './subagent-diagnostic'

/** Reproduces `withDiagnosticAndPartialText()` exactly. */
function upstreamError(headline: string, diagnostic?: string, partial?: string): string {
  return `${headline}${diagnostic === undefined ? '' : `\nDiagnostic: ${diagnostic}`}`
    + `${partial === undefined || partial.length === 0 ? '' : `\nPartial output before the run ended:\n${partial}`}`
}

describe('extractSubagentDiagnostic', () => {
  it('takes the diagnostic and leaves the headline and partial output behind', () => {
    const message = upstreamError(
      'subagent run failed',
      'provider returned HTTP 503 after 5 attempts',
      'I was checking the build when',
    )
    expect(extractSubagentDiagnostic(message)).toBe('provider returned HTTP 503 after 5 attempts')
  })

  it('keeps a multi-line diagnostic whole', () => {
    const message = upstreamError('subagent run failed', 'line one\nline two', 'partial answer')
    expect(extractSubagentDiagnostic(message)).toBe('line one\nline two')
  })

  it('reads a diagnostic that has no partial output after it', () => {
    expect(extractSubagentDiagnostic(upstreamError('subagent declined the task', 'refused: unsafe request')))
      .toBe('refused: unsafe request')
  })

  it('yields nothing when the failure carried no diagnostic', () => {
    expect(extractSubagentDiagnostic(upstreamError('subagent run failed', undefined, 'partial'))).toBeUndefined()
    expect(extractSubagentDiagnostic('subagent run failed')).toBeUndefined()
  })

  it('never mistakes the child’s own output for a diagnostic', () => {
    // The child wrote something that looks like the marker. It sits after the
    // partial-output marker, so it is output and must not be lifted out of it.
    const message = upstreamError('subagent run failed', undefined, 'Diagnostic: I think the API is down')
    expect(extractSubagentDiagnostic(message)).toBeUndefined()
  })

  it('bounds a provider that ignores the documented cap', () => {
    const oversized = 'x'.repeat(SUBAGENT_DIAGNOSTIC_MAX_BYTES * 2)
    const extracted = extractSubagentDiagnostic(upstreamError('subagent run failed', oversized))
    expect(extracted).toBeDefined()
    expect(new TextEncoder().encode(extracted).byteLength).toBe(SUBAGENT_DIAGNOSTIC_MAX_BYTES)
  })
})

describe('truncateUtf8', () => {
  it('measures bytes, not UTF-16 units, and never splits a character', () => {
    // Each of these is 3 UTF-8 bytes, so 4 of them exceed a 10-byte budget and
    // the cut lands mid-character — the case a `.slice()` by length gets wrong.
    const cut = truncateUtf8('宽宽宽宽', 10)
    expect(cut).toBe('宽宽宽')
    expect(new TextEncoder().encode(cut).byteLength).toBeLessThanOrEqual(10)
  })

  it('leaves text that already fits exactly as it was', () => {
    expect(truncateUtf8('short', 4096)).toBe('short')
  })
})
