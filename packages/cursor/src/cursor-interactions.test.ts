import { describe, expect, it } from 'vitest'
import type { AgentEvent, AskUserQuestionRequest, PlanApprovalRequest } from '@superone/shared/agent-types'
import {
  buildCursorAskUserQuestionRequest,
  buildCursorPlanApprovalRequest,
  CursorInteractionRegistry,
  cursorPlanFollowUpText,
  cursorQuestionToolPresentation,
  formatCursorQuestionResult,
  isCursorQuestionTool,
  unwrapCursorHostToolResult,
} from './cursor-interactions'

function question(requestId = 'q1'): AskUserQuestionRequest {
  return {
    requestId,
    questions: [{
      question: 'Which database?',
      header: 'Database',
      options: [{ label: 'Postgres', description: '' }, { label: 'SQLite', description: '' }],
      multiSelect: false,
    }],
  }
}

function plan(requestId = 'p1'): PlanApprovalRequest {
  return { requestId, planContent: '# Plan', planFilePath: '', allowedPrompts: [] }
}

function setup() {
  const events: AgentEvent[] = []
  const registry = new CursorInteractionRegistry((event) => events.push(event))
  return { events, registry }
}

describe('CursorInteractionRegistry', () => {
  it('registers a question before the ask_user_question event is emitted', () => {
    const { registry } = setup()
    let pendingAtEmit: AgentEvent[] = []
    const observed = new CursorInteractionRegistry(() => {
      // MobileBroadcaster reads getPendingInteractions() synchronously inside emit.
      pendingAtEmit = observed.pending()
    })
    void observed.askQuestion(question())
    expect(pendingAtEmit).toHaveLength(1)
    expect(pendingAtEmit[0]?.type).toBe('ask_user_question')
    expect(registry.size).toBe(0)
  })

  it('resolves an answered question and clears pending + emits interaction_resolved', async () => {
    const { events, registry } = setup()
    const answer = registry.askQuestion(question())
    expect(registry.pending().map((e) => e.type)).toEqual(['ask_user_question'])

    expect(registry.respondToQuestion('q1', { Database: 'Postgres' }, undefined)).toBe(true)
    await expect(answer).resolves.toEqual({ kind: 'answered', answers: { Database: 'Postgres' }, annotations: undefined })
    expect(registry.pending()).toEqual([])
    expect(events.at(-1)).toEqual({ type: 'interaction_resolved', interactionType: 'question', requestId: 'q1' })
  })

  it('dismisses a question without fabricating an answer', async () => {
    const { registry } = setup()
    const answer = registry.askQuestion(question())
    expect(registry.dismissQuestion('q1')).toBe(true)
    await expect(answer).resolves.toEqual({ kind: 'dismissed' })
    // Unknown ids are reported, never resolved twice.
    expect(registry.dismissQuestion('q1')).toBe(false)
    expect(registry.respondToQuestion('q1', {}, undefined)).toBe(false)
  })

  it('supersedes a duplicate request id instead of leaking the old resolver', async () => {
    const { registry } = setup()
    const first = registry.askQuestion(question())
    const second = registry.askQuestion(question())
    await expect(first).resolves.toEqual({ kind: 'cancelled', reason: 'superseded' })
    expect(registry.size).toBe(1)
    registry.respondToQuestion('q1', { Database: 'SQLite' }, undefined)
    await expect(second).resolves.toMatchObject({ kind: 'answered' })
  })

  it('cancelQuestions releases questions but keeps plan approvals', async () => {
    const { events, registry } = setup()
    const q = registry.askQuestion(question())
    const p = registry.requestPlanApproval(plan())
    registry.cancelQuestions('turn ended')
    await expect(q).resolves.toEqual({ kind: 'cancelled', reason: 'turn ended' })
    expect(registry.pending().map((e) => e.type)).toEqual(['plan_approval'])
    expect(events.filter((e) => e.type === 'interaction_resolved')).toHaveLength(1)

    registry.respondToPlanApproval('p1', true, undefined)
    await expect(p).resolves.toEqual({ kind: 'approved', feedback: undefined })
    expect(events.at(-1)).toEqual({
      type: 'interaction_resolved', interactionType: 'plan_approval', requestId: 'p1', approved: true, feedback: undefined,
    })
  })

  it('cancelPlans / cancelAll reject everything with approved:false', async () => {
    const { events, registry } = setup()
    const p = registry.requestPlanApproval(plan())
    const q = registry.askQuestion(question())
    registry.cancelAll('session closed')
    await expect(p).resolves.toEqual({ kind: 'cancelled', reason: 'session closed' })
    await expect(q).resolves.toEqual({ kind: 'cancelled', reason: 'session closed' })
    expect(registry.pending()).toEqual([])
    expect(events.filter((e) => e.type === 'interaction_resolved')).toEqual([
      { type: 'interaction_resolved', interactionType: 'question', requestId: 'q1' },
      { type: 'interaction_resolved', interactionType: 'plan_approval', requestId: 'p1', approved: false },
    ])
  })

  it('a newer plan replaces the older pending one and clears its indicator', async () => {
    const { events, registry } = setup()
    const first = registry.requestPlanApproval(plan('p1'))
    const second = registry.requestPlanApproval(plan('p2'))
    await expect(first).resolves.toEqual({ kind: 'cancelled', reason: 'superseded by a newer plan' })
    expect(registry.pending()).toEqual([{ type: 'plan_approval', request: plan('p2') }])
    expect(events.filter((e) => e.type === 'interaction_resolved')).toEqual([
      { type: 'interaction_resolved', interactionType: 'plan_approval', requestId: 'p1', approved: false },
    ])
    // A stale answer for the replaced plan is a no-op, not a second decision.
    expect(registry.respondToPlanApproval('p1', true, undefined)).toBe(false)
    registry.respondToPlanApproval('p2', true, undefined)
    await expect(second).resolves.toEqual({ kind: 'approved', feedback: undefined })
  })

  it('rejected plan carries feedback back to the resolver', async () => {
    const { registry } = setup()
    const p = registry.requestPlanApproval(plan())
    registry.respondToPlanApproval('p1', false, 'too risky')
    await expect(p).resolves.toEqual({ kind: 'rejected', feedback: 'too risky' })
  })
})

