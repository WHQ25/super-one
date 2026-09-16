import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent, ChatMessage, SendMessageRequest } from '@superone/shared/agent-types'
import { ChatRuntime } from '../../../../mobile/src/runtime'
import { Session } from './session'
import type { SessionBackend } from './types'

vi.mock('../logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } }))

function fixture(initialMessages: ChatMessage[] = [], harnessId: 'claude' | 'codex' = 'claude') {
  let emit!: (event: AgentEvent) => void
  const backend = {
    kind: harnessId, start: vi.fn(async () => {}), send: vi.fn(async (_request: SendMessageRequest) => {}),
    onEvent: (listener: typeof emit) => { emit = listener; return () => {} },
    onProviderSessionId: () => () => {}, onPermissionModeApplied: () => () => {},
  }
  const onStateChange = vi.fn()
  const session = new Session({ id: 'session', projectPath: '/project', cwd: '/project',
    providerId: harnessId, harnessId, providerConfig: {}, backend: backend as unknown as SessionBackend,
    initialMessages, onStateChange })
  const out: AgentEvent[] = []
  session.on((event) => out.push(event))
  return { session, onStateChange, out, emit: (event: AgentEvent) => emit(event) }
}

function msg(id: string, role: 'user' | 'assistant', over: Partial<ChatMessage> = {}): ChatMessage {
  return { id, role, status: 'complete', content: [], createdAt: '', providerId: 'claude', ...over }
}

const boundary: AgentEvent = { type: 'compact_boundary', trigger: 'auto', preTokens: 120_000, postTokens: 30_000 }
const systemRows = (messages: readonly ChatMessage[]) => messages.filter((m) => m.providerId === 'system')

/**
 * Mobile opens the session the way `restoreSession` does: history + snapshot on
 * subscribe, then the host's replay events arrive as the first buffered batch.
 */
async function openOnMobile(session: Session) {
  const client = {
    startBuffering() {}, releaseBuffer: () => ({ epoch: 1, batches: [session.getReplayEvents()] }),
    async request(command: { type: string }) {
      if (command.type === 'subscribe_session') {
        return {
          historyPage: { messages: session.snapshot.messages, provider: 'claude', hasMore: false },
          snapshot: { status: session.getStatus() },
        }
      }
      return { ok: true }
    },
  }
  const runtime = new ChatRuntime(client as never, () => {})
  await runtime.open('/project', 'session')
  return runtime
}

describe('Session compact boundary transcript row', () => {
  it('stamps the divider id on the outbound event and keeps the same row in its snapshot', () => {
    const { session, emit, out } = fixture([msg('u1', 'user'), msg('a1', 'assistant', { status: 'streaming' })])
    emit(boundary)

    const forwarded = out.find((e) => e.type === 'compact_boundary') as Extract<AgentEvent, { type: 'compact_boundary' }>
    expect(forwarded.id).toMatch(/^compact_/)
    expect(session.snapshot.messages.map((m) => m.id)).toEqual(['u1', forwarded.id, 'a1'])
    expect((systemRows(session.snapshot.messages)[0].content[0] as { text: string }).text).toBe('__compact__:auto:120000:30000:')
  })

  it('persists the whole transcript when the divider lands mid-list, since sort_order shifts', () => {
    const { session, emit, onStateChange } = fixture([msg('u1', 'user'), msg('a1', 'assistant', { status: 'streaming' })])
    emit(boundary)

    expect(onStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ messagePersistMode: { kind: 'full' } }))
    expect(session.snapshot.messages).toHaveLength(3)
  })

  it('materialises the row once even when the same boundary is forwarded twice', () => {
    const { session, emit } = fixture([msg('u1', 'user')])
    emit({ ...boundary, id: 'compact_fixed' } as AgentEvent)
    emit({ ...boundary, id: 'compact_fixed' } as AgentEvent)

    expect(systemRows(session.snapshot.messages)).toHaveLength(1)
  })

  it('replays the compacting indicator to a subscriber that arrives mid-compaction, and stops after the boundary', () => {
    const { session, emit } = fixture([msg('u1', 'user')])
    expect(session.getReplayEvents().some((e) => e.type === 'status_indicator')).toBe(false)

    emit({ type: 'status_indicator', indicator: 'compacting' })
    expect(session.getReplayEvents()).toContainEqual(
      { type: 'status_indicator', indicator: 'compacting', sessionId: 'session', projectPath: '/project' },
    )

    emit(boundary)
    emit({ type: 'status_indicator', indicator: null, compactResult: 'success' })
    expect(session.getReplayEvents().some((e) => e.type === 'status_indicator')).toBe(false)
  })

  it('clears the replayed indicator when compaction fails', () => {
    const { session, emit } = fixture([msg('u1', 'user')])
    emit({ type: 'status_indicator', indicator: 'compacting' })
    emit({ type: 'status_indicator', indicator: null, compactResult: 'failed', compactError: 'boom' })
    expect(session.getReplayEvents().some((e) => e.type === 'status_indicator')).toBe(false)
  })
})

