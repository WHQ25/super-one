import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CachedTranscript } from '@superone/relay-client'
import { ChatRuntime } from './runtime'

function fakeClient(epoch = 1) {
  const sent: unknown[] = []
  return {
    sent,
    startBuffering() {},
    releaseBuffer() { return { epoch, batches: [] } },
    send: vi.fn((cmd: { type: string }) => { sent.push(cmd) }),
    request: vi.fn(async (cmd: {
      type: string
      sessionId?: string
      attachmentId?: string
      name?: string
    }): Promise<Record<string, unknown>> => {
      sent.push(cmd)
      if (cmd.type === 'subscribe_session') return { ok: true }
      if (cmd.type === 'load_session_messages') return { messages: [], hasMore: false }
      if (cmd.type === 'get_session_state') return { status: 'idle', pendingInteractions: [], inProgressMessages: [] }
      if (cmd.type === 'create_session') return { ok: true, sessionId: cmd.sessionId }
      if (cmd.type === 'get_system_info') {
        return { userSlashCommands: [{ name: 'help' }], permissionModes: ['default', 'plan'], models: [{ id: 'm' }] }
      }
      if (cmd.type === 'get_project_resources') {
        return {
          projectSlashCommands: [{ name: 'project' }],
          skills: [{ name: 'ship', description: 'Release' }],
        }
      }
      if (cmd.type === 'get_attachment') {
        if (cmd.attachmentId === 'gone') return { error: 'That attachment is no longer available' }
        return { attachment: { id: cmd.attachmentId, name: cmd.name, mimeType: 'image/jpeg', base64: '/9j/' } }
      }
      return { ok: true }
    }),
  }
}

afterEach(() => vi.useRealTimers())

