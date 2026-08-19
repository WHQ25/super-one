import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { projectTrajectory, RECORD_WINDOW } from './project'
import { HEADER, assistantMessage, log } from './test-log'

describe('projectTrajectory', () => {
  it('numbers requests across generation and compaction in one chronological space', () => {
    const projection = projectTrajectory('s1', log([
      ['request/header', { header: HEADER, reason: 'initial' }],
      ['turn/start', { turn: 0 }],
      ['step/start', { turn: 0, step: 0 }],
      ['assistant/message', { turn: 0, step: 0, message: assistantMessage('hi') }],
      ['step/end', { turn: 0, step: 0 }],
      ['turn/end', { turn: 0, reason: { kind: 'completed' } }],
      ['compaction/start', { compactionId: 'c1', turn: null }],
      ['compaction/end', { compactionId: 'c1', turn: null }],
      ['turn/start', { turn: 1 }],
      ['step/start', { turn: 1, step: 0 }],
      ['assistant/message', { turn: 1, step: 0, message: assistantMessage('again') }],
      ['step/end', { turn: 1, step: 0 }],
    ]), false)

    expect(projection.requests.map((request) => [request.ordinal, request.purpose])).toEqual([
      [1, 'generation'],
      [2, 'compaction'],
      [3, 'generation'],
    ])
  })

  it('measures TTFT from step start to the first non-empty delta', () => {
    const projection = projectTrajectory('s1', log([
      ['step/start', { turn: 0, step: 0 }, 1_000],
      // Structural frames and an empty delta must not start the clock.
      ['assistant/chunk', { turn: 0, step: 0, chunk: { type: 'block-start', index: 0, blockType: 'text' } }, 1_100],
      ['assistant/chunk', { turn: 0, step: 0, chunk: { type: 'text-delta', index: 0, text: '' } }, 1_200],
      ['assistant/chunk', { turn: 0, step: 0, chunk: { type: 'text-delta', index: 0, text: 'a' } }, 1_400],
      ['assistant/chunk', { turn: 0, step: 0, chunk: { type: 'text-delta', index: 0, text: 'b' } }, 1_500],
      ['assistant/message', { turn: 0, step: 0, message: assistantMessage('ab') }, 1_900],
      ['step/end', { turn: 0, step: 0 }, 1_950],
    ]), false)

    const message = projection.records.find((record) => record.kind === 'message')
    expect(message).toMatchObject({ ttftMs: 400, durationMs: 900, startedAt: 1_000 })
    expect(projection.requests[0]).toMatchObject({ ttftMs: 400, durationMs: 950 })
  })

  it('pairs a tool result with its call and attaches the call-time schema', () => {
    const projection = projectTrajectory('s1', log([
      ['request/header', { header: HEADER, reason: 'initial' }],
      ['step/start', { turn: 0, step: 0 }, 1_000],
      ['tool/call', { turn: 0, step: 0, callId: 'call-1', name: 'read', arguments: '{"path":"a.ts"}' }, 1_200],
      ['tool/result', {
        turn: 0,
        step: 0,
        message: {
          id: 'm',
          role: 'user',
          source: { kind: 'tool', callId: 'call-1' },
          content: [{ type: 'tool-result', toolCallId: 'call-1', isError: true, content: [{ type: 'text', text: 'ENOENT' }] }],
        },
        error: { name: 'NotFound', code: 'ENOENT' },
      }, 1_700],
    ]), false)

    const tool = projection.records.find((record) => record.kind === 'tool')
    expect(tool).toMatchObject({
      name: 'read',
      callId: 'call-1',
      durationMs: 500,
      isError: true,
      error: { name: 'NotFound', code: 'ENOENT' },
    })
    expect(tool?.kind === 'tool' && tool.args.text).toBe('{"path":"a.ts"}')
    expect(tool?.kind === 'tool' && tool.result?.text).toBe('ENOENT')
    expect(tool?.kind === 'tool' && tool.schema?.description).toBe('read a file')
  })

  it('separates a human prompt from a producer-injected context', () => {
    const projection = projectTrajectory('s1', log([
      ['user/message', {
        id: 'u1',
        role: 'user',
        source: { kind: 'user' },
        content: [{ type: 'text', text: 'fix the build' }],
      }],
      ['user/message', {
        id: 'u2',
        role: 'user',
        source: { kind: 'plugin', plugin: 'dsh-agents-md', form: 'instructions' },
        content: [{ type: 'text', text: '# AGENTS.md\nalways run tests' }],
      }],
    ]), false)

    expect(projection.records.map((record) => record.kind)).toEqual(['user', 'context'])
    const context = projection.records[1]
    expect(context).toMatchObject({ kind: 'context', producer: 'dsh-agents-md', form: 'instructions' })
  })

  it("uses a notice's one-line account as its ledger summary", () => {
    const projection = projectTrajectory('s1', log([
      ['user/message', {
        id: 'u1',
        role: 'user',
        source: { kind: 'plugin', plugin: 'dsh-fs-watch', form: 'notice', summary: 'src/a.ts changed on disk' },
        content: [{ type: 'text', text: 'The file src/a.ts was modified outside the session. Full contents follow…' }],
      }],
    ]), false)

    expect(projection.records[0]?.summary).toBe('src/a.ts changed on disk')
  })

  it('skips the surface replacement a compaction rides on', () => {
    const projection = projectTrajectory('s1', log([
      ['compaction/start', { compactionId: 'c1', turn: null }, 1_000],
      ['compaction/summary', {
        compactionId: 'c1',
        summary: [{ type: 'text', text: 'so far: we fixed the build' }],
        shadowedRange: { start: 0, end: 4 },
        shadowedSeqs: [0, 1, 2, 3, 4],
        shadowedTokenCount: 8_000,
        provider: 'deepseek',
        model: 'deepseek-chat',
        usage: { inputTokens: 8_000, outputTokens: 120 },
      }, 1_500],
      ['compaction/end', { compactionId: 'c1', turn: null }, 1_800],
    ]), false)

    // The replacement `user/message` carries a `replace` surfaceOp; the fold
    // must not project it beside the compacted record that already stands for it.
    const withReplacement = [...log([
      ['compaction/start', { compactionId: 'c1', turn: null }],
    ]), {
      type: 'user/message',
      seq: 1,
      time: 1_010,
      surfaceOp: { op: 'replace', start: 0, end: 4 },
      data: { id: 'r', role: 'user', source: { kind: 'plugin', plugin: 'compaction' }, content: [{ type: 'text', text: 'summary' }] },
    }] as SessionEvent[]

    expect(projection.records).toHaveLength(1)
    expect(projection.records[0]).toMatchObject({
      kind: 'compacted',
      trigger: 'manual',
      preTokens: 8_000,
      postTokens: 120,
      durationMs: 800,
    })
    expect(projectTrajectory('s1', withReplacement, false).records.map((r) => r.kind)).toEqual(['compacted'])
  })

  it('closes an approval ask with its decision', () => {
    const projection = projectTrajectory('s1', log([
      ['approval/asked', { id: 'a1', toolName: 'bash', callId: 'call-9', reason: 'writes outside the workspace' }, 1_000],
      ['approval/decided', { id: 'a1', outcome: 'allowed-once' }, 3_000],
    ]), false)

    expect(projection.records).toHaveLength(1)
    expect(projection.records[0]).toMatchObject({
      kind: 'approval',
      toolName: 'bash',
      callId: 'call-9',
      outcome: 'allowed-once',
      durationMs: 2_000,
    })
  })

  it('accumulates usage across steps and reports turn outcomes', () => {
    const projection = projectTrajectory('s1', log([
      ['turn/start', { turn: 0 }, 1_000],
      ['step/start', { turn: 0, step: 0 }],
      ['assistant/message', {
        turn: 0,
        step: 0,
        message: assistantMessage('a'),
        usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 40, reasoningTokens: 5 },
      }],
      ['step/end', { turn: 0, step: 0 }],
      ['step/start', { turn: 0, step: 1 }],
      ['assistant/message', {
        turn: 0,
        step: 1,
        message: assistantMessage('b'),
        usage: { inputTokens: 200, outputTokens: 20 },
      }],
      ['step/end', { turn: 0, step: 1 }],
      ['turn/end', { turn: 0, reason: { kind: 'aborted', reason: { kind: 'user' } } }, 9_000],
    ]), false)

    expect(projection.totals).toEqual({ input: 300, output: 30, cacheRead: 40, cacheWrite: 0, reasoning: 5 })
    expect(projection.turns[0]).toMatchObject({ turn: 0, outcome: 'aborted', steps: 2, durationMs: 8_000 })
  })

  it('keeps the tail when the window bound is reached and states where it starts', () => {
    const entries: Array<[SessionEvent['type'], unknown]> = []
    for (let i = 0; i < RECORD_WINDOW + 5; i += 1) {
      entries.push(['user/message', {
        id: `u${i}`,
        role: 'user',
        source: { kind: 'user' },
        content: [{ type: 'text', text: `prompt ${i}` }],
      }])
    }
    const projection = projectTrajectory('s1', log(entries), false)

    expect(projection.total).toBe(RECORD_WINDOW + 5)
    expect(projection.firstIndex).toBe(6)
    expect(projection.records).toHaveLength(RECORD_WINDOW)
    // Ledger positions stay absolute, so a dropped prefix does not renumber
    // the records a user is looking at.
    expect(projection.records[0]?.index).toBe(6)
    expect(projection.records[0]?.summary).toBe('prompt 5')
  })
})
