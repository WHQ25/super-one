import { describe, expect, it, vi } from 'vitest'

vi.mock('../logger', () => ({ default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('../mcp/superone-mcp-server', () => ({
  isToolPreapproved: vi.fn(() => false),
  isBuiltInSuperoneTool: vi.fn(() => false),
}))

import type { AgentEvent } from '@superone/shared/agent-types'
import {
  createOnElicitation,
  respondToElicitation,
  rejectAllPending,
  type PendingElicitation,
  type PendingPermission,
} from './claude-permissions'
import type { ElicitationRequest } from '@anthropic-ai/claude-agent-sdk'

function makeRequest(overrides: Partial<ElicitationRequest> = {}): ElicitationRequest {
  return {
    serverName: 'some-mcp-server',
    message: 'Which environment should I deploy to?',
    mode: 'form',
    requestedSchema: {
      type: 'object',
      properties: { environment: { type: 'string', title: 'Environment' } },
      required: ['environment'],
    },
    ...overrides,
  }
}

function makeSignal(aborted = false): AbortSignal {
  return { aborted } as AbortSignal
}

describe('createOnElicitation', () => {
  it('declines url-mode requests immediately', async () => {
    const pending = new Map<string, PendingElicitation>()
    const emit = vi.fn()
    const onElicitation = createOnElicitation(pending, emit)
    const result = await onElicitation(makeRequest({ mode: 'url', url: 'https://example.com' }), { signal: makeSignal() })
    expect(result).toEqual({ action: 'decline' })
    expect(emit).not.toHaveBeenCalled()
    expect(pending.size).toBe(0)
  })

  it('emits mcp_elicitation with parsed form fields and parks the promise', async () => {
    const pending = new Map<string, PendingElicitation>()
    const events: AgentEvent[] = []
    const onElicitation = createOnElicitation(pending, (e) => events.push(e))
    const promise = onElicitation(makeRequest(), { signal: makeSignal() })

    expect(events).toHaveLength(1)
    const event = events[0]
    if (event.type !== 'permission_request') throw new Error('expected permission_request')
    expect(event.request.requestKind).toBe('mcp_elicitation')
    expect(event.request.schemaForm).toEqual({
      supported: true,
      fields: [{ name: 'environment', kind: 'text', label: 'Environment', required: true }],
    })
    // Phone builds that predate schemaForm still read the flat list.
    expect(event.request.elicitationForm).toEqual([
      { name: 'environment', type: 'string', label: 'Environment', required: true },
    ])
    expect(pending.size).toBe(1)

    respondToElicitation(pending, event.request.requestId, true, undefined, { environment: 'staging' })
    await expect(promise).resolves.toEqual({ action: 'accept', content: { environment: 'staging' } })
  })

  it('resolves cancel immediately when the signal is already aborted', async () => {
    const pending = new Map<string, PendingElicitation>()
    const onElicitation = createOnElicitation(pending, vi.fn())
    const result = await onElicitation(makeRequest(), { signal: makeSignal(true) })
    expect(result).toEqual({ action: 'cancel' })
    expect(pending.size).toBe(0)
  })
})

describe('respondToElicitation', () => {
  function parkRequest(): { pending: Map<string, PendingElicitation>; requestId: string } {
    const pending = new Map<string, PendingElicitation>()
    const onElicitation = createOnElicitation(pending, vi.fn())
    void onElicitation(makeRequest(), { signal: makeSignal() })
    const requestId = [...pending.keys()][0]
    return { pending, requestId }
  }

  it('accept packs formAnswers into flat content', async () => {
    const { pending, requestId } = parkRequest()
    const held = pending.get(requestId)!
    const resolved = new Promise((resolve) => held.resolve = resolve as never)
    expect(respondToElicitation(pending, requestId, true, undefined, { environment: 'staging' })).toBe(true)
    await expect(resolved).resolves.toEqual({ action: 'accept', content: { environment: 'staging' } })
  })

  it('keeps the request pending when the answers do not satisfy the form', () => {
    const { pending, requestId } = parkRequest()
    expect(respondToElicitation(pending, requestId, true, undefined, {})).toBe(false)
    expect(respondToElicitation(pending, requestId, true, undefined, { environment: 3 })).toBe(false)
    expect(pending.has(requestId)).toBe(true)
  })

  it('drops answers for fields the form does not declare', async () => {
    const { pending, requestId } = parkRequest()
    const held = pending.get(requestId)!
    const resolved = new Promise((resolve) => held.resolve = resolve as never)
    expect(respondToElicitation(pending, requestId, true, undefined, { environment: 'prod', extra: 'x' })).toBe(true)
    await expect(resolved).resolves.toEqual({ action: 'accept', content: { environment: 'prod' } })
  })

  it('never accepts a form it could not display', () => {
    const pending = new Map<string, PendingElicitation>()
    const events: AgentEvent[] = []
    void createOnElicitation(pending, (e) => events.push(e))(makeRequest({
      requestedSchema: { type: 'object', properties: { when: { type: 'string', format: 'color' } } },
    }), { signal: makeSignal() })
    const event = events[0]
    if (event?.type !== 'permission_request') throw new Error('expected permission_request')
    expect(event.request.schemaForm).toMatchObject({ supported: false, field: 'when' })
    expect(event.request.elicitationForm).toBeUndefined()
    expect(respondToElicitation(pending, event.request.requestId, true, undefined, { when: 'red' })).toBe(false)
  })

  it('reject forwards feedback as flat content', async () => {
    const { pending, requestId } = parkRequest()
    const held = pending.get(requestId)!
    const resolved = new Promise((resolve) => held.resolve = resolve as never)
    expect(respondToElicitation(pending, requestId, false, undefined, { feedback: 'too long' })).toBe(true)
    await expect(resolved).resolves.toEqual({ action: 'decline', content: { feedback: 'too long' } })
  })

  it('cancel decision resolves cancel regardless of allow', async () => {
    const { pending, requestId } = parkRequest()
    const held = pending.get(requestId)!
    const resolved = new Promise((resolve) => held.resolve = resolve as never)
    expect(respondToElicitation(pending, requestId, true, 'cancel')).toBe(true)
    await expect(resolved).resolves.toEqual({ action: 'cancel' })
  })

  it('returns false for unknown requestId', () => {
    expect(respondToElicitation(new Map(), 'nope', true)).toBe(false)
  })
})

describe('rejectAllPending with elicitations', () => {
  it('resolves parked elicitations as cancel (session interrupt path)', async () => {
    const perms = new Map<string, PendingPermission>()
    const elicitations = new Map<string, PendingElicitation>()
    const onElicitation = createOnElicitation(elicitations, vi.fn())
    const promise = onElicitation(makeRequest(), { signal: makeSignal() })
    expect(elicitations.size).toBe(1)

    rejectAllPending(perms, undefined, undefined, elicitations, 'backend.interrupt')
    await expect(promise).resolves.toEqual({ action: 'cancel' })
    expect(elicitations.size).toBe(0)
  })
})
