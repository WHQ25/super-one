import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CachedTranscript } from '@superone/relay-client'
import { ChatRuntime } from './runtime'
import { createNodeSessionEventMapper } from '@superone/shared/node-session-event-map'

import { runtimeTestClient as fakeClient, sessionLoadFixture } from './runtime-test-client'

afterEach(() => vi.useRealTimers())

describe('ChatRuntime', () => {
  it('merges the routed node echo with its optimistic bubble and keeps same-text messages from peers', async () => {
    const runtime = new ChatRuntime(fakeClient() as never, () => {})
    await runtime.open('/app', 'same')
    runtime.sourceEnvironmentId = 'node'
    runtime.send('12345', { clientMessageId: 'user_phone_1' })
    const mapper = createNodeSessionEventMapper({ sessionId: 'same', projectPath: '/app' })
    for (const [sequence, blockId] of [['1', 'user_phone_1'], ['2', 'user_desktop_1']]) {
      runtime.ingest(mapper.map({ eventId: `e${sequence}`, sequence, timestamp: Date.now(), environmentId: 'node', aggregateType: 'session', aggregateId: 'same', eventType: 'session.user_message', eventVersion: 1, payload: { blockId, text: '12345' } }).map(event => ({ ...event, environmentId: 'node' })))
    }
    expect(runtime.session.messages.map(message => message.id)).toEqual(['user_phone_1', 'user_desktop_1'])
    runtime.dispose()
  })
  it('sets a new session owner before replaying buffered events and rejects foreign same-ID events', async () => {
    const client = fakeClient()
    const ownMessage = { id: 'own', role: 'user', content: [{ type: 'text', text: 'Own message' }], status: 'complete', createdAt: '' }
    client.releaseBuffer.mockReturnValue({ epoch: 1, batches: [[
      { type: 'user_message_appended', environmentId: 'other', sessionId: 'same', message: { ...ownMessage, id: 'foreign' } },
      { type: 'user_message_appended', environmentId: 'desktop', sessionId: 'same', message: ownMessage },
      { type: 'status_change', environmentId: 'desktop', sessionId: 'same', status: 'streaming' },
    ]] } as never)
    const runtime = new ChatRuntime(client as never, () => {})
    await runtime.create('/p', { sessionId: 'same' })
    expect(runtime.sourceEnvironmentId).toBe('desktop')
    expect(runtime.session.messages.map(message => message.id)).toEqual(['own'])
    expect(runtime.session.status).toBe('streaming')
    runtime.dispose()
  })
  it('rejects foreign same-ID events in a prepared restore buffer', async () => {
    const runtime = new ChatRuntime(fakeClient() as never, () => {})
    await runtime.open('/p', 'same', {
      messages: [], snapshot: { sourceEnvironmentId: 'node' }, epoch: 1, hasMore: false, cursor: null,
      metrics: { subscribeMs: 0, historyMs: 0, snapshotMs: 0, totalMs: 0, historyBytes: 0, snapshotBytes: 0 },
      liveBatches: [[{ type: 'user_message_appended', environmentId: 'desktop', sessionId: 'same',
        message: { id: 'foreign', role: 'user', content: [], status: 'complete', createdAt: '' } }]],
    })
    expect(runtime.session.messages).toEqual([])
    runtime.dispose()
  })
  it('restores the host\'s Claude Ultracode and sends the phone\'s pick only when there is one', async () => {
    const client = fakeClient()
    const answer = client.dispatch.getMockImplementation()!
    client.dispatch.mockImplementation(async (cmd) => cmd.method === 'session.load'
      ? sessionLoadFixture({ state: { status: 'idle', ultracode: true } })
      : answer(cmd))
    const runtime = new ChatRuntime(client as never, () => {})
    await runtime.open('/p', 'uc')
    expect(runtime.session.ultracode).toBe(true)
    runtime.send('off now', { ultracode: false })
    runtime.send('no say')
    const sends = client.sent.filter((cmd) => (cmd as { method: string }).method === 'session.send') as Array<{ text?: string }>
    expect(sends.find((cmd) => cmd.text === 'off now')).toMatchObject({ options: { ultracode: false } })
    expect(sends.find((cmd) => cmd.text === 'no say')).not.toHaveProperty('ultracode')
    runtime.dispose()
  })
  it('restores the session goal from the snapshot, including a goal cleared during the gap', async () => {
    const client = fakeClient()
    const answer = client.dispatch.getMockImplementation()!
    let goal: unknown = { objective: 'ship the fix', status: 'active' }
    client.dispatch.mockImplementation(async (cmd) => cmd.method === 'session.load'
      ? sessionLoadFixture({ state: { status: 'idle', sessionGoal: goal } })
      : answer(cmd))
    const runtime = new ChatRuntime(client as never, () => {})
    await runtime.open('/p', 'goal')
    expect(runtime.session.sessionGoal).toEqual({ objective: 'ship the fix', status: 'active' })
    // Paused while the phone was away: the event never arrived, the snapshot has it.
    goal = { objective: 'ship the fix', status: 'paused' }
    await runtime.reopen()
    expect(runtime.session.sessionGoal).toEqual({ objective: 'ship the fix', status: 'paused' })
    goal = null
    await runtime.reopen()
    expect(runtime.session.sessionGoal).toBeNull()
    runtime.dispose()
  })
  it('isolates same-ID messages and command errors by their owning environment', async () => {
    const client = fakeClient()
    const onCommandError = vi.fn()
    const runtime = new ChatRuntime(client as never, () => {}, { onCommandError })
    await runtime.open('/app', 'same')
    runtime.sourceEnvironmentId = 'node'
    runtime.ingest([{ type: 'remote_command_error', environmentId: 'desktop', sessionId: 'same', command: 'interrupt', message: 'Foreign error' }])
    expect(onCommandError).not.toHaveBeenCalled()
    runtime.ingest([{ type: 'remote_command_error', environmentId: 'node', sessionId: 'same', command: 'interrupt', message: 'Control denied' }])
    expect(onCommandError).toHaveBeenCalledWith('Control denied')
    const message = { id: 'foreign', role: 'user', content: [{ type: 'text', text: 'Foreign message' }], status: 'complete', createdAt: new Date().toISOString() }
    runtime.ingest([{ type: 'user_message_appended', environmentId: 'desktop', sessionId: 'same', message }])
    expect(runtime.session.messages).toEqual([])
    runtime.dispose()
  })
  it('clears the previous harness permission catalog when OpenCode offers no modes', async () => {
    const client = fakeClient()
    const runtime = new ChatRuntime(client as never, () => {})
    await runtime.create('/p', { provider: 'claude' })
    await runtime.loadSystemInfo('claude')
    client.dispatch.mockResolvedValueOnce({ permissionModes: [], models: [], agents: [{ id: 'build', name: 'Build' }] })
    await runtime.loadSystemInfo('opencode')
    expect(runtime.permissionModes).toEqual([])
  })
  it('create_session then restore, and loads slash commands', async () => {
    const client = fakeClient()
    const paints: unknown[] = []
    const runtime = new ChatRuntime(client as never, (s) => paints.push(s))
    const id = await runtime.create('/p', {
      provider: 'claude',
      worktreeBranch: 'main',
      worktreeMode: 'branch',
      worktreeBranchName: 'feat/mobile',
      worktreeCarryLocalChanges: true,
      additionalDirectories: ['/shared'],
      sandboxMode: 'auto',
    })
    expect(id).toBeTruthy()
    expect(client.sent.some((c) => (c as { method: string }).method === 'session.create')).toBe(true)
    expect(client.sent).toContainEqual(expect.objectContaining({
      method: 'session.create',
      worktreeBranch: 'main',
      worktreeMode: 'branch',
      worktreeBranchName: 'feat/mobile',
      worktreeCarryLocalChanges: true,
      additionalDirectories: ['/shared'],
      sandboxMode: 'auto',
    }))
    // Catalog assembly moved to `slash-catalog.ts`, which the composer owns and
    // which is covered by its own suite — the runtime no longer holds a copy.
    const info = await runtime.loadSystemInfo('claude')
    expect(info.permissionModes).toContain('plan')
    await runtime.setPermissionMode('plan')
    expect(runtime.permissionMode).toBe('plan')
    await runtime.send('hello', {
      model: 'm',
      effort: 'high',
      images: [{ name: 'a.png', mimeType: 'image/png', base64: 'AA==' }],
    })
    expect(client.sent).toContainEqual(expect.objectContaining({
      method: 'session.send',
      model: 'm',
      effort: 'high',
      images: [{ name: 'a.png', mimeType: 'image/png', base64: 'AA==' }],
    }))
    runtime.send('fast-off', { serviceTier: null })
    expect(client.sent).toContainEqual(expect.objectContaining({
      method: 'session.send',
      text: 'fast-off',
      serviceTier: null,
    }))
    expect(client.dispatch).toHaveBeenCalledWith(expect.objectContaining({ method: 'session.send', images: expect.any(Array) }))
    runtime.session = { ...runtime.session, status: 'streaming' }
    runtime.send('later', { clientMessageId: 'user_q', priority: 'next' })
    expect(runtime.session.queuedMessages.map((message) => message.id)).toEqual(['user_q'])
    expect(paints.at(-1)).toMatchObject({ queuedMessages: [expect.objectContaining({ id: 'user_q' })] })
    expect(client.sent).toContainEqual(expect.objectContaining({
      method: 'session.send', clientMessageId: 'user_q', priority: 'next',
    }))
    runtime.interrupt()
    expect(client.sent).toContainEqual(expect.objectContaining({ method: 'session.interrupt', sessionId: id }))
    expect(client.dispatch).toHaveBeenCalledWith(expect.objectContaining({ method: 'session.interrupt' }))
    expect(client.followSession).toHaveBeenCalledOnce()
    expect(client.sent.some((c) => (c as { method: string }).method === 'session.load')).toBe(true)
  })

  it('paints the first bubble before the host has a session, then hands it to the send', async () => {
    const client = fakeClient()
    let releaseCreate: () => void = () => {}
    const answer = client.dispatch.getMockImplementation()!
    client.dispatch.mockImplementation(async (cmd: { method: string; sessionId?: string }) => {
      if (cmd.method === 'session.create') {
        await new Promise<void>((resolve) => { releaseCreate = resolve })
        client.sent.push(cmd)
        return { sessionId: cmd.sessionId }
      }
      return answer(cmd)
    })
    const paints: Array<{ messages: string[]; pendingTurn: string | null }> = []
    const runtime = new ChatRuntime(client as never, (s) => {
      paints.push({ messages: s.messages.map((m) => m.id), pendingTurn: runtime.pendingTurn })
    })
    const image = { id: 'img1', name: 'a.png', mimeType: 'image/png', base64: 'AA==' }
    runtime.stageTurn('user_first', 'hello', [image])
    // Painted synchronously: nothing has gone over the wire yet.
    expect(client.sent).toEqual([])
    expect(paints.at(-1)).toEqual({ messages: ['user_first'], pendingTurn: 'creating' })
    // Shaped like the host's message — attachment blocks before the text — since
    // this bubble, not the echo, is what the transcript keeps.
    expect(runtime.session.messages[0]).toMatchObject({
      role: 'user', attachments: [image], providerId: 'local',
      content: [{ type: 'image', name: 'a.png', id: 'img1' }, { type: 'text', text: 'hello' }],
    })
    expect(runtime.streaming).toBe(true)

    const created = runtime.create('/p', { sessionId: 's1', provider: 'claude' })
    await Promise.resolve()
    expect(runtime.pendingTurn).toBe('creating')
    releaseCreate()
    await created
    expect(paints.at(-1)).toEqual({ messages: ['user_first'], pendingTurn: 'sending' })

    runtime.send('hello', { images: [image], clientMessageId: 'user_first' })
    // Same id as the staged bubble: the transcript still holds one row.
    expect(runtime.session.messages.map((m) => m.id)).toEqual(['user_first'])
    expect(client.sent).toContainEqual(expect.objectContaining({
      method: 'session.send', clientMessageId: 'user_first', text: 'hello',
    }))
    // The host's echo carries the same id and is ignored as a duplicate…
    runtime.ingest([{ type: 'user_message_appended', message: {
      id: 'user_first', role: 'user', status: 'complete', content: [{ type: 'text', text: 'hello' }],
      createdAt: new Date().toISOString(), providerId: 'remote',
    } }])
    expect(runtime.session.messages.map((m) => m.id)).toEqual(['user_first'])
    expect(runtime.pendingTurn).toBe('sending')
    // …and the assistant's first row takes over from the pending line.
    runtime.ingest([{ type: 'message_start', message: {
      id: 'assistant_1', role: 'assistant', status: 'streaming', content: [],
      createdAt: new Date().toISOString(), providerId: 'claude',
    } }])
    expect(runtime.pendingTurn).toBeNull()
  })

  it('paints a live send optimistically with a generated id the host will echo', () => {
    const client = fakeClient()
    const paint = vi.fn()
    const runtime = new ChatRuntime(client as never, paint)
    runtime.projectPath = '/p'
    runtime.sessionId = 's'
    runtime.send('again')
    const sent = client.sent.find((c) => (c as { method: string }).method === 'session.send') as { clientMessageId?: string }
    expect(sent.clientMessageId).toMatch(/^user/)
    expect(runtime.session.messages.map((m) => m.id)).toEqual([sent.clientMessageId])
    expect(runtime.session.queuedMessages).toEqual([])
    expect(runtime.pendingTurn).toBe('sending')
    expect(paint).toHaveBeenCalledTimes(1)
  })

  it('drops the pending line on Stop, since no reply will come to clear it', () => {
    const client = fakeClient()
    const runtime = new ChatRuntime(client as never, vi.fn())
    runtime.projectPath = '/p'
    runtime.sessionId = 's'
    runtime.send('hello')
    expect(runtime.pendingTurn).toBe('sending')
    runtime.interrupt()
    expect(runtime.pendingTurn).toBeNull()
    expect(runtime.streaming).toBe(false)
    expect(client.sent).toContainEqual(expect.objectContaining({ method: 'session.interrupt', sessionId: 's' }))
  })

  it('takes a new session worktree from the atomic host snapshot', async () => {
    const client = fakeClient(), answer = client.dispatch.getMockImplementation()!
    client.dispatch.mockImplementation(async call => call.method === 'session.load'
      ? sessionLoadFixture({ restore: { sourceEnvironmentId: 'desktop', mcpAppContexts: [], isWorktree: true, worktreePath: '/p/.worktrees/feat', gitBranch: 'feat/mobile', worktreeMissing: false } }) : answer(call))
    const runtime = new ChatRuntime(client as never, vi.fn())
    await runtime.create('/p', { sessionId: 's1', worktreeBranch: 'main', worktreeMode: 'branch', worktreeBranchName: 'feat/mobile' })
    expect(runtime.worktree).toEqual({ isWorktree: true, worktreePath: '/p/.worktrees/feat', gitBranch: 'feat/mobile' })
  })

  it('reads a local new session as local when the host runs it in the project folder', async () => {
    const runtime = new ChatRuntime(fakeClient() as never, vi.fn())
    await runtime.create('/p', { sessionId: 's1', gitBranch: 'main' })
    expect(runtime.worktree).toEqual({ isWorktree: false, worktreePath: null, gitBranch: null })
  })

  it('forgets a staged session the host refused so it cannot be cached as a transcript', async () => {
    const client = fakeClient()
    client.dispatch.mockImplementation(async (cmd: { method: string }) => {
      if (cmd.method === 'session.create') throw new Error('Worktree path not found')
      return { ok: true }
    })
    const put = vi.fn()
    const runtime = new ChatRuntime(client as never, vi.fn(), {
      pairingId: () => 'pair', transcripts: { get: () => null, put } as never,
    })
    runtime.stageTurn('user_first', 'hello')
    await expect(runtime.create('/p', { sessionId: 's1' })).rejects.toThrow('Worktree path not found')
    runtime.dispose()
    expect(put).not.toHaveBeenCalled()
  })

  it('folds composer Stair into the queued send so the host can steer atomically', () => {
    const client = fakeClient()
    const runtime = new ChatRuntime(client as never, vi.fn())
    runtime.projectPath = '/p'
    runtime.sessionId = 's'
    runtime.session = { ...runtime.session, status: 'streaming' }
    runtime.send('nudge', { clientMessageId: 'user_steer', priority: 'next', steer: 'now' })
    expect(client.sent).toContainEqual(expect.objectContaining({
      method: 'session.send',
      clientMessageId: 'user_steer',
      priority: 'next',
      steer: 'now',
    }))
    expect(runtime.session.queuedMessages.map((message) => message.id)).toEqual(['user_steer'])
  })

  it('paints a confirmed dequeue so a parked bubble can return to the composer', async () => {
    const paint = vi.fn()
    const runtime = new ChatRuntime(fakeClient() as never, paint)
    runtime.projectPath = '/p'
    runtime.sessionId = 's'
    runtime.session = { ...runtime.session, status: 'streaming' }
    runtime.send('later', { clientMessageId: 'user_q', priority: 'next' })
    paint.mockClear()
    await runtime.dequeueMessage('user_q')
    expect(runtime.session.queuedMessages).toEqual([])
    expect(paint).toHaveBeenCalledTimes(1)
  })

  it('keeps a queued message when the host refuses its dequeue', async () => {
    const client = fakeClient(), answer = client.dispatch.getMockImplementation()!
    client.dispatch.mockImplementation(async call => {
      if (call.method === 'session.dequeue') throw Object.assign(new Error('control changed'), { code: 'lease_stale' })
      return answer(call)
    })
    const runtime = new ChatRuntime(client as never, vi.fn())
    runtime.projectPath = '/p'; runtime.sessionId = 's'; runtime.session.status = 'streaming'
    runtime.send('later', { clientMessageId: 'user_q', priority: 'next' })
    await expect(runtime.dequeueMessage('user_q')).rejects.toThrow('control changed')
    expect(runtime.session.queuedMessages.map(message => message.id)).toEqual(['user_q'])
    runtime.dispose()
  })

  it('does not move a bubble into the composer after the host already consumed it', async () => {
    const client = fakeClient(), answer = client.dispatch.getMockImplementation()!
    client.dispatch.mockImplementation(async call => call.method === 'session.dequeue' ? { removed: false } : answer(call))
    const runtime = new ChatRuntime(client as never, vi.fn())
    runtime.projectPath = '/p'; runtime.sessionId = 's'; runtime.session.status = 'streaming'
    runtime.send('later', { clientMessageId: 'user_q', priority: 'next' })
    expect(await runtime.dequeueMessage('user_q')).toBe(false)
    expect(runtime.session.queuedMessages.map(message => message.id)).toEqual(['user_q'])
    runtime.dispose()
  })

  it('throws the host create_session error so the shell can show it', async () => {
    const client = fakeClient()
    client.dispatch.mockImplementation(async (cmd: { method: string }) => {
      if (cmd.method === 'session.create') throw new Error('Worktree path not found')
      return { ok: true }
    })
    const runtime = new ChatRuntime(client as never, vi.fn())
    await expect(runtime.create('/p')).rejects.toThrow('Worktree path not found')
  })

  it('requests a Grok recap without sending a turn', async () => {
    const client = fakeClient()
    const paint = vi.fn()
    const runtime = new ChatRuntime(client as never, paint)
    const id = await runtime.create('/p', { provider: 'acp', acpAgentId: 'grok-build' })
    client.dispatch.mockImplementation(async (cmd: { method: string }) => {
      client.sent.push(cmd)
      if (cmd.method === 'session.recap') return { ok: true }
      return { ok: true, sessionId: id }
    })

    await expect(runtime.requestRecap()).resolves.toBe(true)
    expect(client.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      method: 'session.recap',
      sessionId: id,
      environmentId: 'desktop',
    }))
    const recapCmd = client.sent.find((c) => (c as { method: string }).method === 'session.recap') as { auto?: boolean }
    expect(recapCmd.auto).toBeUndefined()
    expect(client.sent.some((c) => (c as { method: string }).method === 'session.send')).toBe(false)
    expect(runtime.session.isRecapping).toBe(true)
    expect(paint).toHaveBeenCalled()
  })

  it('notifies when a session recap arrives', async () => {
    const client = fakeClient()
    const onSessionRecap = vi.fn()
    const runtime = new ChatRuntime(client as never, vi.fn(), { onSessionRecap })
    const id = await runtime.create('/p', { provider: 'acp', acpAgentId: 'grok-build' })
    runtime.ingest([{ type: 'session_recap', summary: 'We wired recap.', auto: true }])
    expect(onSessionRecap).toHaveBeenCalledWith(id)
  })

  it('clears the recap spinner when the host skips the RPC', async () => {
    const client = fakeClient()
    const runtime = new ChatRuntime(client as never, vi.fn())
    await runtime.create('/p', { provider: 'acp', acpAgentId: 'grok-build' })
    client.dispatch.mockResolvedValue({ ok: false })

    await expect(runtime.requestRecap()).resolves.toBe(false)
    expect(runtime.session.isRecapping).toBe(false)
  })

  it('forwards the selected ACP agent when creating a session', async () => {
    const client = fakeClient()
    const runtime = new ChatRuntime(client as never, vi.fn())

    await runtime.create('/p', {
      provider: 'acp',
      acpAgentId: 'grok-build',
      model: 'grok-4',
      effort: 'deep',
    })

    expect(client.sent).toContainEqual(expect.objectContaining({
      method: 'session.create',
      harnessId: 'acp',
      acpAgentId: 'grok-build',
      model: 'grok-4',
      effort: 'deep',
    }))
  })

  it('paints at most once per 33ms event batch', () => {
    vi.useFakeTimers()
    const paint = vi.fn()
    const runtime = new ChatRuntime(fakeClient() as never, paint)
    runtime.ingest([{
      type: 'message_start',
      message: { id: 'm', role: 'assistant', status: 'streaming', content: [], createdAt: '', providerId: 'claude' },
    }])
    vi.advanceTimersByTime(16)
    runtime.ingest([{ type: 'content_delta', messageId: 'm', delta: { type: 'text', text: 'hi' } }])
    vi.advanceTimersByTime(16)
    expect(paint).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(paint).toHaveBeenCalledTimes(1)
    expect(paint).toHaveBeenLastCalledWith(runtime.session, false)
    expect(runtime.messages[0]?.content).toEqual([{ type: 'text', text: 'hi' }])
  })

  it('hydrates restored messages on open, reconnect, and same-connection session switches', async () => {
    const base = fakeClient(7)
    const client = base, answer = client.dispatch.getMockImplementation()!
    client.dispatch.mockImplementation(async cmd => {
      if (cmd.method === 'session.load') return sessionLoadFixture({ messages: [{
        id: `${cmd.sessionId}-history`, role: 'assistant', status: 'complete',
        content: [{ type: 'text', text: 'Previously received answer' }], createdAt: '', providerId: 'claude',
      }] })
      return answer(cmd)
    })
    const paint = vi.fn()
    const runtime = new ChatRuntime(client as never, paint)

    await runtime.open('/p', 'first')
    await runtime.reopen()
    await runtime.open('/p', 'second')

    expect(paint.mock.calls.map(([session, hydrate]) => ({
      messageId: session.messages[0]?.id, hydrate,
    }))).toEqual([
      { messageId: 'first-history', hydrate: true },
      { messageId: 'first-history', hydrate: true },
      { messageId: 'second-history', hydrate: true },
    ])
    expect(runtime.epoch).toBe(7)
  })

  it('reopens from the connection cache without reloading the whole history page', async () => {
    const history = [{
      id: 'm1', role: 'assistant' as const, status: 'complete' as const,
      content: [{ type: 'text' as const, text: 'cached' }], createdAt: '', providerId: 'claude',
    }]
    const store = new Map<string, CachedTranscript>()
    const client = fakeClient()
    const answer = client.dispatch.getMockImplementation()!
    client.dispatch.mockImplementation(async cmd => {
      if (cmd.method === 'session.load') { client.sent.push(cmd); return sessionLoadFixture({ messages: history }) }
      return answer(cmd)
    })
    const runtime = new ChatRuntime(client as never, vi.fn(), {
      pairingId: () => 'desk-1',
      transcripts: {
        get: (_pairing, project, session) => store.get(`${project}\0${session}`) ?? null,
        put: (_pairing, project, session, transcript) => { store.set(`${project}\0${session}`, transcript) },
      },
    })
    await runtime.open('/p', 's1')
    expect(store.get('/p\0s1')?.messages).toEqual(history)
    client.sent.length = 0
    await runtime.open('/p', 's1')
    expect(client.sent.map((cmd) => (cmd as { method: string }).method)).toEqual(['session.load', 'environment.descriptor'])
  })

  it('does not persist an in-flight assistant turn into the connection cache', async () => {
    const store = new Map<string, CachedTranscript>()
    const runtime = new ChatRuntime(fakeClient() as never, vi.fn(), {
      pairingId: () => 'desk-1',
      transcripts: {
        get: (_pairing, project, session) => store.get(`${project}\0${session}`) ?? null,
        put: (_pairing, project, session, transcript) => { store.set(`${project}\0${session}`, transcript) },
      },
    })
    await runtime.open('/p', 's1')
    runtime.session = {
      ...runtime.session,
      messages: [
        { id: 'done', role: 'user', status: 'complete', content: [{ type: 'text', text: 'q' }], createdAt: '', providerId: 'claude' },
        { id: 'live', role: 'assistant', status: 'streaming', content: [{ type: 'text', text: 'half' }], createdAt: '', providerId: 'claude' },
      ],
    }
    runtime.dispose()
    expect(store.get('/p\0s1')?.messages.map((row) => row.id)).toEqual(['done'])
  })

  it('cancels a pending live paint when restore replaces the transcript', async () => {
    vi.useFakeTimers()
    const paint = vi.fn()
    const runtime = new ChatRuntime(fakeClient() as never, paint)
    await runtime.open('/p', 's')
    paint.mockClear()

    runtime.ingest([{
      type: 'message_start',
      message: { id: 'pending', role: 'assistant', status: 'streaming', content: [], createdAt: '', providerId: 'claude' },
    }])
    await runtime.reopen()
    vi.advanceTimersByTime(33)

    expect(paint).toHaveBeenCalledTimes(1)
    expect(paint).toHaveBeenLastCalledWith(expect.objectContaining({ messages: [] }), true)
  })

  it('tracks generated session titles for native chrome', () => {
    vi.useFakeTimers()
    const runtime = new ChatRuntime(fakeClient() as never, vi.fn())
    runtime.sessionId = 's'
    runtime.ingest([{ type: 'session_title_changed', sessionId: 's', title: 'Generated title', source: 'agent' }])
    vi.advanceTimersByTime(33)
    expect(runtime.sessionTitle).toBe('Generated title')
  })

  it('drops live events from stale buffer epochs', async () => {
    vi.useFakeTimers()
    const paint = vi.fn()
    const runtime = new ChatRuntime(fakeClient(7) as never, paint)
    await runtime.open('/p', 's')
    expect(runtime.epoch).toBe(7)
    paint.mockClear()
    const start = {
      type: 'message_start',
      message: { id: 'fresh', role: 'assistant', status: 'streaming', content: [], createdAt: '', providerId: 'claude' },
    }
    runtime.ingest([start], 6)
    vi.advanceTimersByTime(33)
    expect(paint).not.toHaveBeenCalled()
    runtime.ingest([start], 7)
    vi.advanceTimersByTime(33)
    expect(paint).toHaveBeenCalledTimes(1)
    expect(runtime.messages.map((message) => message.id)).toEqual(['fresh'])
  })

  it('reduces live interaction requests for native sheets and routes responses', async () => {
    vi.useFakeTimers()
    const client = fakeClient()
    const runtime = new ChatRuntime(client as never, vi.fn())
    runtime.projectPath = '/p'
    runtime.sessionId = 's'
    runtime.ingest([
      {
        type: 'permission_request',
        request: { requestId: 'perm', toolName: 'Bash', input: {}, allowAlwaysAllow: false },
      },
      {
        type: 'plan_approval',
        request: { requestId: 'plan', planContent: '# Plan', planFilePath: '', allowedPrompts: [] },
      },
      {
        type: 'ask_user_question',
        request: { requestId: 'question', questions: [] },
      },
    ])
    vi.advanceTimersByTime(33)
    expect(runtime.pendingPermission?.requestId).toBe('perm')
    expect(runtime.session.pendingPlanApproval?.requestId).toBe('plan')
    expect(runtime.session.pendingQuestion?.requestId).toBe('question')
    const formAnswers = { sessionAgentLaunchesJson: '[{"mode":"handoff"}]' }
    runtime.respondPermission('perm', true, formAnswers, true, 'approved on mobile', [1, 3])
    runtime.respondPlan('plan', false, 'change it')
    runtime.respondCodexPlan('assistant-1', 'rejected', 'revise it')
    runtime.answerQuestion('question', { Scope: 'All' }, { Scope: { notes: 'Include tests' } })
    expect(runtime.session.pendingQuestion).toBeNull()
    expect(client.sent).toEqual(expect.arrayContaining([
      expect.objectContaining({
        method: 'session.respondPermission',
        interactionId: 'perm',
        decision: 'allow_always',
        formAnswers,
        reason: 'approved on mobile',
        selectedSuggestions: [1, 3],
      }),
      expect.objectContaining({ method: 'session.respondPlan', interactionId: 'plan', decision: 'reject', options: { feedback: 'change it' } }),
      expect.objectContaining({
        method: 'session.respondPlan',
        interactionId: 'assistant-1', decision: 'reject',
        options: { messageId: 'assistant-1', feedback: 'revise it' },
      }),
      expect.objectContaining({
        method: 'session.respondQuestion',
        interactionId: 'question',
        annotations: { Scope: { notes: 'Include tests' } },
      }),
    ]))
  })

  it('closes the native question sheet as soon as the phone answers or dismisses', async () => {
    vi.useFakeTimers()
    const paint = vi.fn()
    const runtime = new ChatRuntime(fakeClient() as never, paint)
    runtime.projectPath = '/p'
    runtime.sessionId = 's'
    const question = {
      requestId: 'question',
      questions: [{ header: 'Scope', question: 'Scope', options: [{ label: 'All', description: '' }], multiSelect: false }],
    }
    runtime.ingest([{ type: 'ask_user_question', request: question }])
    vi.advanceTimersByTime(33)
    paint.mockClear()

    runtime.answerQuestion('question', { Scope: 'All' })
    expect(runtime.session.pendingQuestion).toBeNull()
    expect(paint).toHaveBeenCalled()

    runtime.ingest([{ type: 'ask_user_question', request: question }])
    vi.advanceTimersByTime(33)
    expect(runtime.session.pendingQuestion).toBeNull()

    runtime.ingest([{ type: 'ask_user_question', request: { ...question, requestId: 'question-2' } }])
    vi.advanceTimersByTime(33)
    expect(runtime.session.pendingQuestion?.requestId).toBe('question-2')
    paint.mockClear()
    runtime.dismissQuestion('question-2')
    expect(runtime.session.pendingQuestion).toBeNull()
    expect(paint).toHaveBeenCalled()
  })
})

