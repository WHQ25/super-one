import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import type { OpenCodeRuntime, OpenCodeRuntimeEvent, OpenCodeRuntimeOptions } from '../../opencode/opencode-runtime'
import { queuedSteerCommand } from '../session-queue'
import { createDefaultChatCoreSession, applyEventToSession, type ChatCoreSession } from '@superone/chat-core'

vi.mock('../../logger', () => ({ default: { debug: vi.fn(), warn: vi.fn() } }))
vi.mock('../../mcp-config-service', () => ({ listMcpConfigs: () => [] }))
vi.mock('../../mcp/superone-mcp-stdio-state', () => ({ getSuperoneMcpStdioConfig: () => null }))

import { OpenCodeBackend, setOpenCodeRuntimeFactory } from './opencode-backend'

describe('OpenCode native queued steering', () => {
  let backend: OpenCodeBackend
  let runtime: OpenCodeRuntime
  let route: (event: OpenCodeRuntimeEvent) => void
  let events: AgentEvent[]
  let prompt: ReturnType<typeof vi.fn>
  let steer: ReturnType<typeof vi.fn>

  function emit(type: string, data: Record<string, unknown> = {}) {
    route({ type: 'v2', event: { id: `e_${type}`, type, data: { sessionID: 'ses_steer', ...data } } } as OpenCodeRuntimeEvent)
  }
  function startInput(id: string) {
    emit('session.inbox.enqueued', { inboxID: id, item: { type: 'user' } })
    emit('session.execution.started')
    emit('session.inbox.delivered', { inboxID: id })
  }
  function finish() { emit('session.execution.succeeded') }
  async function queue() {
    const first = backend.send({ content: 'first', assistantMessageId: 'a1' })
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledOnce())
    const accepted = vi.fn()
    await backend.send({ content: 'steered', clientMessageId: 'u2', priority: 'next' }, { onInputAccepted: accepted })
    return { first, accepted }
  }

  beforeEach(async () => {
    events = []
    let input = 0
    prompt = vi.fn(async () => startInput(`input_${++input}`))
    steer = vi.fn(async (_request, accepted) => {
      accepted()
      emit('session.inbox.enqueued', { inboxID: 'input_steer', item: { type: 'user' } })
      emit('session.inbox.delivered', { inboxID: 'input_steer' })
      return 'input_steer'
    })
    runtime = { sessionId: 'ses_steer', models: [], agents: [], commands: [], snapshotEvents: [], prompt, steer,
      supportsStreamingToolInput: true, cancel: vi.fn(async () => undefined), close: vi.fn(async () => undefined), getContextUsage: async () => null } as unknown as OpenCodeRuntime
    setOpenCodeRuntimeFactory(async (opts: OpenCodeRuntimeOptions) => { route = opts.onEvent; return runtime })
    backend = new OpenCodeBackend()
    backend.onEvent((event) => events.push(event))
    await backend.start({ sessionId: 'superone', projectPath: '/project', cwd: '/project', config: {}, permissionMode: 'default', abortController: new AbortController() })
  })
  afterEach(async () => { await backend.close(); setOpenCodeRuntimeFactory(null) })

  it('routes the desktop and phone steer command to OpenCode', () => {
    expect(queuedSteerCommand('opencode', 'u2', 'now')).toEqual({ kind: 'opencode.steer_queued', clientMessageId: 'u2' })
  })

  it('admits a queued prompt into the active execution without opening another assistant or cancelling tools', async () => {
    const { first, accepted } = await queue()
    await backend.handleCommand({ kind: 'opencode.steer_queued', clientMessageId: 'u2' })
    expect(accepted).toHaveBeenCalledOnce()
    expect(events).toContainEqual({ type: 'queued_message_consumed', clientMessageId: 'u2' })
    expect(events.filter((event) => event.type === 'message_start')).toHaveLength(1)
    expect(prompt).toHaveBeenCalledOnce()
    expect(runtime.cancel).not.toHaveBeenCalled()
    finish()
    await first
  })

  it('retains native execution ownership when the original execution ends during steering admission', async () => {
    const { first } = await queue()
    let resolve!: (id: string) => void
    steer.mockImplementationOnce(async (_request, accepted) => { accepted(); return new Promise<string>((done) => { resolve = done }) })
    const action = backend.handleCommand({ kind: 'opencode.steer_queued', clientMessageId: 'u2' })
    await vi.waitFor(() => expect(steer).toHaveBeenCalledOnce())
    finish()
    expect(events.some((event) => event.type === 'message_complete')).toBe(false)
    resolve('input_steer')
    await action
    expect(events.some((event) => event.type === 'message_complete')).toBe(false)
    startInput('input_steer')
    finish()
    await first
    expect(events.filter((event) => event.type === 'message_complete')).toHaveLength(1)
  })

  it('restores a rejected queued input so it can run normally after the live turn', async () => {
    const { first, accepted } = await queue()
    steer.mockRejectedValueOnce(new Error('rejected before submission'))
    await expect(backend.handleCommand({ kind: 'opencode.steer_queued', clientMessageId: 'u2' })).rejects.toThrow('rejected')
    expect(accepted).not.toHaveBeenCalled()
    finish()
    await first
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledTimes(2))
    finish()
  })

  it('keeps V1 controls off and rejects steering without consuming the queued input', async () => {
    await backend.close()
    runtime.steer = undefined
    runtime.supportsStreamingToolInput = false
    events = []
    backend = new OpenCodeBackend()
    backend.onEvent((event) => events.push(event))
    await backend.start({ sessionId: 'legacy', projectPath: '/project', cwd: '/project', config: {}, permissionMode: 'default', abortController: new AbortController() })
    const { first, accepted } = await queue()
    expect(events).toContainEqual(expect.objectContaining({ type: 'session_agents', runtimeCapabilities: expect.objectContaining({ supportsQueuedSteer: false }) }))
    await expect(backend.handleCommand({ kind: 'opencode.steer_queued', clientMessageId: 'u2' })).rejects.toThrow(/not support/i)
    expect(accepted).not.toHaveBeenCalled()
    expect(backend.dequeueMessage('u2')).toBe(true)
    finish()
    await first
  })

  it('keeps the original checkpoint and anchors the consumed user input after enqueue beats acknowledgement', async () => {
    let session: ChatCoreSession = { ...createDefaultChatCoreSession(), messages: [{ id: 'u1', role: 'user' as const, status: 'complete' as const,
      content: [{ type: 'text' as const, text: 'first' }], providerId: 'opencode', createdAt: '' }] }
    backend.onEvent((event) => { session = { ...session, ...applyEventToSession(session, event) } })
    const { first } = await queue()
    session = { ...session, queuedMessages: [{ id: 'u2', role: 'user', status: 'complete', content: [{ type: 'text', text: 'steered' }], providerId: 'opencode', createdAt: '' }] }
    await backend.handleCommand({ kind: 'opencode.steer_queued', clientMessageId: 'u2' })
    expect(session.messages.find((m) => m.id === 'u1')?.checkpointId).toBe('input_1')
    expect(session.messages.find((m) => m.id === 'u2')?.checkpointId).toBe('input_steer')
    expect(session.queuedMessages).toEqual([])
    finish()
    await first
  })

  it.each(['InvalidRequestError', 'SkillNotFoundError', 'SessionBusyError'])('restores a declared %s rejection even after submission started', async (_tag) => {
    const { first } = await queue()
    steer.mockImplementationOnce(async (_request, accepted) => { accepted(); throw new Error('bad request', { cause: { _tag } }) })
    await expect(backend.handleCommand({ kind: 'opencode.steer_queued', clientMessageId: 'u2' })).rejects.toThrow('bad request')
    expect(events.filter((e) => e.type === 'queued_message_consumed')).toEqual([])
    finish()
    await first
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledTimes(2))
    finish()
  })

  it('never automatically resends an input when a submitted request loses its acknowledgement', async () => {
    const { first, accepted } = await queue()
    steer.mockImplementationOnce(async (_request, onAccepted) => { onAccepted(); throw new Error('connection lost') })
    await expect(backend.handleCommand({ kind: 'opencode.steer_queued', clientMessageId: 'u2' })).rejects.toThrow('may have been accepted')
    expect(accepted).toHaveBeenCalledOnce()
    expect(events).toContainEqual({ type: 'queued_message_consumed', clientMessageId: 'u2' })
    finish()
    await first
    expect(prompt).toHaveBeenCalledOnce()
  })

  it('does not submit a dequeued message', async () => {
    const { first } = await queue()
    expect(backend.dequeueMessage('u2')).toBe(true)
    await expect(backend.handleCommand({ kind: 'opencode.steer_queued', clientMessageId: 'u2' })).rejects.toThrow('not found')
    expect(steer).not.toHaveBeenCalled()
    finish()
    await first
  })

  it('refreshes the same idle native session and publishes the updated catalog', async () => {
    const agents = [{ id: 'build', name: 'Build' }, { id: 'new', name: 'New Agent' }]
    const commands = [{ name: 'new-skill', skillId: 'new-id', description: '', argumentHint: '', isSkill: true }]
    const fresh = { models: [], agents, commands }
    const refresh = vi.fn(async () => { Object.assign(runtime, { agents, commands }); return fresh })
    Object.assign(runtime, { refreshResources: refresh })
    expect(await backend.refreshResources()).toEqual({ opencode: fresh })
    expect(events).toContainEqual(expect.objectContaining({ type: 'session_agents', agents, commands }))
    expect(runtime.sessionId).toBe('ses_steer')
    expect(prompt).not.toHaveBeenCalled()
  })

  it('refuses refresh during an active turn and after a lost control lease', async () => {
    const refresh = vi.fn(async () => ({ models: [], agents: [], commands: [] }))
    Object.assign(runtime, { refreshResources: refresh })
    const first = backend.send({ content: 'first', assistantMessageId: 'a1' })
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledOnce())
    await expect(backend.refreshResources()).rejects.toThrow('active OpenCode turn')
    finish()
    await first
    await expect(backend.refreshResources(() => { throw new Error('stale control lease') })).rejects.toThrow('stale control lease')
    expect(refresh).not.toHaveBeenCalled()
  })

  it('keeps legacy runtimes on the existing discovery fallback', async () => {
    await expect(backend.refreshResources()).resolves.toBeNull()
  })

  it('adopts an idle native input after changing delivery without submitting another prompt', async () => {
    const listInbox = vi.fn(async () => [{ id: 'native-pending', text: 'accepted upstream', delivery: 'queue', createdAt: 1, attachmentCount: 0 }])
    const updateInbox = vi.fn(async (_id, _delivery, guard) => { guard(); emit('session.execution.started'); emit('session.inbox.delivered', { inboxID: 'native-pending' }) })
    Object.assign(runtime, { listInbox, updateInbox })
    await backend.updateInbox('native-pending', 'steer', vi.fn())
    expect(updateInbox).toHaveBeenCalledOnce()
    expect(prompt).not.toHaveBeenCalled()
    expect(events.filter((event) => event.type === 'message_start')).toHaveLength(1)
    finish()
    await vi.waitFor(() => expect(events.filter((event) => event.type === 'message_complete')).toHaveLength(1))
    expect(events).toContainEqual(expect.objectContaining({ type: 'user_message_appended', message: expect.objectContaining({ id: 'native-pending', checkpointId: 'native-pending' }) }))
  })

  it('does not open a host turn for an already-delivered native input', async () => {
    Object.assign(runtime, { listInbox: async () => [], updateInbox: vi.fn() })
    await expect(backend.updateInbox('gone', 'steer', vi.fn())).rejects.toThrow('no longer pending')
    expect(events.filter((event) => event.type === 'message_start')).toEqual([])
  })

  it('waits for recovery and refuses input after its captured control is revoked', async () => {
    let resumed!: () => void
    const recovering = new Promise<void>((resolve) => { resumed = resolve })
    Object.assign(runtime, { waitForConnection: () => recovering, prepareTurn: vi.fn(async (_id, delivery) => delivery.assertControl()) })
    const accepted = vi.fn(), send = backend.send({ content: 'new input' }, { onInputAccepted: accepted, assertControl: () => { throw new Error('stale lease') } })
    expect(prompt).not.toHaveBeenCalled()
    resumed(); await send
    expect(prompt).not.toHaveBeenCalled(); expect(accepted).not.toHaveBeenCalled()
    expect(events).toContainEqual(expect.objectContaining({ type: 'message_error', error: 'stale lease' }))
  })

  it('clears stale pending interactions during recovery without inventing an approval', () => {
    emit('permission.asked', { id: 'permission', action: 'edit', resources: ['/a'] })
    emit('form.created', { form: { id: 'form', sessionID: 'ses_steer', title: 'Choose', fields: [] } })
    route({ type: 'runtime.interactions', properties: { resolvedPermissions: ['permission'], resolvedForms: ['form'] } })
    expect(events).toContainEqual({ type: 'interaction_resolved', interactionType: 'permission', requestId: 'permission' })
    expect(events).toContainEqual({ type: 'interaction_resolved', interactionType: 'question', requestId: 'form' })
  })
})
