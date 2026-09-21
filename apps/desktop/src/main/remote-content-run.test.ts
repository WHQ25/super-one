import { describe, expect, it } from 'vitest'
import { compactRunToolResult } from './remote-content'
import { parseRunView } from '@superone/chat-view/presenters/run-display'

describe('compactRunToolResult', () => {
  it.each([false, true])('retains the finished rows, pause and elapsed time for the presenter (MCP=%s)', (envelope) => {
    const result = JSON.stringify({
      status: 'paused', runId: 'r1', steps: 1, elapsed_ms: 2400,
      progress: { completed: [{ label: 'Click Help', op: 'click', target: 'Help', outcome: 'worked' }], note: 'Ready' },
      question: { id: 'q1', reason: 'risky', type: 'choice', context: { why: 'Send the form?' }, options: [{ key: '1', label: 'Send' }] },
      snapshot: { text: 'x'.repeat(10000) },
    })
    const summary = envelope ? JSON.stringify({ content: [{ type: 'text', text: result }] }) : result
    const compact = compactRunToolResult(summary)!
    expect(JSON.parse(compact)).not.toHaveProperty('snapshot')
    const view = parseRunView([{ params: { goal: 'Open Help' }, result: compact, isStreaming: false }])
    expect(view).toMatchObject({ steps: 1, elapsedMs: 2400, status: 'paused', question: { id: 'q1', reason: 'risky', text: 'Send the form?', options: [{ key: '1', label: 'Send' }] } })
    expect(view.segments[0]).toMatchObject({ actions: [{ op: 'click', target: 'Help', outcome: 'worked' }], note: 'Ready' })
  })

  it('bounds presentation arrays and text without forwarding arbitrary result fields', () => {
    const compact = JSON.parse(compactRunToolResult(JSON.stringify({
      status: 'done', runId: 'r1', progress: { completed: Array.from({ length: 250 }, () => ({ label: 'x'.repeat(10000), extra: 'private' })) },
      question: { context: { why: 'x'.repeat(10000), secret: 'private' }, options: Array.from({ length: 120 }, () => ({ key: '1', label: 'Send' })) },
    }))!)
    expect(compact.progress.completed).toHaveLength(200)
    expect(compact.progress.completed[0].label).toHaveLength(500)
    expect(compact.question.options).toHaveLength(100)
    expect(JSON.stringify(compact)).not.toContain('private')
  })

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
