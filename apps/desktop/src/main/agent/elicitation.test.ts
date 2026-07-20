import { describe, expect, it, vi } from 'vitest'

vi.mock('../logger', () => ({ default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('../mcp/superone-mcp-server', () => ({
  isToolPreapproved: vi.fn(() => false),
  isBuiltInSuperoneTool: vi.fn(() => false),
}))

import {
  VIDEO_GEN_PARAMS_FIELD,
  type AgentEvent,
  type VideoGenConfirmPayload,
} from '@superone/shared/agent-types'
import { parseElicitationSchema, extractVideoGenConfirmPayload } from './elicitation-schema'
import {
  createOnElicitation,
  respondToElicitation,
  rejectAllPending,
  type PendingElicitation,
  type PendingPermission,
} from './claude-permissions'
import type { ElicitationRequest } from '@anthropic-ai/claude-agent-sdk'

function makePayload(): VideoGenConfirmPayload {
  return {
    params: {
      prompt: 'a cat walks through a neon city',
      provider: 'cred-ark',
      model: 'seedance-1.0',
      aspectRatio: '16:9',
      resolution: '720p',
      duration: 5,
      generateAudio: false,
      watermark: false,
      cameraFixed: false,
    },
    providers: [
      {
        id: 'cred-ark',
        label: 'Volcengine Ark',
        models: [{ id: 'seedance-1.0', label: 'Seedance 1.0' }],
        aspectRatios: ['16:9', '9:16'],
        resolutions: ['480p', '720p'],
      },
    ],
    referenceImages: [{ path: '/tmp/first.png', role: 'first_frame' }],
  }
}

function makeVideoGenSchema(payload: VideoGenConfirmPayload = makePayload()): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      [VIDEO_GEN_PARAMS_FIELD]: { type: 'string', description: JSON.stringify(payload) },
    },
    required: [],
  }
}

function makeRequest(overrides: Partial<ElicitationRequest> = {}): ElicitationRequest {
  return {
    serverName: 'superone',
    message: 'Confirm video generation: "a cat..."',
    mode: 'form',
    requestedSchema: makeVideoGenSchema(),
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

describe('extractVideoGenConfirmPayload', () => {
  it('round-trips a full payload through the paramsJson description channel', () => {
    const payload = makePayload()
    expect(extractVideoGenConfirmPayload(makeVideoGenSchema(payload))).toEqual(payload)
  })

  it('returns null when the paramsJson field or description is missing', () => {
    expect(extractVideoGenConfirmPayload(null)).toBeNull()
    expect(extractVideoGenConfirmPayload({ type: 'object', properties: {} })).toBeNull()
    expect(
      extractVideoGenConfirmPayload({
        type: 'object',
        properties: { [VIDEO_GEN_PARAMS_FIELD]: { type: 'string' } },
      }),
    ).toBeNull()
  })

  it('returns null on corrupt JSON or shape mismatch', () => {
    expect(
      extractVideoGenConfirmPayload({
        type: 'object',
        properties: { [VIDEO_GEN_PARAMS_FIELD]: { type: 'string', description: '{not json' } },
      }),
    ).toBeNull()

    const badParams = makePayload()
    // @ts-expect-error intentionally break the shape
    badParams.params.duration = 'five'
    expect(extractVideoGenConfirmPayload(makeVideoGenSchema(badParams))).toBeNull()
  })

  it('returns null when a reference image has an invalid role', () => {
    const payload = makePayload()
    payload.referenceImages = [{ path: '/tmp/x.png', role: 'middle' as never }]
    expect(extractVideoGenConfirmPayload(makeVideoGenSchema(payload))).toBeNull()
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

  it('emits video_gen_confirm requestKind with payload and parks the promise', async () => {
    const pending = new Map<string, PendingElicitation>()
    const events: AgentEvent[] = []
    const onElicitation = createOnElicitation(pending, (e) => events.push(e))
    const promise = onElicitation(makeRequest(), { signal: makeSignal() })

    expect(events).toHaveLength(1)
    const event = events[0]
    if (event.type !== 'permission_request') throw new Error('expected permission_request')
    expect(event.request.requestKind).toBe('video_gen_confirm')
    expect(event.request.videoGenConfirm).toEqual(makePayload())
    expect(event.request.elicitationForm).toBeUndefined()
    expect(pending.size).toBe(1)

    respondToElicitation(pending, event.request.requestId, true)
    await expect(promise).resolves.toEqual({ action: 'accept' })
  })

  it('emits generic mcp_elicitation with parsed form fields for non-video-gen schemas', async () => {
    const pending = new Map<string, PendingElicitation>()
    const events: AgentEvent[] = []
    const onElicitation = createOnElicitation(pending, (e) => events.push(e))
    const promise = onElicitation(
      makeRequest({
        requestedSchema: {
          type: 'object',
          properties: { name: { type: 'string', title: 'Name' } },
          required: ['name'],
        },
      }),
      { signal: makeSignal() },
    )

    const event = events[0]
    if (event.type !== 'permission_request') throw new Error('expected permission_request')
    expect(event.request.requestKind).toBe('mcp_elicitation')
    expect(event.request.elicitationForm).toEqual([
      { name: 'name', type: 'string', label: 'Name', required: true },
    ])
    expect(event.request.videoGenConfirm).toBeUndefined()

    respondToElicitation(pending, event.request.requestId, true, undefined, { name: 'Ada' })
    await expect(promise).resolves.toEqual({ action: 'accept', content: { name: 'Ada' } })
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
    const paramsJson = JSON.stringify(makePayload().params)
    expect(respondToElicitation(pending, requestId, true, undefined, { paramsJson })).toBe(true)
    await expect(resolved).resolves.toEqual({ action: 'accept', content: { paramsJson } })
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