describe('manual /compact transcript cleanup', () => {
  async function sendCompact(session: Session, emit: (event: AgentEvent) => void) {
    const before = session.snapshot.messages.length
    const sending = session.send({ content: '/compact', assistantMessageId: 'a-compact' })
    await vi.waitFor(() => expect(session.snapshot.messages.length).toBe(before + 1))
    emit({ type: 'message_start', message: msg('a-compact', 'assistant', { status: 'streaming' }) })
    return sending
  }

  it('drops the "/compact" bubble and its blank reply, leaving the divider at the end', async () => {
    const { session, emit } = fixture([msg('u1', 'user'), msg('a1', 'assistant')])
    const sending = await sendCompact(session, emit)
    emit({ type: 'status_indicator', indicator: 'compacting' })
    emit({ ...boundary, trigger: 'manual' } as AgentEvent)
    emit({ type: 'status_indicator', indicator: null, compactResult: 'success' })
    emit({ type: 'message_complete', messageId: 'a-compact' })
    await sending

    const rows = session.snapshot.messages
    expect(rows.map((m) => m.id).slice(0, 2)).toEqual(['u1', 'a1'])
    expect(rows).toHaveLength(3)
    expect(rows[2].providerId).toBe('system')
  })

  it('keeps the bubble when compaction fails, and does not drop a later boundary\'s neighbours', async () => {
    const { session, emit } = fixture([msg('u1', 'user')])
    const sending = await sendCompact(session, emit)
    emit({ type: 'status_indicator', indicator: null, compactResult: 'failed', compactError: 'boom' })
    emit({ type: 'message_complete', messageId: 'a-compact' })
    await sending
    expect(session.snapshot.messages.map((m) => m.id)).toEqual(['u1', expect.stringMatching(/^user_/), 'a-compact'])

    emit({ type: 'message_start', message: msg('a2', 'assistant', { status: 'streaming' }) })
    emit(boundary)
    expect(session.snapshot.messages).toHaveLength(5)
  })

  it('leaves Codex alone: its "/compact" turn carries the reply', async () => {
    const { session, emit } = fixture([msg('u1', 'user')], 'codex')
    const sending = await sendCompact(session, emit)
    emit({ ...boundary, trigger: 'manual', messageId: 'a-compact' } as AgentEvent)
    await sending
    expect(session.snapshot.messages.map((m) => m.role)).toEqual(['user', 'user', 'assistant', 'assistant'])
  })
})

describe('mobile sending /compact', () => {
  // No slash_command_output here: OpenCode/dsh may not print one, and without
  // the pending id the reducer would only know to drop "the last user row".
  it('drops its own "/compact" bubble and the blank reply, ending on the same divider as main', async () => {
    const { session, emit } = fixture([msg('u1', 'user'), msg('a1', 'assistant')])
    const runtime = await openOnMobile(session)
    session.on((event) => runtime.apply(event))
    let sending: Promise<void> | undefined
    ;(runtime as unknown as { client: { send(cmd: { content: string; clientMessageId: string }): void } }).client.send = (cmd) => {
      sending = session.send({ content: cmd.content, clientMessageId: cmd.clientMessageId, assistantMessageId: 'a-compact' })
    }

    runtime.send('/compact')
    expect(runtime.messages.at(-1)?.role).toBe('user')
    await vi.waitFor(() => expect(session.snapshot.messages).toHaveLength(3))
    emit({ type: 'message_start', message: msg('a-compact', 'assistant', { status: 'streaming' }) })
    emit({ type: 'status_indicator', indicator: 'compacting' })
    emit({ ...boundary, trigger: 'manual', messageId: 'a-compact' } as AgentEvent)
    emit({ type: 'status_indicator', indicator: null, compactResult: 'success' })
    emit({ type: 'message_complete', messageId: 'a-compact' })
    await sending

    expect(runtime.messages.map((m) => m.id)).toEqual(session.snapshot.messages.map((m) => m.id))
    expect(runtime.messages.map((m) => m.providerId)).toEqual(['claude', 'claude', 'system'])
    runtime.dispose()
  })
})

describe('mobile opening a session around compaction', () => {
  it('shows the divider once when opened after compaction finished', async () => {
    const { session, emit } = fixture([msg('u1', 'user'), msg('a1', 'assistant', { status: 'streaming' })])
    emit(boundary)
    emit({ type: 'status_indicator', indicator: null, compactResult: 'success' })

    const runtime = await openOnMobile(session)
    expect(systemRows(runtime.messages)).toHaveLength(1)
    expect(runtime.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'assistant'])
    expect(runtime.session.isCompacting).toBe(false)
    runtime.dispose()
  })

  it('shows the compacting indicator when opened mid-compaction, then a single divider when it lands', async () => {
    const { session, emit } = fixture([msg('u1', 'user')])
    emit({ type: 'status_indicator', indicator: 'compacting' })

    const runtime = await openOnMobile(session)
    expect(runtime.session.isCompacting).toBe(true)
    expect(runtime.session.compactingStartedAt).not.toBeNull()

    // Live delivery after subscribe: the same tagged event mobile would receive.
    session.on((event) => runtime.apply(event))
    emit(boundary)
    expect(runtime.session.isCompacting).toBe(false)
    expect(systemRows(runtime.messages)).toHaveLength(1)
    expect(systemRows(runtime.messages)[0].id).toBe(systemRows(session.snapshot.messages)[0].id)
    runtime.dispose()
  })
})
