import { describe, expect, it, vi } from 'vitest'

vi.mock('../logger', () => ({ default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('../mcp/superone-mcp-server', () => ({
  isToolPreapproved: vi.fn(() => false),
  isBuiltInSuperoneTool: vi.fn(() => false),
}))

import type { AgentEvent } from '@superone/shared/agent-types'
import { parseElicitationSchema } from './elicitation-schema'
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

describe('parseElicitationSchema', () => {
  it('parses flat string/number/boolean/enum properties into form fields', () => {
    const fields = parseElicitationSchema({
      type: 'object',
      properties: {
        name: { type: 'string', title: 'Your name', description: 'Full name' },
        age: { type: 'number' },
        agree: { type: 'boolean' },
        color: { type: 'string', enum: ['red', 'blue'] },
        nested: { type: 'object' },
      },
      required: ['name'],
    })
    expect(fields).toEqual([
      { name: 'name', type: 'string', label: 'Your name', description: 'Full name', required: true },
      { name: 'age', type: 'number', label: 'age', required: false },
      { name: 'agree', type: 'boolean', label: 'agree', required: false },
      { name: 'color', type: 'enum', label: 'color', required: false, enumOptions: ['red', 'blue'] },
    ])
  })

  it('returns [] for null schema or empty properties', () => {
    expect(parseElicitationSchema(null)).toEqual([])
    expect(parseElicitationSchema({ type: 'object', properties: {} })).toEqual([])
  })
})

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
