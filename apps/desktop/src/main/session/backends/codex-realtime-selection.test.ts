import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, SessionSettingsPatch } from '@superone/shared/agent-types'
import type { AppServerConnectionHandle, AppServerNotification } from '../../codex/app-server-connection'
import type { BackendStartOptions } from '../types'

vi.mock('../../logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('../../agent/event-trace', () => ({ trace: vi.fn() }))
vi.mock('../../database', () => ({ getActiveProviderRaw: vi.fn(() => null), getProviderByIdRaw: vi.fn() }))
vi.mock('../../providers/resolver', () => ({ resolveChatService: vi.fn(() => null) }))
vi.mock('../../providers/llm-proxy-manager', () => ({ ensureCodexProxyUrl: vi.fn(async () => undefined) }))
vi.mock('../../usage-stats-service', () => ({ recordCodexFromTurnUsage: vi.fn(), recordCodexFromUsage: vi.fn() }))
vi.mock('../../mcp/superone-mcp-server', () => ({ isToolPreapproved: vi.fn(() => false), isBuiltInSuperoneTool: vi.fn(() => false) }))

import { CodexBackend } from './codex-backend'
import { broadcastSessionSettings } from '../session-settings-broadcast'

const backends: CodexBackend[] = []
afterEach(async () => {
  await Promise.all(backends.splice(0).map((backend) => backend.close()))
})

function setup() {
  const queue: AppServerNotification[] = []
  let next: ((note: AppServerNotification) => void) | undefined
  const push = (note: AppServerNotification) => {
    if (next) { const resolve = next; next = undefined; resolve(note) }
    else queue.push(note)
  }
  const request = vi.fn(async (method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> => {
    if (method === 'thread/start' || method === 'thread/resume') {
      return { thread: { id: 'thread-voice' }, model: params.model }
    }
    if (method === 'thread/realtime/stop') push({ method: 'thread/realtime/closed', params: { threadId: 'thread-voice' } })
    return {}
  })
  const handle = {
    connection: {
      request,
      respond: vi.fn(async () => {}),
      notify: vi.fn(async () => {}),
      pollNotification: vi.fn(async () => null),
      nextNotification: () => queue.length ? Promise.resolve(queue.shift()!) : new Promise<AppServerNotification>((resolve) => { next = resolve }),
    },
    close: vi.fn(async () => {}),
    getStderr: () => '',
    onClosed: () => () => {},
  } as unknown as AppServerConnectionHandle
  const backend = new CodexBackend({
    getProjectAuth: () => ({ mode: 'auto' }),
    onAuthChanged: () => () => {},
    takeAppServerConnection: async () => handle,
  })
  backends.push(backend)
  const opts: BackendStartOptions = {
    sessionId: 'selection-test', projectPath: '/tmp/proj', cwd: '/tmp/proj',
    config: { model: 'gpt-5.5', reasoningEffort: 'medium' }, permissionMode: 'default',
    model: 'gpt-6-astra', effort: 'high', serviceTier: 'priority', abortController: new AbortController(),
  }
  return { backend, request, opts }
}

describe('realtime backend selection at the app-server boundary', () => {
  it.each([false, true])('applies current defaults before starting voice (prewarm=%s)', async (prewarm) => {
    const { backend, request, opts } = setup()
    if (prewarm) backend.prewarm({ ...opts, model: 'gpt-5.5', effort: 'low' })
    await backend.start(opts)
    await backend.startRealtimeVoice({ sdp: 'offer' })

    expect(request).toHaveBeenCalledWith('thread/settings/update', expect.objectContaining({
      threadId: 'thread-voice', model: 'gpt-6-astra', effort: 'high', serviceTier: 'priority',
    }))
    const methods = request.mock.calls.map(([method]) => method)
    expect(methods.indexOf('thread/settings/update')).toBeLessThan(methods.indexOf('thread/realtime/start'))
  })

  it('sends picker changes and explicit tier clearing to the running voice thread', async () => {
    const { backend, request, opts } = setup()
    await backend.start(opts)
    await backend.startRealtimeVoice({ sdp: 'offer' })
    request.mockClear()
    await backend.setCodexSelection({ model: 'gpt-5.6-sol', reasoningEffort: 'ultra', serviceTier: null })
    expect(request).toHaveBeenCalledWith('thread/settings/update', expect.objectContaining({
      threadId: 'thread-voice', model: 'gpt-5.6-sol', effort: 'ultra', serviceTier: null,
    }))
    expect(request).not.toHaveBeenCalledWith('thread/realtime/stop', expect.anything())
  })

  it('does not start voice when app-server rejects the selected defaults', async () => {
    const { backend, request, opts } = setup()
    await backend.start(opts)
    const original = request.getMockImplementation()!
    request.mockImplementation(async (method, params) => {
      if (method === 'thread/settings/update') throw new Error('Unsupported model')
      return original(method, params)
    })
    await expect(backend.startRealtimeVoice({ sdp: 'offer' })).rejects.toThrow('Unsupported model')
    expect(request).not.toHaveBeenCalledWith('thread/realtime/start', expect.anything())
  })

  it.each(['', null])('clears model selection consistently for %s', async (model) => {
    const { backend, opts } = setup()
    await backend.start(opts)
    const selected = vi.fn()
    const patch: SessionSettingsPatch = { selectedCodexModel: model }
    broadcastSessionSettings(patch, {
      harnessId: 'codex', setSelectedSettings: selected,
      setCodexSelection: (selection) => { void backend.setCodexSelection(selection) },
      mergeUiSettings: vi.fn(), forwardEvent: (_event: AgentEvent) => {},
    })
    expect(selected).toHaveBeenCalledWith({ model: null })
    expect(backend.getStartOpts()?.model).toBeUndefined()
  })
})
