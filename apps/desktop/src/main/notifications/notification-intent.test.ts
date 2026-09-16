import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import { RunTracker, intentForEvent, withdrawIdForEvent, type IntentContext } from './notification-intent'

function ctx(overrides: Partial<IntentContext> = {}): IntentContext {
  return {
    t: (key, options) => (options ? `${key}:${JSON.stringify(options)}` : key),
    describeSession: () => ({ title: 'Fix login', projectPath: '/repo/app' }),
    now: () => 1000,
    ...overrides,
  }
}

describe('intentForEvent', () => {
  it('maps a bare permission_request to the permission kind, keyed by requestId', () => {
    const event: AgentEvent = {
      type: 'permission_request',
      sessionId: 'sid',
      request: { requestId: 'req-1', toolName: 'Bash', input: {}, allowAlwaysAllow: true },
    }
    const intent = intentForEvent(event, ctx())
    expect(intent).toMatchObject({ id: 'req-1', kind: 'permission', sessionId: 'sid', projectPath: '/repo/app' })
    // Two lines only: session as title, a fixed status as body.
    expect(intent!.title).toBe('Fix login')
    expect(intent!.body).toBe('notifications.waitingApproval')
  })

  it('routes a permission_request carrying requestKind to confirm, not permission', () => {
    const event: AgentEvent = {
      type: 'permission_request',
      sessionId: 'sid',
      request: {
        requestId: 'elicit_1',
        toolName: 'my-server',
        input: {},
        allowAlwaysAllow: false,
        requestKind: 'mcp_elicitation',
        serverName: 'my-server',
        message: 'Which environment?',
      },
    }
    const intent = intentForEvent(event, ctx())
    expect(intent!.kind).toBe('confirm')
    // Server-authored elicitation text stays in the app; the banner is a fixed status.
    expect(intent!.body).toBe('notifications.waitingApproval')
  })

  it('sends session_collab_request through the confirm kind', () => {
    const event: AgentEvent = {
      type: 'permission_request',
      sessionId: 'sid',
      request: {
        requestId: 'sessionagents_1',
        toolName: 'session_collab_request',
        input: {},
        allowAlwaysAllow: false,
        requestKind: 'session_agents_confirm',
        sessionAgentsConfirm: {
          launches: [{ mode: 'spawn', agentId: 'reviewer', name: 'DiffBot', role: 'Reviewer' }],
        },
      },
    } as AgentEvent
    const intent = intentForEvent(event, ctx())
    expect(intent!.kind).toBe('confirm')
    expect(intent!.body).toBe('notifications.waitingApproval')
  })

  it('keeps host confirms that set no requestKind in the permission bucket', () => {
    const event: AgentEvent = {
      type: 'permission_request',
      sessionId: 'sid',
      request: {
        requestId: 'miniapp_1',
        toolName: 'mcp__superone__miniapp_call',
        input: {},
        allowAlwaysAllow: false,
        requestKind: undefined,
      },
    }
    expect(intentForEvent(event, ctx())!.kind).toBe('permission')
  })

  it('maps plan_approval', () => {
    const event: AgentEvent = {
      type: 'plan_approval',
      sessionId: 'sid',
      request: { requestId: 'p-1', planContent: '...', planFilePath: '/tmp/p.md', allowedPrompts: [] },
    }
    expect(intentForEvent(event, ctx())!.kind).toBe('plan')
  })

  it('falls back to the project basename when the session has no title yet', () => {
    const event: AgentEvent = {
      type: 'permission_request',
      sessionId: 'sid',
      request: { requestId: 'req-1', toolName: 'Bash', input: {}, allowAlwaysAllow: true },
    }
    const intent = intentForEvent(event, ctx({ describeSession: () => ({ title: null, projectPath: '/repo/app' }) }))
    expect(intent!.title).toBe('app')
  })

  it('ignores events with no sessionId — there would be nothing to focus', () => {
    const event: AgentEvent = {
      type: 'permission_request',
      request: { requestId: 'req-1', toolName: 'Bash', input: {}, allowAlwaysAllow: true },
    }
    expect(intentForEvent(event, ctx())).toBeNull()
  })

  it('ignores ordinary stream traffic', () => {
    expect(intentForEvent({ type: 'status_change', status: 'streaming', sessionId: 'sid' }, ctx())).toBeNull()
    expect(intentForEvent({ type: 'message_complete', messageId: 'm', sessionId: 'sid' }, ctx())).toBeNull()
  })

  it('ignores idle unless the caller says it closes a run', () => {
    expect(intentForEvent({ type: 'status_change', status: 'idle', sessionId: 'sid' }, ctx())).toBeNull()
    expect(intentForEvent({ type: 'status_change', status: 'idle', sessionId: 'sid' }, ctx({ runCompleted: false }))).toBeNull()
  })

  it('maps a completed run to the completed kind with a status line, not the agent’s prose', () => {
    const intent = intentForEvent(
      { type: 'status_change', status: 'idle', sessionId: 'sid' },
      ctx({ runCompleted: true }),
    )
    expect(intent).toMatchObject({ id: 'completed:sid', kind: 'completed', sessionId: 'sid', title: 'Fix login', body: 'notifications.completed' })
  })

  it('keeps interaction banners to a fixed status line — the question itself lives in the app', () => {
    const question: AgentEvent = {
      type: 'ask_user_question',
      sessionId: 'sid',
      request: {
        requestId: 'q-1',
        questions: [{ question: 'x'.repeat(400), header: 'H', options: [], multiSelect: false }],
      },
    }
    const plan: AgentEvent = {
      type: 'plan_approval',
      sessionId: 'sid',
      request: { requestId: 'p-1', planContent: '...', planFilePath: '/tmp/p.md', allowedPrompts: [] },
    }
    expect(intentForEvent(question, ctx())!.body).toBe('notifications.waitingInput')
    expect(intentForEvent(plan, ctx())!.body).toBe('notifications.waitingApproval')
  })
})

