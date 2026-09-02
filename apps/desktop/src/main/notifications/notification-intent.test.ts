import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import { intentForEvent, withdrawIdForEvent, type IntentContext } from './notification-intent'

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
    expect(intent!.title).toContain('notifications.kind.permission.title')
    expect(intent!.title).toContain('Fix login')
    // Body comes from the shared pending-reason helper, same as the sidebar.
    expect(intent!.body).toContain('sidebar.pending.allowTool')
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
    expect(intent!.body).toBe('Which environment?')
  })

  it('sends session_collab_request through the confirm kind with the sidebar’s own copy', () => {
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
    // Same key the sidebar row renders — the two surfaces must not drift.
    expect(intent!.body).toContain('sidebar.pending.collabOneWithRole')
    expect(intent!.body).toContain('DiffBot')
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

  it('uses the first question text as the body', () => {
    const event: AgentEvent = {
      type: 'ask_user_question',
      sessionId: 'sid',
      request: {
        requestId: 'q-1',
        questions: [
          { question: 'Which database?', header: 'DB', options: [], multiSelect: false },
          { question: 'Ignored', header: 'X', options: [], multiSelect: false },
        ],
      },
    }
    const intent = intentForEvent(event, ctx())
    expect(intent!.kind).toBe('question')
    expect(intent!.body).toBe('Which database?')
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
    expect(intent!.title).toContain('app')
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

  it('collapses whitespace and truncates a long body', () => {
    const event: AgentEvent = {
      type: 'ask_user_question',
      sessionId: 'sid',
      request: {
        requestId: 'q-1',
        questions: [{ question: `a\n\n${'x'.repeat(400)}`, header: 'H', options: [], multiSelect: false }],
      },
    }
    const body = intentForEvent(event, ctx())!.body
    expect(body.length).toBeLessThanOrEqual(180)
    expect(body.endsWith('…')).toBe(true)
    expect(body).not.toContain('\n')
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
})