describe('question / plan request builders', () => {
  it('builds an AskUserQuestionRequest from valid custom-tool args', () => {
    expect(buildCursorAskUserQuestionRequest('call-1', {
      questions: [
        { question: 'Pick one', options: [{ label: 'A' }, { label: 'B', description: 'second' }], multiSelect: true },
      ],
    })).toEqual({
      ok: true,
      request: {
        requestId: 'call-1',
        questions: [{
          question: 'Pick one',
          header: 'Pick one',
          options: [{ label: 'A', description: '' }, { label: 'B', description: 'second' }],
          multiSelect: true,
        }],
      },
    })
  })

  it('rejects malformed or out-of-bounds payloads instead of trimming them', () => {
    const twoOptions = [{ label: 'A' }, { label: 'B' }]
    const reject = (args: unknown) => {
      const parsed = buildCursorAskUserQuestionRequest('call-x', args)
      expect(parsed.ok).toBe(false)
      return parsed.ok ? '' : parsed.error
    }
    expect(reject(null)).toMatch(/questions/)
    expect(reject({ questions: [] })).toMatch(/at least one/)
    expect(reject({ questions: Array.from({ length: 5 }, () => ({ question: 'Q', options: twoOptions })) })).toMatch(/at most 4/)
    // One bad question fails the whole call — the valid sibling is not asked alone.
    expect(reject({ questions: [{ question: 'Pick one', options: twoOptions }, { question: 'Only one', options: [{ label: 'X' }] }] }))
      .toMatch(/questions\[1\]\.options must contain 2–4/)
    expect(reject({ questions: [{ question: 'Q', options: Array.from({ length: 5 }, (_, i) => ({ label: `O${i}` })) }] }))
      .toMatch(/2–4 options \(got 5\)/)
    expect(reject({ questions: [{ question: '   ', options: twoOptions }] })).toMatch(/question must be a non-empty string/)
    expect(reject({ questions: [{ question: 'Q', options: [{ label: 'A' }, { label: '' }] }] })).toMatch(/options\[1\]\.label/)
  })

  it('formats every answer kind as a tool result the model can read', () => {
    expect(formatCursorQuestionResult({ kind: 'answered', answers: { Q: 'A' } })).toEqual({ outcome: 'answered', answers: { Q: 'A' } })
    // Free-text notes reach the model; option previews are host UI and stay out.
    expect(formatCursorQuestionResult({
      kind: 'answered',
      answers: { Q: 'Other' },
      annotations: { Q: { notes: 'Use the staging bucket', preview: '<b>x</b>' } },
    })).toEqual({ outcome: 'answered', answers: { Q: 'Other' }, notes: { Q: 'Use the staging bucket' } })
    const dismissed = formatCursorQuestionResult({ kind: 'dismissed' })
    expect(dismissed).toMatchObject({ outcome: 'dismissed' })
    expect(String(dismissed.note)).toMatch(/not approval/)
    expect(String(dismissed.note)).not.toMatch(/best judgment/)
    expect(formatCursorQuestionResult({ kind: 'cancelled', reason: 'turn ended' })).toEqual({ outcome: 'cancelled', reason: 'turn ended' })
  })

  it('shapes the custom tool call for the shared AskUserQuestion presenter', () => {
    expect(isCursorQuestionTool('mcp__custom-user-tools__superone_ask_user_question')).toBe(true)
    expect(isCursorQuestionTool('superone_ask_user_question')).toBe(true)
    expect(isCursorQuestionTool('mcp__superone__widget_show')).toBe(false)
    // Exact host identity: another server's same-named tool is not the bridge.
    expect(isCursorQuestionTool('mcp__vendor__superone_ask_user_question')).toBe(false)

    // The installed executor serializes the callback's return into one MCP text block.
    const envelope = (payload: unknown, isError = false) => ({
      content: [{ text: { text: typeof payload === 'string' ? payload : JSON.stringify(payload) } }],
      isError,
    })
    const questions = [{ question: 'Pick one', header: 'Pick', multiSelect: false, options: [{ label: 'A', description: '' }, { label: 'B', description: '' }] }]
    const answered = cursorQuestionToolPresentation(
      { questions },
      envelope({ outcome: 'answered', answers: { 'Pick one': 'B' }, notes: { 'Pick one': 'because' } }),
    )
    expect(answered.input).toEqual({ questions, answers: { 'Pick one': 'B' }, annotations: { 'Pick one': { notes: 'because' } } })
    expect(answered.summary).toBe('"Pick one"="B"')
    expect(answered.isError).toBe(false)

    const dismissed = cursorQuestionToolPresentation({ questions }, envelope({ outcome: 'dismissed', note: 'x' }))
    expect(dismissed.input).toEqual({ questions })
    expect(dismissed.summary).toMatch(/dismissed/)

    // Streaming call (no result yet) keeps the bare questions; rejected input is an error row.
    expect(cursorQuestionToolPresentation({ questions }, undefined)).toEqual({ input: { questions }, summary: null, isError: false })
    expect(cursorQuestionToolPresentation({ questions }, envelope('Invalid input: questions[0].question must be a non-empty string.', true)))
      .toEqual({ input: { questions }, summary: 'Invalid input: questions[0].question must be a non-empty string.', isError: true })
  })

  it('unwraps the SDK MCP envelope: structuredContent first, then JSON text, then raw text', () => {
    expect(unwrapCursorHostToolResult({ content: [{ text: { text: '{"a":1}' } }], isError: false, structuredContent: { a: 2 } }))
      .toEqual({ payload: { a: 2 }, isError: false })
    expect(unwrapCursorHostToolResult({ content: [{ text: { text: '{"a":1}' } }], isError: false })).toEqual({ payload: { a: 1 }, isError: false })
    // MCP wire shape (`{ type, text }`) as returned by a `{ content }` callback.
    expect(unwrapCursorHostToolResult({ content: [{ type: 'text', text: 'plain' }], isError: true })).toEqual({ payload: 'plain', isError: true })
    expect(unwrapCursorHostToolResult({ content: [], isError: true })).toEqual({ payload: undefined, isError: true })
    // Not an envelope: passed through, never flagged.
    expect(unwrapCursorHostToolResult({ outcome: 'answered' })).toEqual({ payload: { outcome: 'answered' }, isError: false })
  })

  it('maps createPlan args onto PlanApprovalRequest', () => {
    expect(buildCursorPlanApprovalRequest('call-9', { plan: '# Steps' })).toEqual({
      requestId: 'call-9', planContent: '# Steps', planFilePath: '', allowedPrompts: [],
    })
    expect(buildCursorPlanApprovalRequest('call-9', { plan: '   ' })).toBeNull()
    expect(buildCursorPlanApprovalRequest('call-9', {})).toBeNull()
  })

  it('turns plan decisions into follow-up text only when there is something to say', () => {
    expect(cursorPlanFollowUpText({ kind: 'approved' })).toMatch(/approved the plan/)
    expect(cursorPlanFollowUpText({ kind: 'approved', feedback: 'skip step 3' })).toContain('skip step 3')
    expect(cursorPlanFollowUpText({ kind: 'rejected', feedback: 'no' })).toMatch(/rejected the plan/)
    expect(cursorPlanFollowUpText({ kind: 'rejected' })).toBeNull()
    expect(cursorPlanFollowUpText({ kind: 'cancelled', reason: 'x' })).toBeNull()
  })
})
