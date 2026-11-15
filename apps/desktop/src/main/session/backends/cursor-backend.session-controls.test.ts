import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import type { BackendStartOptions, SendDelivery } from '../types'

const { factoryMock, prewarmMock } = vi.hoisted(() => ({
  factoryMock: vi.fn(),
  prewarmMock: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../logger', () => ({
  default: { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

vi.mock('../../cursor/cursor-runtime', () => ({
  getCursorRuntimeFactory: () => factoryMock,
  setCursorRuntimeFactory: vi.fn(),
  prewarmCursorWorkspace: (...args: unknown[]) => prewarmMock(...args),
}))

vi.mock('../../cursor/cursor-auth', () => ({
  mapPermissionToCursorLocal: () => ({ mode: 'agent', autoReview: true }),
}))

vi.mock('../../database', () => ({
  getCachedHarnessResources: () => null,
}))

vi.mock('@superone/cursor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@superone/cursor')>()
  return {
    ...actual,
    buildCursorModelSelection: () => undefined,
    parseCursorContextWindow: () => null,
  }
})

import { CursorBackend } from './cursor-backend'

function makeOpts(overrides: Partial<BackendStartOptions> = {}): BackendStartOptions {
  return {
    sessionId: 's1',
    projectPath: '/tmp/p',
    cwd: '/tmp/p',
    config: {},
    permissionMode: 'agent',
    sandboxInfo: { enabled: false, autoAllowBash: false },
    abortController: new AbortController(),
    ...overrides,
  }
}

function makeRuntime(overrides: Record<string, unknown> = {}) {
  return {
    agentId: 'a1',
    isCloud: false,
    lastRunId: null,
    send: vi.fn(() => new Promise<Record<string, never>>(() => {})),
    summarize: vi.fn().mockResolvedValue(undefined),
    steer: vi.fn().mockResolvedValue('complete_delivered'),
    cancel: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    setModel: vi.fn(),
    setPermissionMode: vi.fn(),
    reload: vi.fn(),
    getMcpServerStatus: vi.fn().mockResolvedValue([]),
    listArtifacts: vi.fn(),
    downloadArtifact: vi.fn(),
    ...overrides,
  }
}

function delivery(): SendDelivery {
  return { onInputAccepted: vi.fn() }
}

describe('CursorBackend compact, steer, and extra dirs', () => {
  beforeEach(() => {
    factoryMock.mockReset()
    prewarmMock.mockReset().mockResolvedValue(undefined)
  })

  it('compacts without opening an assistant turn', async () => {
    const summarize = vi.fn(async (preTokens: number) => {
      expect(preTokens).toBe(12)
    })
    const send = vi.fn()
    factoryMock.mockResolvedValueOnce(makeRuntime({ summarize, send }))
    const backend = new CursorBackend()
    const events: AgentEvent[] = []
    backend.onEvent((event) => events.push(event))
    await backend.start(makeOpts({ contextTokens: 12 }))
    await backend.send({ content: '  /compact  ' }, delivery())
    expect(summarize).toHaveBeenCalledTimes(1)
    expect(send).not.toHaveBeenCalled()
    expect(events.some((event) => event.type === 'message_start')).toBe(false)
    expect(events).toContainEqual({ type: 'status_change', status: 'idle' })
  })

  it('reports a failed compact when summarize throws before any result', async () => {
    factoryMock.mockResolvedValueOnce(makeRuntime({
      summarize: vi.fn().mockRejectedValue(new Error('Cursor cloud agents compact on their own')),
    }))
    const backend = new CursorBackend()
    const events: AgentEvent[] = []
    backend.onEvent((event) => events.push(event))
    await backend.start(makeOpts())
    await backend.send({ content: '/compact' }, delivery())
    expect(events).toContainEqual({
      type: 'status_indicator',
      indicator: null,
      compactResult: 'failed',
      compactError: 'Cursor cloud agents compact on their own',
    })
    expect(events.some((event) => event.type === 'message_start')).toBe(false)
  })

  it('steers a queued text message and keeps an image message queued', async () => {
    const steer = vi.fn().mockResolvedValue('complete_delivered')
    factoryMock.mockResolvedValueOnce(makeRuntime({ steer }))
    const backend = new CursorBackend()
    const events: AgentEvent[] = []
    backend.onEvent((event) => events.push(event))
    await backend.start(makeOpts())
    const accepted = vi.fn()
    void backend.send({ content: 'hello', assistantMessageId: 'assistant-local' }, delivery())
    await new Promise((resolve) => setImmediate(resolve))
    void backend.send({ content: 'follow', clientMessageId: 'q1', priority: 'next' }, { onInputAccepted: accepted })
    void backend.send({
      content: 'look',
      clientMessageId: 'q-image',
      priority: 'next',
      images: [{ name: 'a.png', mimeType: 'image/png', base64: 'abc' }],
    }, delivery())

    await backend.handleCommand({ kind: 'cursor.steer_queued', clientMessageId: 'q1' })
    expect(steer).toHaveBeenCalledWith('follow')
    expect(accepted).toHaveBeenCalledTimes(1)
    expect(events).toContainEqual({ type: 'queued_message_consumed', clientMessageId: 'q1' })

    await backend.handleCommand({ kind: 'cursor.steer_queued', clientMessageId: 'q-image' })
    expect(steer).toHaveBeenCalledTimes(1)
    expect(backend.dequeueMessage('q-image')).toBe(true)
  })

  it('restores a message the run will not accept', async () => {
    const steer = vi.fn().mockResolvedValue('revert_to_followup')
    factoryMock.mockResolvedValueOnce(makeRuntime({ steer }))
    const backend = new CursorBackend()
    await backend.start(makeOpts())
    void backend.send({ content: 'hello', assistantMessageId: 'assistant-local' }, delivery())
    await new Promise((resolve) => setImmediate(resolve))
    void backend.send({ content: 'follow', clientMessageId: 'q1', priority: 'next' }, delivery())
    await backend.handleCommand({ kind: 'cursor.steer_queued', clientMessageId: 'q1' })
    expect(backend.dequeueMessage('q1')).toBe(true)
  })

  it('passes extra dirs into the runtime and asks for a rebuild once one exists', async () => {
    factoryMock.mockResolvedValueOnce(makeRuntime())
    const backend = new CursorBackend()
    backend.prewarm(makeOpts({ additionalDirectories: ['/extra'] }))
    expect(prewarmMock).toHaveBeenCalledWith(expect.objectContaining({ additionalDirectories: ['/extra'] }))
    await backend.start(makeOpts({ additionalDirectories: ['/extra'] }))
    expect(factoryMock).toHaveBeenCalledWith(expect.objectContaining({ additionalDirectories: ['/extra'] }))
    expect(await backend.setAdditionalDirectories(['/other'])).toBe(false)
    factoryMock.mockResolvedValueOnce(makeRuntime())
    await backend.rebuild(makeOpts({ additionalDirectories: ['/other'] }))
    expect(factoryMock).toHaveBeenLastCalledWith(expect.objectContaining({ additionalDirectories: ['/other'] }))
  })

  it('does not rebuild a cloud agent for extra dirs', async () => {
    factoryMock.mockResolvedValueOnce(makeRuntime({ isCloud: true }))
    const backend = new CursorBackend()
    await backend.start(makeOpts({ providerSessionId: 'bc-1', config: { runtime: 'cloud' } }))
    expect(await backend.setAdditionalDirectories(['/other'])).toBe(true)
  })
})
