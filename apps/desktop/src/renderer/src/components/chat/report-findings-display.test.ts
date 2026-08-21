import { describe, expect, it } from 'vitest'
import { findingFileName, parseReportFindings, topFindingSummary } from './report-findings-display'

const FINDING = {
  file: 'apps/desktop/src/main/session/session.ts',
  line: 812,
  category: 'correctness',
  verdict: 'CONFIRMED',
  short_summary: 'Interrupt latch never clears',
  summary: 'The latch is set before the abort resolves and never cleared.',
  failure_scenario: 'Press Stop mid-tool → every later turn returns immediately.',
}

describe('parseReportFindings', () => {
  it('maps the tool schema onto camelCase fields', () => {
    const info = parseReportFindings({ level: 'high', findings: [FINDING] })
    expect(info.level).toBe('high')
    expect(info.clean).toBe(false)
    expect(info.findings).toEqual([{
      file: FINDING.file,
      line: 812,
      summary: FINDING.summary,
      shortSummary: FINDING.short_summary,
      failureScenario: FINDING.failure_scenario,
      category: 'correctness',
      verdict: 'CONFIRMED',
      outcome: undefined,
    }])
  })

  it('reads a complete empty array as a clean review, not as missing input', () => {
    expect(parseReportFindings({ findings: [] }).clean).toBe(true)
    // Mid-stream the key has not arrived yet — that is not a clean review.
    expect(parseReportFindings({}).clean).toBe(false)
    expect(parseReportFindings({ level: 'max' }).findings).toEqual([])
  })

  it('accepts findings that arrived as a JSON string', () => {
    const info = parseReportFindings({ findings: JSON.stringify([FINDING]) })
    expect(info.findings).toHaveLength(1)
    expect(info.findings[0].shortSummary).toBe(FINDING.short_summary)
  })

  it('drops half-streamed entries but keeps a finding that only has a file', () => {
    const info = parseReportFindings({
      findings: [FINDING, {}, { file: 'a.ts' }, null, 'garbage'],
    })
    expect(info.findings.map((f) => f.file)).toEqual([FINDING.file, 'a.ts'])
    expect(info.findings[1].summary).toBe('')
  })

  it('ignores values outside the schema enums', () => {
    const info = parseReportFindings({
      level: 'extreme',
      findings: [{ ...FINDING, verdict: 'MAYBE', outcome: 'reverted', line: 'x' }],
    })
    expect(info.level).toBeUndefined()
    expect(info.findings[0].verdict).toBeUndefined()
    expect(info.findings[0].outcome).toBeUndefined()
    expect(info.findings[0].line).toBeUndefined()
  })
})

describe('topFindingSummary', () => {
  it('uses the first finding — the list is ranked most-severe first', () => {
    const summary = topFindingSummary({
      findings: [FINDING, { file: 'b.ts', summary: 'second' }],
    })
    expect(summary).toBe(FINDING.short_summary)
  })

  it('falls back to the full summary, and says so when the review was clean', () => {
    expect(topFindingSummary({ findings: [{ file: 'b.ts', summary: 'only a summary' }] }))
      .toBe('only a summary')
    expect(topFindingSummary({ findings: [] })).toBe('no findings')
    expect(topFindingSummary({})).toBe('')
  })
})

describe('findingFileName', () => {
  it('keeps the basename the chip shows', () => {
    expect(findingFileName('apps/desktop/src/main/session/session.ts')).toBe('session.ts')
    expect(findingFileName('vitest.config.ts')).toBe('vitest.config.ts')
  })
})
