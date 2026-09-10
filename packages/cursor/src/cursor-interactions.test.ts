import { describe, expect, it } from 'vitest'
import type { AgentEvent, AskUserQuestionRequest, PlanApprovalRequest } from '@superone/shared/agent-types'
import {
  buildCursorAskUserQuestionRequest,
  buildCursorPlanApprovalRequest,
  CursorInteractionRegistry,
  cursorPlanFollowUpText,
  formatCursorQuestionResult,
} from './cursor-interactions'

function question(requestId = 'q1'): AskUserQuestionRequest {
  return {
    requestId,
    questions: [{
      question: 'Which database?',
      header: 'Database',
      options: [{ label: 'Postgres' }, { label: 'SQLite' }],
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
  it('builds an AskUserQuestionRequest from custom-tool args and drops malformed questions', () => {
    const request = buildCursorAskUserQuestionRequest('call-1', {
      questions: [
        { question: 'Pick one', options: [{ label: 'A' }, { label: 'B', description: 'second' }], multiSelect: true },
        { question: 'Only one option', options: [{ label: 'X' }] },
        { question: '', options: [{ label: 'A' }, { label: 'B' }] },
      ],
    })
    expect(request).toEqual({
      requestId: 'call-1',
      questions: [{
        question: 'Pick one',
        header: 'Pick one',
        options: [{ label: 'A', description: '' }, { label: 'B', description: 'second' }],
        multiSelect: true,
      }],
    })
    expect(buildCursorAskUserQuestionRequest('call-2', { questions: [] })).toBeNull()
    expect(buildCursorAskUserQuestionRequest('call-3', null)).toBeNull()
  })

  it('formats every answer kind as a tool result the model can read', () => {
    expect(formatCursorQuestionResult({ kind: 'answered', answers: { Q: 'A' } })).toEqual({ outcome: 'answered', answers: { Q: 'A' } })
    expect(formatCursorQuestionResult({ kind: 'dismissed' })).toMatchObject({ outcome: 'dismissed' })
    expect(formatCursorQuestionResult({ kind: 'cancelled', reason: 'turn ended' })).toEqual({ outcome: 'cancelled', reason: 'turn ended' })
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