it('pages older history without dropping live messages or requesting the same page twice', async () => {
  const base = fakeClient()
  let resolvePage!: (value: unknown) => void
  let reads = 0
  const row = (id: string) => ({ id, role: 'assistant', status: 'complete', content: [], createdAt: '', providerId: 'claude' })
  const client = base, answer = client.dispatch.getMockImplementation()!
  client.dispatch.mockImplementation(async command => {
    if (command.method !== 'session.load') return answer(command)
    if (++reads === 1) return sessionLoadFixture({ messages: [row('latest') as never], before: 24 })
    return new Promise(resolve => { resolvePage = resolve })
  })
  const runtime = new ChatRuntime(client as never, vi.fn())
  await runtime.open('/p', 's')
  const first = runtime.loadEarlier()
  expect(runtime.loadEarlier()).toBe(first)
  runtime.ingest([{ type: 'message_start', message: row('live') }])
  resolvePage(sessionLoadFixture({ messages: [row('older'), row('latest')] as never }))
  await expect(first).resolves.toEqual([row('older')])
  expect(runtime.messages.map(message => message.id)).toEqual(['older', 'latest', 'live'])
  expect(runtime.hasMoreHistory).toBe(false)
  runtime.dispose()
})

describe('attachment originals behind transcript thumbnails', () => {
  it('fetches the bytes once per picture and surfaces a host refusal', async () => {
    const client = fakeClient()
    const runtime = new ChatRuntime(client as never, () => {})
    runtime.projectPath = '/p'
    runtime.sessionId = 's1'
    await expect(runtime.loadAttachment('user_1', { attachmentId: 'a1', name: 'IMG_0005.jpg' })).resolves.toBe('data:image/jpeg;base64,/9j/')
    await expect(runtime.loadAttachment('user_1', { attachmentId: 'a1', name: 'IMG_0005.jpg' })).resolves.toBe('data:image/jpeg;base64,/9j/')
    expect(client.sent.filter((cmd) => (cmd as { method: string }).method === 'session.attachment')).toEqual([
      expect.objectContaining({ method: 'session.attachment', environmentId: 'desktop', sessionId: 's1', messageId: 'user_1', attachmentId: 'a1', name: 'IMG_0005.jpg' }),
    ])
    await expect(runtime.loadAttachment('user_1', { attachmentId: 'gone', name: 'x.jpg' })).rejects.toThrow('no longer available')
    runtime.dispose()
  })
  it('restores a queued message with original bytes for thumbnails and keeps bytes it already holds', async () => {
    const client = fakeClient()
    const runtime = new ChatRuntime(client as never, () => {})
    runtime.projectPath = '/p'
    runtime.sessionId = 's1'
    const own = { id: 'own', name: 'own.png', mimeType: 'image/png', base64: 'iVBORw0KGgo=' }
    const thumb = { id: 'a1', name: 'desk.jpg', mimeType: 'image/jpeg', base64: 'dGh1bWI=', preview: true }
    const originals = await runtime.originalAttachments({
      id: 'q1', role: 'user', status: 'complete', createdAt: '', providerId: 'remote', content: [], attachments: [own, thumb],
    })
    expect(originals).toEqual([own, { id: 'a1', name: 'desk.jpg', mimeType: 'image/jpeg', base64: '/9j/' }])
    expect(client.sent.filter((cmd) => (cmd as { method: string }).method === 'session.attachment')).toEqual([
      expect.objectContaining({ messageId: 'q1', attachmentId: 'a1', name: 'desk.jpg' }),
    ])
    runtime.dispose()
  })
})


it('paints the saved transcript before the subscribe response arrives', async () => {
  const client = fakeClient()
  let release!: (value: unknown) => void
  client.dispatch.mockImplementationOnce(() => new Promise(resolve => { release = resolve as typeof release }))
  const cached = { messages: [{ id: 'cached', role: 'user', content: [{ type: 'text', text: 'saved' }], createdAt: '', status: 'complete' }], cursor: null, hasMore: false }
  const paint = vi.fn()
  const onCachedHydrate = vi.fn()
  const runtime = new ChatRuntime(client as never, paint, { onCachedHydrate, pairingId: () => 'host', transcripts: { get: () => cached, put() {} } as never })
  const opening = runtime.open('/p', 's')
  await Promise.resolve(); await Promise.resolve()
  expect(paint).toHaveBeenCalledWith(expect.objectContaining({ messages: cached.messages }), true)
  // The shell must uncover this page while subscribe is still pending.
  expect(onCachedHydrate).toHaveBeenCalledOnce()
  await vi.waitFor(() => expect(release).toBeTypeOf('function'))
  release(sessionLoadFixture())
  await opening
  runtime.dispose()
})
