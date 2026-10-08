/**
 * A send OpenCode parks behind the live turn runs long after the `Session.send`
 * that parked it returned. Its delivery is still decided per message: a failure
 * before the prompt goes out is kept on its row and its resend runs; one after
 * it is held.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import type { OpenCodeRuntime, OpenCodeRuntimeEvent, OpenCodeRuntimeOptions } from '../opencode/opencode-runtime'
import { ChatRuntime } from '../../../../mobile/src/runtime'

vi.mock('../logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } }))
vi.mock('../shell-path', async (importOriginal) => ({ ...await importOriginal<object>(), ensureShellPath: async () => {}, isShellPathReady: () => true }))
vi.mock('../mcp-config-service', () => ({ listMcpConfigs: () => [] }))
vi.mock('../mcp/superone-mcp-stdio-state', () => ({ getSuperoneMcpStdioConfig: () => null }))

import { OpenCodeBackend, setOpenCodeRuntimeFactory } from './backends/opencode-backend'
import { Session } from './session'

function harness() {
  let route: (event: OpenCodeRuntimeEvent) => void = () => undefined
  const prompt = vi.fn(async (_text: string) => undefined)
  const runtime = {
    sessionId: 'oc-session',
    models: [{ id: 'openai/gpt-5', name: 'GPT-5', description: '', contextWindow: 400_000 }],
    agents: [],
    commands: [],
    snapshotEvents: [],
    prompt,
    setModel: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
    getContextUsage: vi.fn(async () => null),
    close: vi.fn(async () => undefined),
  } as unknown as OpenCodeRuntime
  let reachable = true
  setOpenCodeRuntimeFactory(async (opts: OpenCodeRuntimeOptions) => {
    if (!reachable) throw new Error('environment is not connected')
    route = opts.onEvent
    return runtime
  })
  const session = new Session({ id: 'session', projectPath: '/project', cwd: '/project',
    providerId: 'opencode', harnessId: 'opencode', providerConfig: {}, backend: new OpenCodeBackend() })
  return {
    session,
    prompt,
    setReachable: (value: boolean) => { reachable = value },
    route: (event: OpenCodeRuntimeEvent) => route(event),
    idle: () => route({ id: `idle-${Math.random()}`, type: 'session.idle', properties: { sessionID: 'oc-session' } } as OpenCodeRuntimeEvent),
    row: (id: string) => session.snapshot.messages.find((message) => message.id === id),
    roles: () => session.snapshot.messages.map((message) => message.role),
  }
}

async function openOnMobile(session: Session) {
  const client = {
    startBuffering() {}, releaseBuffer: () => ({ epoch: 1, batches: [session.getReplayEvents()] }),
    async request(command: { type: string }) {
      if (command.type !== 'subscribe_session') return { ok: true }
      return { historyPage: { messages: session.snapshot.messages, provider: 'opencode', hasMore: false }, snapshot: { status: 'idle' } }
    },
  }
  const runtime = new ChatRuntime(client as never, () => {})
  await runtime.open('/project', 'session')
  return runtime
}

describe('a send the backend parked and ran later', () => {
  afterEach(() => setOpenCodeRuntimeFactory(null))

  it('keeps a failure before its prompt went out on its row, drops its empty reply, and runs its resend', async () => {
    const h = harness()
    const first = h.session.send({ content: 'first', clientMessageId: 'u1' })
    await vi.waitFor(() => expect(h.prompt).toHaveBeenCalledOnce())
    // Parked behind the live turn: this call returns before u2 runs.
    await h.session.send({ content: 'second', clientMessageId: 'u2', priority: 'next' })
    expect(h.prompt).toHaveBeenCalledOnce()

    // The connection drops: the live turn fails and the parked one cannot reconnect.
    h.setReachable(false)
    h.route({ id: 'err', type: 'runtime.error', properties: { message: 'connection lost' } } as OpenCodeRuntimeEvent)
    await first
    await vi.waitFor(() => expect(h.row('u2')?.metadata?.sendFailure).toEqual({ error: 'environment is not connected' }))
    expect(h.prompt).toHaveBeenCalledOnce()
    // u1 reached OpenCode, so its error reply stays; u2's empty reply is gone.
    expect(h.roles()).toEqual(['user', 'assistant', 'user'])
    expect(h.row('u1')?.metadata?.sendFailure).toBeUndefined()

    const phone = await openOnMobile(h.session)
    expect(phone.session.messages.find((message) => message.id === 'u2')?.metadata?.sendFailure).toBeDefined()
    phone.dispose()

    h.setReachable(true)
    await expect(h.session.send({ content: 'first', clientMessageId: 'u1' })).resolves.toEqual({ duplicate: true })
    const resend = h.session.send({ content: 'second', clientMessageId: 'u2' })
    await vi.waitFor(() => expect(h.prompt).toHaveBeenCalledTimes(2))
    h.idle()
    await expect(resend).resolves.toBeUndefined()
    expect(h.prompt.mock.calls[1]?.[0]).toBe('second')
    expect(h.row('u2')?.metadata?.sendFailure).toBeUndefined()
    expect(h.roles()).toEqual(['user', 'assistant', 'user', 'assistant'])
  })

  it('holds a parked send whose prompt went out before it failed', async () => {
    const h = harness()
    const first = h.session.send({ content: 'first', clientMessageId: 'u1' })
    await vi.waitFor(() => expect(h.prompt).toHaveBeenCalledOnce())
    await h.session.send({ content: 'second', clientMessageId: 'u2', priority: 'next' })
    // The request went out; only its answer was lost.
    h.prompt.mockRejectedValueOnce(new Error('socket hang up'))
    h.idle()
    await first
    await vi.waitFor(() => expect(h.prompt).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(h.row('u2')).toBeDefined())
    expect(h.row('u2')?.metadata?.sendFailure).toBeUndefined()

    await expect(h.session.send({ content: 'second', clientMessageId: 'u2' })).resolves.toEqual({ duplicate: true })
    expect(h.prompt).toHaveBeenCalledTimes(2)
  })
})

describe('delivery attribution', () => {
  it('does not take a late event of the turn before as the parked send delivered', async () => {
    let emit!: (event: AgentEvent) => void
    let runParked!: () => Promise<void>
    const backend = {
      kind: 'opencode', start: vi.fn(async () => {}),
      send: vi.fn(async (request: { priority?: string }, delivery?: { runDeferred?: (run: () => Promise<void>) => Promise<void> }) => {
        if (request.priority !== 'next') return
        runParked = () => delivery!.runDeferred!(async () => {
          emit({ type: 'message_start', message: { id: 'a2', role: 'assistant', status: 'streaming', content: [], createdAt: '', providerId: 'opencode' } })
          // The turn before still streams a chunk under its own id.
          emit({ type: 'content_delta', messageId: 'a1', delta: { type: 'text', text: 'late' } })
          emit({ type: 'message_error', messageId: 'a2', error: 'not connected' })
        })
      }),
      onEvent: (listener: typeof emit) => { emit = listener; return () => {} },
      onProviderSessionId: () => () => {}, onPermissionModeApplied: () => () => {},
      getPendingInteractions: () => [],
    }
    const session = new Session({ id: 'session', projectPath: '/project', cwd: '/project',
      providerId: 'opencode', harnessId: 'opencode', providerConfig: {}, backend: backend as never })
    await session.send({ content: 'first', clientMessageId: 'u1' })
    emit({ type: 'status_change', status: 'streaming' })
    await session.send({ content: 'second', clientMessageId: 'u2', priority: 'next' })
    emit({ type: 'queued_message_consumed', clientMessageId: 'u2' })
    await runParked()
    expect(session.snapshot.messages.find((message) => message.id === 'u2')?.metadata?.sendFailure).toEqual({ error: 'not connected' })
    expect(session.snapshot.messages.some((message) => message.id === 'a2')).toBe(false)
  })
})