describe('withdrawIdForEvent', () => {
  it('withdraws on interaction_resolved regardless of who answered', () => {
    expect(withdrawIdForEvent({ type: 'interaction_resolved', interactionType: 'permission', requestId: 'req-1' })).toBe('req-1')
  })

  it('does not treat elicitation_complete as a withdrawal — its id is the SDK id, not our requestId', () => {
    expect(withdrawIdForEvent({ type: 'elicitation_complete', mcpServerName: 's', elicitationId: 'sdk-1' })).toBeNull()
  })

  it('returns null for unrelated events', () => {
    expect(withdrawIdForEvent({ type: 'status_change', status: 'idle' })).toBeNull()
  })

  it('retracts the session’s completion banner when a new run starts', () => {
    expect(withdrawIdForEvent({ type: 'status_change', status: 'streaming', sessionId: 'sid' })).toBe('completed:sid')
  })
})

describe('RunTracker', () => {
  const streaming: AgentEvent = { type: 'status_change', status: 'streaming', sessionId: 'sid' }
  const idle: AgentEvent = { type: 'status_change', status: 'idle', sessionId: 'sid' }

  it('reports the idle that closes a streamed run', () => {
    const tracker = new RunTracker()
    expect(tracker.observe(streaming)).toBe(false)
    expect(tracker.observe(idle)).toBe(true)
  })

  it('ignores an idle with no run behind it (init, reconnect replay)', () => {
    expect(new RunTracker().observe(idle)).toBe(false)
  })

  it('does not double-report: the run is consumed by its idle', () => {
    const tracker = new RunTracker()
    tracker.observe(streaming)
    tracker.observe(idle)
    expect(tracker.observe(idle)).toBe(false)
  })

  it('treats a run parked in background and then finished as completed', () => {
    const tracker = new RunTracker()
    tracker.observe(streaming)
    tracker.observe({ type: 'status_change', status: 'background', sessionId: 'sid' })
    expect(tracker.observe(idle)).toBe(true)
  })

  it('ignores an interrupted run — the user stopped it, they know', () => {
    const tracker = new RunTracker()
    tracker.observe(streaming)
    tracker.observe({ type: 'message_interrupted', messageId: 'm', sessionId: 'sid' })
    expect(tracker.observe(idle)).toBe(false)
  })

  it('ignores an errored run and an error status', () => {
    const tracker = new RunTracker()
    tracker.observe(streaming)
    tracker.observe({ type: 'message_error', messageId: 'm', error: 'x', sessionId: 'sid' })
    expect(tracker.observe(idle)).toBe(false)
    tracker.observe(streaming)
    expect(tracker.observe({ type: 'status_change', status: 'error', sessionId: 'sid' })).toBe(false)
  })

  it('ignores message_complete — Codex fires it at every queued-turn boundary', () => {
    const tracker = new RunTracker()
    tracker.observe(streaming)
    tracker.observe({ type: 'message_complete', messageId: 'm', sessionId: 'sid' })
    expect(tracker.observe(idle)).toBe(true)
  })

  it('tracks sessions independently', () => {
    const tracker = new RunTracker()
    tracker.observe(streaming)
    expect(tracker.observe({ type: 'status_change', status: 'idle', sessionId: 'other' })).toBe(false)
    expect(tracker.observe(idle)).toBe(true)
  })
})
