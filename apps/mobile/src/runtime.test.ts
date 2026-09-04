import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatRuntime } from './runtime'

function fakeClient(epoch = 1) {
  const sent: unknown[] = []
  return {
    sent,
    startBuffering() {},
    releaseBuffer() { return { epoch, batches: [] } },
    send: vi.fn((cmd: { type: string }) => { sent.push(cmd) }),
    request: vi.fn(async (cmd: { type: string; sessionId?: string }) => {
      sent.push(cmd)
      if (cmd.type === 'subscribe_session') return { ok: true }
      if (cmd.type === 'load_session_messages') return { messages: [], hasMore: false }
      if (cmd.type === 'get_session_state') return { status: 'idle', pendingInteractions: [], inProgressMessages: [] }
      if (cmd.type === 'create_session') return { ok: true, sessionId: cmd.sessionId }
      if (cmd.type === 'get_system_info') {
        return { userSlashCommands: [{ name: 'help' }], permissionModes: ['default', 'plan'], models: [{ id: 'm' }] }
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
    }))
    const info = await runtime.loadSystemInfo('claude')
    expect(runtime.slashCommands).toEqual([{ name: 'help' }])
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
    expect(client.request).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'send_message' }))
    runtime.interrupt()
    expect(client.sent).toContainEqual(expect.objectContaining({ type: 'interrupt', sessionId: id }))
    expect(client.request).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'interrupt' }))
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
    expect(runtime.messages[0]?.content).toEqual([{ type: 'text', text: 'hi' }])
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
    runtime.respondPermission('perm', true, formAnswers, true, 'approved on mobile')
    runtime.respondPlan('plan', false, 'change it')
    runtime.answerQuestion('question', { Scope: 'All' })
    expect(client.sent).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'respond_permission',
        requestId: 'perm',
        decision: true,
        formAnswers,
        alwaysAllow: true,
        reason: 'approved on mobile',
      }),
      expect.objectContaining({ type: 'respond_plan_approval', requestId: 'plan', approved: false }),
      expect.objectContaining({ type: 'answer_question', requestId: 'question' }),
    ]))
  })

  it('routes shared-file side events without adding transcript state', () => {
    vi.useFakeTimers()
    const paint = vi.fn()
    const onSharedFile = vi.fn()
    const onSharedFileProgress = vi.fn()
    const runtime = new ChatRuntime(fakeClient() as never, paint, {
      onSharedFile,
      onSharedFileProgress,
    })
    const event = {
      type: 'shared_file' as const,
      shareId: 'share-1',
      sentAt: 123,
      file: { name: 'report.pdf', mimeType: 'application/pdf', size: 1, inlineBase64: 'AA==' },
    }
    runtime.ingest([
      event,
      { type: 'shared_file_progress', path: 'report.pdf', loaded: 1, total: 2 },
    ])
    vi.advanceTimersByTime(33)

    expect(onSharedFile).toHaveBeenCalledWith(event)
    expect(onSharedFileProgress).toHaveBeenCalledWith(expect.objectContaining({ loaded: 1, total: 2 }))
    expect(runtime.messages).toEqual([])
    expect(paint).not.toHaveBeenCalled()
  })
})
