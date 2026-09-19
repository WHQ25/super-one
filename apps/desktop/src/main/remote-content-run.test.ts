import { describe, expect, it } from 'vitest'
import { compactRunToolResult } from './remote-content'

describe('compactRunToolResult', () => {
  it('keeps the outcome and drops the snapshot that makes the result too big to send', () => {
    const summary = JSON.stringify({
      status: 'done',
      runId: 'r1b3edbf0',
      steps: 16,
      why: 'goal_satisfied 0.82',
      since_last: ['Click [4] Menu'],
      snapshot: { url: 'https://www.apple.com/macbook-air/specs/', title: 'Tech Specs', elements: Array.from({ length: 40 }, (_, i) => ({ index: String(i), role: 'link', label: `Link ${i}` })) },
    })
    expect(summary.length).toBeGreaterThan(200)
    // Truncating this JSON would leave the phone unable to parse the run at all.
    expect(JSON.parse(compactRunToolResult(summary)!)).toEqual({ status: 'done', runId: 'r1b3edbf0', steps: 16, why: 'goal_satisfied 0.82' })
  })

  it('leaves results that are not a run alone', () => {
    expect(compactRunToolResult(JSON.stringify({ ok: true, path: '/tmp/x.png' }))).toBeNull()
    expect(compactRunToolResult(JSON.stringify({ runId: 'r1', status: 'progressing' }))).toBeNull()
    expect(compactRunToolResult('not json')).toBeNull()
  })
})