describe('ChatRuntime', () => {
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
    expect(client.sent.some((c) => (c as { type: string }).type === 'create_session')).toBe(true)
    expect(client.sent).toContainEqual(expect.objectContaining({
      type: 'create_session',
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
      type: 'send_message',
      provider: 'claude',
      model: 'm',
      effort: 'high',
      images: [{ name: 'a.png', mimeType: 'image/png', base64: 'AA==' }],
    }))
    runtime.send('fast-off', { serviceTier: null })
    expect(client.sent).toContainEqual(expect.objectContaining({
      type: 'send_message',
      content: 'fast-off',
      serviceTier: null,
    }))
    expect(client.request).toHaveBeenCalledWith(expect.objectContaining({ type: 'send_message', images: expect.any(Array), requestId: expect.any(String) }))
    runtime.session = { ...runtime.session, status: 'streaming' }
    runtime.send('later', { clientMessageId: 'user_q', priority: 'next' })
    expect(runtime.session.queuedMessages.map((message) => message.id)).toEqual(['user_q'])
    expect(paints.at(-1)).toMatchObject({ queuedMessages: [expect.objectContaining({ id: 'user_q' })] })
    expect(client.sent).toContainEqual(expect.objectContaining({
      type: 'send_message', clientMessageId: 'user_q', priority: 'next',
    }))
    runtime.interrupt()
    expect(client.sent).toContainEqual(expect.objectContaining({ type: 'interrupt', sessionId: id }))
    expect(client.request).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'interrupt' }))
    expect(client.sent.some((c) => (c as { type: string }).type === 'subscribe_session')).toBe(true)
    expect(client.sent.some((c) => (c as { type: string }).type === 'load_session_messages')).toBe(false)
  })

  it('paints the first bubble before the host has a session, then hands it to the send', async () => {
    const client = fakeClient()
    let releaseCreate: () => void = () => {}
    client.request.mockImplementation(async (cmd: { type: string; sessionId?: string }) => {
      client.sent.push(cmd)
      if (cmd.type === 'create_session') {
        await new Promise<void>((resolve) => { releaseCreate = resolve })
        return { ok: true, sessionId: cmd.sessionId }
      }
      return { ok: true }
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
      type: 'send_message', clientMessageId: 'user_first', content: 'hello',
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
    const sent = client.sent.find((c) => (c as { type: string }).type === 'send_message') as { clientMessageId?: string }
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
    expect(client.sent).toContainEqual(expect.objectContaining({ type: 'interrupt', sessionId: 's' }))
  })

  it('takes a new session\'s worktree from the host, not from the landing picker', async () => {
    const client = fakeClient()
    client.request.mockImplementation(async (cmd: { type: string; sessionId?: string }) => {
      if (cmd.type === 'create_session') {
        // `create` mode: only the host knows the path it minted.
        return { ok: true, sessionId: cmd.sessionId, cwd: '/p/.worktrees/feat', gitBranch: 'feat/mobile' }
      }
      return { ok: true }
    })
    const runtime = new ChatRuntime(client as never, vi.fn())
    await runtime.create('/p', { sessionId: 's1', worktreeBranch: 'main', worktreeMode: 'branch', worktreeBranchName: 'feat/mobile' })
    expect(runtime.worktree).toEqual({ isWorktree: true, worktreePath: '/p/.worktrees/feat', gitBranch: 'feat/mobile' })
  })

  it('reads a local new session as local when the host runs it in the project folder', async () => {
    const client = fakeClient()
    client.request.mockImplementation(async (cmd: { type: string; sessionId?: string }) => (
      cmd.type === 'create_session' ? { ok: true, sessionId: cmd.sessionId, cwd: '/p', gitBranch: null } : { ok: true }
    ))
    const runtime = new ChatRuntime(client as never, vi.fn())
    await runtime.create('/p', { sessionId: 's1', gitBranch: 'main' })
    expect(runtime.worktree).toEqual({ isWorktree: false, worktreePath: null, gitBranch: null })
  })

  it('forgets a staged session the host refused so it cannot be cached as a transcript', async () => {
    const client = fakeClient()
    client.request.mockImplementation(async (cmd: { type: string }) => {
      if (cmd.type === 'create_session') return { ok: false, error: 'Worktree path not found' }
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
      type: 'send_message',
      clientMessageId: 'user_steer',
      priority: 'next',
      steer: 'now',
    }))
    expect(runtime.session.queuedMessages.map((message) => message.id)).toEqual(['user_steer'])
  })

  it('paints a dequeue so a parked bubble can return to the composer', () => {
    const paint = vi.fn()
    const runtime = new ChatRuntime(fakeClient() as never, paint)
    runtime.projectPath = '/p'
    runtime.sessionId = 's'
    runtime.session = { ...runtime.session, status: 'streaming' }
    runtime.send('later', { clientMessageId: 'user_q', priority: 'next' })
    paint.mockClear()
    runtime.dequeueMessage('user_q')
    expect(runtime.session.queuedMessages).toEqual([])
    expect(paint).toHaveBeenCalledTimes(1)
  })

  it('throws the host create_session error so the shell can show it', async () => {
    const client = fakeClient()
    client.request.mockImplementation(async (cmd: { type: string }) => {
      if (cmd.type === 'create_session') return { ok: false, error: 'Worktree path not found' }
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
    client.request.mockImplementation(async (cmd: { type: string }) => {
      client.sent.push(cmd)
      if (cmd.type === 'request_session_recap') return { ok: true }
      return { ok: true, sessionId: id }
    })

    await expect(runtime.requestRecap()).resolves.toBe(true)
    expect(client.request).toHaveBeenCalledWith(expect.objectContaining({
      type: 'request_session_recap',
      sessionId: id,
      projectPath: '/p',
    }))
    const recapCmd = client.sent.find((c) => (c as { type: string }).type === 'request_session_recap') as { auto?: boolean }
    expect(recapCmd.auto).toBeUndefined()
    expect(client.sent.some((c) => (c as { type: string }).type === 'send_message')).toBe(false)
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
    client.request.mockResolvedValue({ ok: false })

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
      type: 'create_session',
      provider: 'acp',
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
    const client = {
      ...base,
      request: async (cmd: { type: string; sessionId?: string }) => {
        if (cmd.type === 'load_session_messages') {
          return {
            messages: [{
              id: `${cmd.sessionId}-history`, role: 'assistant', status: 'complete',
              content: [{ type: 'text', text: 'Previously received answer' }],
              createdAt: '', providerId: 'claude',
            }],
            hasMore: false,
          }
        }
        return base.request(cmd)
      },
    }
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
    client.request.mockImplementation(async (cmd: { type: string }) => {
      client.sent.push(cmd)
      if (cmd.type === 'subscribe_session') {
        return { ok: true, historyPage: { messages: history, hasMore: false, cursor: null }, snapshot: { status: 'idle' } }
      }
      return { ok: true }
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
    expect(client.sent.map((cmd) => (cmd as { type: string }).type)).toEqual(['subscribe_session'])
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
        type: 'respond_permission',
        requestId: 'perm',
        decision: true,
        formAnswers,
        alwaysAllow: true,
        reason: 'approved on mobile',
        selectedSuggestions: [1, 3],
      }),
      expect.objectContaining({ type: 'respond_plan_approval', requestId: 'plan', approved: false }),
      expect.objectContaining({
        type: 'codex_plan_approval',
        messageId: 'assistant-1',
        status: 'rejected',
        feedback: 'revise it',
      }),
      expect.objectContaining({
        type: 'answer_question',
        requestId: 'question',
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
  const client = { ...base, request: vi.fn(async (command: { type: string }) => {
    if (command.type !== 'load_session_messages') return base.request(command)
    if (++reads === 1) return { messages: [row('latest')], hasMore: true, cursor: 24 }
    return new Promise(resolve => { resolvePage = resolve })
  }) }
  const runtime = new ChatRuntime(client as never, vi.fn())
  await runtime.open('/p', 's')
  const first = runtime.loadEarlier()
  expect(runtime.loadEarlier()).toBe(first)
  runtime.ingest([{ type: 'message_start', message: row('live') }])
  resolvePage({ messages: [row('older'), row('latest')], hasMore: false, cursor: null })
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
    expect(client.sent.filter((cmd) => (cmd as { type: string }).type === 'get_attachment')).toEqual([
      expect.objectContaining({ type: 'get_attachment', projectPath: '/p', sessionId: 's1', messageId: 'user_1', attachmentId: 'a1', name: 'IMG_0005.jpg' }),
    ])
    await expect(runtime.loadAttachment('user_1', { attachmentId: 'gone', name: 'x.jpg' })).rejects.toThrow('no longer available')
    runtime.dispose()
  })
})


it('paints the saved transcript before the subscribe response arrives', async () => {
  const client = fakeClient()
  let release!: (value: unknown) => void
  client.request.mockImplementationOnce(() => new Promise(resolve => { release = resolve as typeof release }))
  const cached = { messages: [{ id: 'cached', role: 'user', content: [{ type: 'text', text: 'saved' }], createdAt: '', status: 'complete' }], cursor: null, hasMore: false }
  const paint = vi.fn()
  const onCachedHydrate = vi.fn()
  const runtime = new ChatRuntime(client as never, paint, { onCachedHydrate, pairingId: () => 'host', transcripts: { get: () => cached, put() {} } as never })
  const opening = runtime.open('/p', 's')
  await Promise.resolve(); await Promise.resolve()
  expect(paint).toHaveBeenCalledWith(expect.objectContaining({ messages: cached.messages }), true)
  // The shell must uncover this page while subscribe is still pending.
  expect(onCachedHydrate).toHaveBeenCalledOnce()
  release({ ok: true, history: { messages: [], hasMore: false, cursor: null }, snapshot: { status: 'idle' } })
  await opening
  runtime.dispose()
})

