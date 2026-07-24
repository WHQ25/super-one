import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createSession: vi.fn(async () => ({ id: 'oc-session' })),
  updatePermission: vi.fn(async () => undefined),
  promptAsync: vi.fn(async () => undefined),
  abort: vi.fn(async () => undefined),
  permissionReply: vi.fn(async () => undefined),
  questionReply: vi.fn(async () => undefined),
  questionReject: vi.fn(async () => undefined),
  closeServer: vi.fn(async () => undefined),
  events: [] as unknown[],
}))

vi.mock('./opencode-client', () => ({
  OpenCodeClient: class {
    providerList = async () => ({ connected: [], default: {}, all: [] })
    agents = async () => [{ name: 'build', mode: 'primary', hidden: false }]
    createSession = mocks.createSession
    updatePermission = mocks.updatePermission
    promptAsync = mocks.promptAsync
    abort = mocks.abort
    permissionReply = mocks.permissionReply
    questionReply = mocks.questionReply
    questionReject = mocks.questionReject
    eventStream = async (signal: AbortSignal) => (async function* () {
      for (const event of mocks.events) yield event
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
    })()
  },
  parseModels: () => [{ id: 'openai/gpt-5', name: 'GPT-5', description: '' }],
  startOpenCodeServer: async () => ({
    url: 'http://127.0.0.1:4000',
    exited: null,
    close: mocks.closeServer,
  }),
}))

import { buildOpenCodePermissionRules, createOpenCodeRuntime } from './opencode-runtime'

describe('opencode-runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.events = []
  })

  afterEach(() => {
    mocks.events = []
  })

  it('uses plan agent and updates live permission rules', async () => {
    const runtime = await createOpenCodeRuntime({
      sessionId: 'superone-session',
      cwd: '/project',
      config: {},
      permissionMode: 'plan',
      onEvent: vi.fn(),
    })

    await runtime.prompt('Plan this', 'openai/gpt-5', 'high')
    expect(mocks.promptAsync).toHaveBeenCalledWith('oc-session', {
      text: 'Plan this',
      model: 'openai/gpt-5',
      variant: 'high',
      images: undefined,
      agent: 'plan',
    })

    await runtime.setPermissionMode('bypassPermissions')
    expect(mocks.updatePermission).toHaveBeenCalledWith('oc-session', [
      { permission: '*', pattern: '*', action: 'allow' },
    ])

    await runtime.prompt('Build this', 'openai/gpt-5')
    expect(mocks.promptAsync).toHaveBeenLastCalledWith('oc-session', {
      text: 'Build this',
      model: 'openai/gpt-5',
      variant: undefined,
      images: undefined,
      agent: undefined,
    })
    await runtime.close()
    expect(mocks.closeServer).toHaveBeenCalledOnce()
  })

  it('forwards only events for its provider session', async () => {
    mocks.events = [
      { type: 'session.idle', properties: { sessionID: 'other-session' } },
      { type: 'session.idle', properties: { sessionID: 'oc-session' } },
    ]
    const onEvent = vi.fn()
    const runtime = await createOpenCodeRuntime({
      sessionId: 'superone-session',
      cwd: '/project',
      config: {},
      permissionMode: 'default',
      onEvent,
    })
    await vi.waitFor(() => expect(onEvent).toHaveBeenCalledOnce())
    expect(onEvent.mock.calls[0][0].properties.sessionID).toBe('oc-session')
    await runtime.close()
  })

  it('builds deny and accept-edits rules without disabling questions', () => {
    expect(buildOpenCodePermissionRules('dontAsk')).toEqual([
      { permission: '*', pattern: '*', action: 'deny' },
      { permission: 'question', pattern: '*', action: 'allow' },
    ])
    expect(buildOpenCodePermissionRules('acceptEdits')).toContainEqual({
      permission: 'edit',
      pattern: '*',
      action: 'allow',
    })
  })
})
