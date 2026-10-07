import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, ScheduledSend, ScheduledSendPatch } from '@superone/shared/agent-types'
import { createClaudeAgentEventMapper } from '@superone/claude'

/**
 * SQLite is the only thing stubbed — the row store below behaves exactly like
 * the real table (same patch-merge rule, same due predicate, same source-scoped
 * delete), so the service's real logic runs end to end.
 */
const { store, remoteTargets, sessions, hidden, transcripts } = vi.hoisted(() => ({
  store: new Map<string, ScheduledSend>(),
  /** Rows marked as remote-node sessions, with the turn options they carry. */
  remoteTargets: new Map<string, { projectKey: string; turn: unknown }>(),
  /** Sessions that have a `sessions` row — the schedule's foreign key. */
  sessions: new Set<string>(),
  /** Sessions kept out of the sidebar's list. */
  hidden: new Set<string>(),
  /** Sessions that hold a transcript, which is what "not empty" means here. */
  transcripts: new Set<string>(),
}))

vi.mock('../db-scheduled-sends', () => ({
  getScheduledSend: (sessionId: string) => store.get(sessionId) ?? null,
  getScheduledSendRemoteTarget: (sessionId: string) => (store.has(sessionId) ? remoteTargets.get(sessionId) ?? null : null),
  listDueScheduledSends: (nowMs: number) =>
    [...store.values()].filter((r) => r.armed && r.sendAt <= nowMs),
  upsertScheduledSend: (sessionId: string, patch: ScheduledSendPatch, remote?: { projectKey: string; turn?: unknown }) => {
    const prev = store.get(sessionId)
    const sendAt = patch.sendAt ?? prev?.sendAt
    if (sendAt === undefined) return null
    const target = remoteTargets.get(sessionId) ?? (remote ? { projectKey: remote.projectKey, turn: null } : undefined)
    // A local session with no row cannot hold a schedule; a remote one never has one.
    if (!target && !sessions.has(sessionId)) return null
    if (target) remoteTargets.set(sessionId, { ...target, turn: remote?.turn ?? target.turn })
    const next: ScheduledSend = {
      sessionId,
      sendAt,
      message: patch.message === undefined ? (prev?.message ?? null) : (patch.message?.trim() || null),
      armed: patch.armed ?? prev?.armed ?? false,
      source: patch.source ?? prev?.source ?? 'manual',
    }
    store.set(sessionId, next)
    return next
  },
  deleteScheduledSend: (sessionId: string) => { store.delete(sessionId); remoteTargets.delete(sessionId) },
  deleteScheduledSendBySource: (sessionId: string, source: string) => {
    if (store.get(sessionId)?.source === source) store.delete(sessionId)
  },
}))

vi.mock('../logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('./session-repo', () => ({
  insertSessionRecord: (input: { id: string; projectPath: string; isHidden?: boolean }) => {
    if (!input.projectPath) throw new Error(`Project not found for path: ${input.projectPath}`)
    sessions.add(input.id)
    if (input.isHidden) hidden.add(input.id)
  },
}))

vi.mock('../db-sessions', () => ({
  hideSession: (sessionId: string, hide: boolean) => {
    if (hide) hidden.add(sessionId)
    else hidden.delete(sessionId)
  },
  sessionHasMessages: (sessionId: string) => transcripts.has(sessionId),
}))

import { ScheduledSendService } from './scheduled-send-service'

const SID = 'sess-1'
const NOW = Date.UTC(2026, 0, 1, 12, 0, 0)
const IN_ONE_HOUR = NOW + 3_600_000
/** Offers land a minute past the reported reset, so the window is really open. */
const RESET_BUFFER_MS = 60_000

function rateLimitFailure(resetsAtSeconds?: number): AgentEvent {
  return {
    type: 'message_error',
    messageId: 'm1',
    error: 'usage limit reached',
    errorInfo: {
      raw: 'usage limit reached',
      code: 'rate_limit',
      ...(resetsAtSeconds === undefined ? {} : { resetsAt: resetsAtSeconds }),
    },
  } as AgentEvent
}

function setup() {
  const send = vi.fn(async () => undefined)
  const session = { isStreaming: () => false, send }
  const sessionManager = {
    getSession: vi.fn(() => session),
    resumeSession: vi.fn(() => session),
  }
  const broadcast = vi.fn()
  const sendRemote = vi.fn(async (input: { onAccepted: () => void }) => { input.onAccepted() })
  const service = new ScheduledSendService({
    sessionManager: sessionManager as never,
    broadcast,
    resumeDefaults: () => ({ permissionMode: 'default', sandboxMode: undefined }),
    sendRemote,
  })
  return { service, send, sendRemote, broadcast, sessionManager }
}

beforeEach(() => {
  store.clear()
  remoteTargets.clear()
  sessions.clear()
  hidden.clear()
  transcripts.clear()
  sessions.add(SID)
  transcripts.add(SID)
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('scheduled send — rate-limit offer', () => {
  it('offers a send at the reset time the failure reported', () => {
    const { service } = setup()
    service.observe(SID, rateLimitFailure(IN_ONE_HOUR / 1000))
    expect(store.get(SID)).toMatchObject({
      sendAt: IN_ONE_HOUR + RESET_BUFFER_MS,
      armed: false,
      source: 'rate_limit',
    })
  })

  it('falls back to the reset time from an earlier rate_limit event', () => {
    const { service } = setup()
    service.observe(SID, { type: 'rate_limit', resetsAt: IN_ONE_HOUR / 1000 } as AgentEvent)
    service.observe(SID, rateLimitFailure())
    expect(store.get(SID)?.sendAt).toBe(IN_ONE_HOUR + RESET_BUFFER_MS)
  })

  it('offers resume for the recorded Claude rejected-limit event sequence', () => {
    const { service } = setup()
    const mapper = createClaudeAgentEventMapper({
      messageId: 'm-recorded-rate-limit',
      emit: (event) => service.observe(SID, event),
    })

    mapper.apply({
      type: 'rate_limit_event',
      rate_limit_info: { status: 'rejected', resetsAt: IN_ONE_HOUR / 1000, rateLimitType: 'five_hour' },
    })
    mapper.apply({
      type: 'assistant',
      error: 'rate_limit',
      message: { id: 'step-rate-limit', model: '<synthetic>', content: [] },
    })
    mapper.apply({
      type: 'result',
      subtype: 'success',
      is_error: true,
      terminal_reason: 'api_error',
      api_error_status: 429,
      errors: [],
      result: "You've hit your session limit",
    })

    expect(store.get(SID)).toMatchObject({
      sendAt: IN_ONE_HOUR + RESET_BUFFER_MS,
      armed: false,
      source: 'rate_limit',
    })
  })

  it('writes no offer at all when the only reset time has already elapsed', () => {
    const { service } = setup()
    service.observe(SID, rateLimitFailure((NOW - 60_000) / 1000))
    expect(store.get(SID)).toBeUndefined()
  })

  it('drops the offer when the same session fails for an unrelated reason', () => {
    const { service } = setup()
    service.observe(SID, rateLimitFailure(IN_ONE_HOUR / 1000))
    service.observe(SID, {
      type: 'message_error',
      messageId: 'm2',
      error: 'boom',
      errorInfo: { raw: 'boom', code: 'server_error' },
    } as AgentEvent)
    expect(store.get(SID)).toBeUndefined()
  })

  it('drops the offer once a turn completes', () => {
    const { service } = setup()
    service.observe(SID, rateLimitFailure(IN_ONE_HOUR / 1000))
    service.observe(SID, { type: 'message_complete', messageId: 'm1' } as AgentEvent)
    expect(store.get(SID)).toBeUndefined()
  })

  it('survives a transcript-only bubble that never reached the model', () => {
    const { service } = setup()
    service.observe(SID, rateLimitFailure(IN_ONE_HOUR / 1000))

    // `appendTranscriptMessage` raises this for a collab mailbox bubble, which
    // is not a turn — retiring the offer on it would answer a question nobody
    // asked.
    service.observe(SID, { type: 'user_message_appended', message: { id: 'm9' } } as unknown as AgentEvent)

    expect(store.get(SID)).toMatchObject({ source: 'rate_limit', armed: false })
  })

  it('retires the offer when the session switches to another provider', () => {
    const { service } = setup()
    service.observe(SID, rateLimitFailure(IN_ONE_HOUR / 1000))

    service.observe(SID, {
      type: 'agent_setting_change',
      patch: { apiProviderId: 'other-credential' },
    } as unknown as AgentEvent)

    // A different credential is a different quota, and this is the composer's
    // only way out of an offer it is otherwise blocked behind.
    expect(store.get(SID)).toBeUndefined()
  })

  it('keeps an armed rate-limit send across provider changes, turn completion and other errors', () => {
    const { service } = setup()
    service.observe(SID, rateLimitFailure(IN_ONE_HOUR / 1000))
    service.set(SID, { armed: true, message: 'continue later' })

    service.observe(SID, {
      type: 'agent_setting_change',
      patch: { apiProviderId: 'another-credential' },
    } as AgentEvent)
    service.observe(SID, { type: 'message_complete', messageId: 'm2' } as AgentEvent)
    service.observe(SID, {
      type: 'message_error', messageId: 'm3', error: 'other failure',
      errorInfo: { raw: 'other failure', code: 'server_error' },
    } as AgentEvent)
    service.observe(SID, rateLimitFailure((IN_ONE_HOUR + 3_600_000) / 1000))

    expect(store.get(SID)).toMatchObject({
      armed: true,
      source: 'rate_limit',
      sendAt: IN_ONE_HOUR + RESET_BUFFER_MS,
      message: 'continue later',
    })
  })

  it('keeps an armed offer when reopening the session replays its saved provider', () => {
    const { service } = setup()
    service.observe(SID, rateLimitFailure(IN_ONE_HOUR / 1000))
    service.set(SID, { armed: true })

    service.observe(SID, {
      type: 'agent_setting_change',
      patch: { apiProviderId: 'saved-credential' },
    } as AgentEvent, true)

    expect(store.get(SID)).toMatchObject({ armed: true, source: 'rate_limit' })
  })

  it('keeps the offer when only the model changed inside the same provider', () => {
    const { service } = setup()
    service.observe(SID, rateLimitFailure(IN_ONE_HOUR / 1000))

    service.observe(SID, {
      type: 'agent_setting_change',
      patch: { model: 'claude-opus-5' },
    } as unknown as AgentEvent)

    expect(store.get(SID)).toMatchObject({ source: 'rate_limit' })
  })

  it('leaves a hand-made schedule alone when a rate limit wants the same slot', () => {
    const { service } = setup()
    service.set(SID, { sendAt: IN_ONE_HOUR, armed: true, message: 'run the tests', source: 'manual' })

    service.observe(SID, rateLimitFailure((IN_ONE_HOUR + 3_600_000) / 1000))

    // Re-sourcing it to `rate_limit` would hand it to `clearStallOffer`, which
    // would delete it on the next completed turn as if it had been an offer.
    expect(store.get(SID)).toMatchObject({
      sendAt: IN_ONE_HOUR,
      message: 'run the tests',
      source: 'manual',
      armed: true,
    })
  })

  it('leaves a hand-made schedule alone when an unrelated turn completes', () => {
    const { service } = setup()
    service.set(SID, { sendAt: IN_ONE_HOUR, armed: true, message: 'run the tests', source: 'manual' })
    service.observe(SID, { type: 'message_complete', messageId: 'm1' } as AgentEvent)
    expect(store.get(SID)).toMatchObject({ armed: true, message: 'run the tests' })
  })
})

describe('scheduled send — a session that has never been sent in', () => {
  const FRESH = 'sess-fresh'
  const init = { projectPath: '/proj', harnessId: 'claude' as const }

  it('persists the session so arming from a fresh composer takes', () => {
    const { service, broadcast } = setup()
    const next = service.set(FRESH, { armed: true, sendAt: IN_ONE_HOUR, message: 'ping' }, init)
    expect(next).toMatchObject({ sendAt: IN_ONE_HOUR, armed: true, message: 'ping' })
    expect(broadcast).toHaveBeenCalledWith(FRESH, next, false)
  })

  it('keeps the session out of the sidebar until the send actually goes out', async () => {
    const { service } = setup()
    service.set(FRESH, { armed: true, sendAt: IN_ONE_HOUR, message: 'ping' }, init)
    // The composer it mirrors is already on screen as a draft; an empty
    // "Untitled" row beside it would be the same pending message drawn twice.
    expect(hidden.has(FRESH)).toBe(true)

    vi.setSystemTime(IN_ONE_HOUR + 1)
    service.start()
    await vi.waitFor(() => expect(hidden.has(FRESH)).toBe(false))
    service.stop()
  })

  it('leaves a session the user hid alone when its scheduled send fires', async () => {
    const { service, send } = setup()
    hidden.add(SID)
    service.set(SID, { armed: true, sendAt: IN_ONE_HOUR, message: 'ping' })

    vi.setSystemTime(IN_ONE_HOUR + 1)
    service.start()
    await vi.waitFor(() => expect(send).toHaveBeenCalled())
    service.stop()

    // SID has a transcript, so it cannot be a row this service invented — the
    // user hid a real conversation, and a scheduled send is no reason to
    // overrule that.
    expect(hidden.has(SID)).toBe(true)
  })

  it('leaves the session unwritten when the schedule is only being offered, not armed', () => {
    const { service } = setup()
    expect(service.set(FRESH, { sendAt: IN_ONE_HOUR }, init)).toBeNull()
    expect(sessions.has(FRESH)).toBe(false)
  })

  it('reports nothing queued when the session cannot be persisted', () => {
    const { service, broadcast } = setup()
    const next = service.set(FRESH, { armed: true, sendAt: IN_ONE_HOUR }, { ...init, projectPath: '' })
    expect(next).toBeNull()
    expect(broadcast).toHaveBeenCalledWith(FRESH, null, false)
  })
})

describe('scheduled send — a time that has already passed', () => {
  const PAST = NOW - 60_000

  it('refuses to arm a hand-made schedule behind the clock', () => {
    const { service, broadcast } = setup()

    // Armed in the past means due on arrival: it would go out on the very next
    // poll, which is the surprise scheduling exists to avoid.
    expect(service.set(SID, { armed: true, sendAt: PAST, message: 'ping' })).toBeNull()
    expect(store.get(SID)).toBeUndefined()
    expect(broadcast).toHaveBeenCalledWith(SID, null, false)
  })

  it('still accepts a rate-limit offer whose reset has already come round', async () => {
    const { service, send } = setup()
    service.observe(SID, rateLimitFailure(IN_ONE_HOUR / 1000))
    // The user walked away and came back after the window reopened. That time
    // is a gate, not a plan — it is open now, so accepting means "go".
    vi.setSystemTime(IN_ONE_HOUR + 2 * RESET_BUFFER_MS)
    service.set(SID, { armed: true, message: 'finish the migration' })

    expect(store.get(SID)?.armed).toBe(true)
    service.start()
    await vi.waitFor(() => expect(send).toHaveBeenCalled())
    service.stop()
  })

  it('leaves an already-armed row alone once its time has come round', () => {
    const { service } = setup()
    service.set(SID, { armed: true, sendAt: IN_ONE_HOUR, message: 'ping' })

    // Between falling due and being delivered — and for every retry of a send
    // that failed — an armed row legitimately sits behind the clock. A mirror
    // write must not be refused for it.
    vi.setSystemTime(IN_ONE_HOUR + 1)
    service.set(SID, { message: 'edited after it fell due' })
    expect(store.get(SID)?.message).toBe('edited after it fell due')

    service.set(SID, { armed: true })
    expect(store.get(SID)?.armed).toBe(true)
  })
})

describe('scheduled send — delivery', () => {
  it('sends the default continue prompt once the due time has passed', async () => {
    const { service, send } = setup()
    service.observe(SID, rateLimitFailure(IN_ONE_HOUR / 1000))
    service.set(SID, { armed: true })

    vi.setSystemTime(IN_ONE_HOUR + 2 * RESET_BUFFER_MS)
    service.start()
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith(expect.objectContaining({ content: 'Continue' })))
    service.stop()
  })

  it('sends the user-typed message verbatim', async () => {
    const { service, send } = setup()
    service.observe(SID, rateLimitFailure(IN_ONE_HOUR / 1000))
    service.set(SID, { armed: true, message: 'finish the migration' })

    vi.setSystemTime(IN_ONE_HOUR + 2 * RESET_BUFFER_MS)
    service.start()
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith(expect.objectContaining({ content: 'finish the migration' })))
    service.stop()
  })

  it('places a rate-limit offer past the reset rather than on it', () => {
    const { service } = setup()
    service.observe(SID, rateLimitFailure(IN_ONE_HOUR / 1000))
    service.set(SID, { armed: true })

    // Exactly at the reported reset the quota may not have turned over yet.
    vi.setSystemTime(IN_ONE_HOUR)
    expect(store.get(SID)!.sendAt).toBeGreaterThan(Date.now())
  })

  it('keeps a queued send when the session cannot be resolved right now', async () => {
    const { service, send, sessionManager } = setup()
    service.set(SID, { sendAt: IN_ONE_HOUR, armed: true, message: 'run the tests', source: 'manual' })
    sessionManager.getSession.mockReturnValue(undefined as never)
    sessionManager.resumeSession.mockImplementation(() => { throw new Error('db busy') })

    vi.setSystemTime(IN_ONE_HOUR + 2 * RESET_BUFFER_MS)
    service.start()
    await vi.waitFor(() => expect(sessionManager.resumeSession).toHaveBeenCalled())
    service.stop()

    // A deleted session cannot leave a row behind — the table cascades with it —
    // so a failure to resolve one is transient, and dropping the row would throw
    // away a promise the user made.
    expect(send).not.toHaveBeenCalled()
    expect(store.get(SID)).toMatchObject({ armed: true, message: 'run the tests' })
  })

  it('waits for a busy session without cancelling its rate-limit send', async () => {
    const { service, send, sessionManager } = setup()
    service.observe(SID, rateLimitFailure(IN_ONE_HOUR / 1000))
    service.set(SID, { armed: true })
    sessionManager.getSession.mockReturnValue({ isStreaming: () => true, send } as never)

    vi.setSystemTime(IN_ONE_HOUR + 2 * RESET_BUFFER_MS)
    service.start()
    await vi.advanceTimersByTimeAsync(30_000)
    service.stop()

    expect(send).not.toHaveBeenCalled()
    expect(store.get(SID)).toMatchObject({ armed: true, source: 'rate_limit' })
  })

  it('re-reads the row before sending, so a cancel in the window still counts', async () => {
    const { service, send } = setup()
    service.set(SID, { sendAt: IN_ONE_HOUR, armed: true, message: 'run the tests', source: 'manual' })
    vi.setSystemTime(IN_ONE_HOUR + 2 * RESET_BUFFER_MS)

    // Cancelled between the due query and the send.
    service.set(SID, { armed: false })
    service.start()
    await Promise.resolve()
    service.stop()

    expect(send).not.toHaveBeenCalled()
  })

  it('never fires before the due time', async () => {
    const { service, send } = setup()
    service.set(SID, { sendAt: IN_ONE_HOUR, armed: true, source: 'manual' })

    service.start()
    await Promise.resolve()
    expect(send).not.toHaveBeenCalled()
    service.stop()
  })

  it('leaves a re-timed schedule alone when the re-time lands during the send', async () => {
    const { service, send } = setup()
    service.set(SID, { sendAt: IN_ONE_HOUR, armed: true, message: 'run the tests', source: 'manual' })
    const laterSlot = IN_ONE_HOUR + 7_200_000
    // `Session.send` awaits the whole turn, so a re-time can land inside it.
    send.mockImplementation(async () => { service.set(SID, { sendAt: laterSlot }) })

    vi.setSystemTime(IN_ONE_HOUR + 2 * RESET_BUFFER_MS)
    service.start()
    await vi.waitFor(() => expect(send).toHaveBeenCalled())
    service.stop()

    expect(store.get(SID)).toMatchObject({ sendAt: laterSlot, armed: true })
  })

  it('reports delivery on provider output, not the local append or optimistic start', async () => {
    const { service, send, broadcast } = setup()
    service.set(SID, { sendAt: IN_ONE_HOUR, armed: true, message: 'run the tests', source: 'manual' })
    send.mockImplementation(async () => {
      service.observe(SID, { type: 'user_message_appended', message: { id: 'm1' } } as unknown as AgentEvent)
      service.observe(SID, { type: 'message_start', message: { id: 'm1' } } as AgentEvent)
      expect(store.get(SID)).toMatchObject({ armed: true })
      expect(broadcast.mock.calls.every((call) => call[2] === false)).toBe(true)
      service.observe(SID, { type: 'stream_message_start', messageId: 'm1' } as AgentEvent)
    })

    vi.setSystemTime(IN_ONE_HOUR + 2 * RESET_BUFFER_MS)
    service.start()
    await vi.waitFor(() => expect(broadcast.mock.calls.some((c) => c[2] === true)).toBe(true))
    service.stop()
  })

  it('never reports delivery for a send that failed before reaching the transcript', async () => {
    const { service, send, broadcast } = setup()
    service.set(SID, { sendAt: IN_ONE_HOUR, armed: true, message: 'run the tests', source: 'manual' })
    send.mockRejectedValue(new Error('runtime release failed'))

    vi.setSystemTime(IN_ONE_HOUR + 2 * RESET_BUFFER_MS)
    service.start()
    await vi.waitFor(() => expect(send).toHaveBeenCalled())
    service.stop()

    // Clearing the composer here would drop a draft nothing ever sent.
    expect(broadcast.mock.calls.every((c) => c[2] === false)).toBe(true)
  })

  it('retries the same send after startup fails following the local append', async () => {
    const { service, send, broadcast } = setup()
    service.set(SID, { sendAt: IN_ONE_HOUR, armed: true, message: 'run the tests', source: 'manual' })
    send.mockImplementationOnce(async () => {
      service.observe(SID, { type: 'user_message_appended', message: { id: 'm1' } } as unknown as AgentEvent)
      throw new Error('backend start failed')
    })
    send.mockImplementationOnce(async () => {
      service.observe(SID, { type: 'content_delta', messageId: 'm2' } as AgentEvent)
    })

    vi.setSystemTime(IN_ONE_HOUR + 2 * RESET_BUFFER_MS)
    service.start()
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(store.get(SID)).toMatchObject({ armed: true, message: 'run the tests' })
    expect(broadcast.mock.calls.every((call) => call[2] === false)).toBe(true)

    await vi.advanceTimersByTimeAsync(30_000)
    service.stop()
    expect(send).toHaveBeenCalledTimes(2)
    expect((send.mock.calls[1][0] as { clientMessageId: string }).clientMessageId)
      .toBe((send.mock.calls[0][0] as { clientMessageId: string }).clientMessageId)
    expect(store.get(SID)).toBeUndefined()
  })

  it('does not retire a send that returns without provider output or completion', async () => {
    const { service, send } = setup()
    service.set(SID, { sendAt: IN_ONE_HOUR, armed: true, message: 'run the tests', source: 'manual' })

    vi.setSystemTime(IN_ONE_HOUR + 2 * RESET_BUFFER_MS)
    service.start()
    await vi.waitFor(() => expect(send).toHaveBeenCalled())
    service.stop()

    expect(store.get(SID)).toMatchObject({ armed: true, message: 'run the tests' })
  })

  it('keeps retrying when a session cannot be resolved', async () => {
    const { service, send, sessionManager } = setup()
    service.set(SID, { sendAt: IN_ONE_HOUR, armed: true, message: 'run the tests', source: 'manual' })
    sessionManager.getSession.mockReturnValue(undefined as never)
    sessionManager.resumeSession.mockImplementation(() => { throw new Error('SessionProvider not found') })

    vi.setSystemTime(IN_ONE_HOUR + 2 * RESET_BUFFER_MS)
    service.start()
    for (let i = 0; i < 12; i++) await vi.advanceTimersByTimeAsync(30_000)
    service.stop()

    expect(send).not.toHaveBeenCalled()
    expect(store.get(SID)).toMatchObject({ armed: true, message: 'run the tests' })
  })

  it('spends a hand-made schedule on delivery instead of leaving it queued', async () => {
    const { service, send } = setup()
    service.set(SID, { sendAt: IN_ONE_HOUR, armed: true, message: 'run the tests', source: 'manual' })
    send.mockImplementation(async () => {
      service.observe(SID, { type: 'user_message_appended', message: { id: 'm1' } } as unknown as AgentEvent)
      service.observe(SID, { type: 'message_complete', messageId: 'm1' } as AgentEvent)
    })

    vi.setSystemTime(IN_ONE_HOUR + 2 * RESET_BUFFER_MS)
    service.start()
    await vi.waitFor(() => expect(send).toHaveBeenCalled())
    await vi.waitFor(() => expect(store.get(SID)).toBeUndefined())
    service.stop()
  })

  it('keeps a rate-limit row after the local append until the provider responds', async () => {
    const { service, send } = setup()
    service.observe(SID, rateLimitFailure(IN_ONE_HOUR / 1000))
    service.set(SID, { armed: true, message: 'finish the migration' })

    let rowAfterAppend: ScheduledSend | undefined
    send.mockImplementation(async () => {
      service.observe(SID, { type: 'user_message_appended', message: { id: 'm1' } } as unknown as AgentEvent)
      rowAfterAppend = store.get(SID)
      service.observe(SID, { type: 'content_delta', messageId: 'm1' } as AgentEvent)
    })

    vi.setSystemTime(IN_ONE_HOUR + 2 * RESET_BUFFER_MS)
    service.start()
    await vi.waitFor(() => expect(send).toHaveBeenCalled())
    service.stop()

    expect(rowAfterAppend).toMatchObject({ armed: true })
    expect(store.get(SID)).toBeUndefined()
  })

  it('re-arms after a rate limit even when the local message was appended', async () => {
    const { service, send } = setup()
    service.observe(SID, rateLimitFailure(IN_ONE_HOUR / 1000))
    service.set(SID, { armed: true, message: 'finish the migration' })

    const later = IN_ONE_HOUR + 3_600_000
    send.mockImplementation(async () => {
      service.observe(SID, { type: 'user_message_appended', message: { id: 'm1' } } as unknown as AgentEvent)
      service.observe(SID, rateLimitFailure(later / 1000))
    })

    vi.setSystemTime(IN_ONE_HOUR + 2 * RESET_BUFFER_MS)
    service.start()
    await vi.waitFor(() => expect(send).toHaveBeenCalled())
    await vi.waitFor(() =>
      expect(store.get(SID)).toMatchObject({
        armed: true,
        message: 'finish the migration',
        sendAt: later + RESET_BUFFER_MS,
      }),
    )
    service.stop()
  })

  it('keeps the re-armed row when the resumed turn rate-limits inside the send', async () => {
    const { service, send } = setup()
    service.observe(SID, rateLimitFailure(IN_ONE_HOUR / 1000))
    service.set(SID, { armed: true, message: 'finish the migration' })

    const later = IN_ONE_HOUR + 3_600_000
    // The real ordering: `Session.send` awaits the whole turn, so the failure —
    // and the offer it re-arms — happen *inside* the await, not after it. A test
    // that observes afterwards cannot catch a retire that deletes the new row.
    send.mockImplementation(async () => {
      service.observe(SID, rateLimitFailure(later / 1000))
    })

    vi.setSystemTime(IN_ONE_HOUR + 2 * RESET_BUFFER_MS)
    service.start()
    await vi.waitFor(() => expect(send).toHaveBeenCalled())
    await vi.waitFor(() =>
      expect(store.get(SID)).toMatchObject({
        armed: true,
        message: 'finish the migration',
        sendAt: later + RESET_BUFFER_MS,
      }),
    )
    service.stop()
  })

  it('keeps a rate-limit send armed if its account changes during delivery', async () => {
    const { service, send } = setup()
    service.observe(SID, rateLimitFailure(IN_ONE_HOUR / 1000))
    service.set(SID, { armed: true, message: 'continue later' })
    const later = IN_ONE_HOUR + 3_600_000
    send.mockImplementation(async () => {
      service.observe(SID, {
        type: 'agent_setting_change', patch: { apiProviderId: 'another-credential' },
      } as AgentEvent)
      service.observe(SID, rateLimitFailure(later / 1000))
    })

    vi.setSystemTime(IN_ONE_HOUR + 2 * RESET_BUFFER_MS)
    service.start()
    await vi.waitFor(() => expect(send).toHaveBeenCalled())
    service.stop()

    expect(store.get(SID)).toMatchObject({
      armed: true, message: 'continue later', sendAt: later + RESET_BUFFER_MS,
    })
  })

  it('does not append a second transcript bubble when a send is retried', async () => {
    const { service, send } = setup()
    service.set(SID, { sendAt: IN_ONE_HOUR, armed: true, message: 'run the tests', source: 'manual' })
    send.mockRejectedValue(new Error('backend start failed'))

    vi.setSystemTime(IN_ONE_HOUR + 2 * RESET_BUFFER_MS)
    service.start()
    await vi.waitFor(() => expect(send).toHaveBeenCalled())
    const first = send.mock.calls[0][0] as { clientMessageId?: string }
    service.stop()

    // The bubble is appended before the backend can fail, so the retry has to
    // carry the same id or every poll leaves another copy in the transcript.
    expect(first.clientMessageId).toBeTruthy()
    expect(store.get(SID)).toMatchObject({ armed: true })
  })

  it('does not re-time an armed send for a later rate-limit event outside its delivery', async () => {
    const { service, send } = setup()
    service.observe(SID, rateLimitFailure(IN_ONE_HOUR / 1000))
    service.set(SID, { armed: true, message: 'finish the migration' })

    vi.setSystemTime(IN_ONE_HOUR + 2 * RESET_BUFFER_MS)
    service.start()
    await vi.waitFor(() => expect(send).toHaveBeenCalled())

    const later = IN_ONE_HOUR + 3_600_000
    service.observe(SID, rateLimitFailure(later / 1000))
    expect(store.get(SID)).toMatchObject({
      armed: true,
      message: 'finish the migration',
      sendAt: IN_ONE_HOUR + RESET_BUFFER_MS,
    })
    service.stop()
  })

  it('disarming after an auto-resume stops it re-arming itself', async () => {
    const { service, send } = setup()
    service.observe(SID, rateLimitFailure(IN_ONE_HOUR / 1000))
    service.set(SID, { armed: true })

    vi.setSystemTime(IN_ONE_HOUR + 2 * RESET_BUFFER_MS)
    service.start()
    await vi.waitFor(() => expect(send).toHaveBeenCalled())
    service.set(SID, { armed: false })

    const later = IN_ONE_HOUR + 3_600_000
    service.observe(SID, rateLimitFailure(later / 1000))
    expect(store.get(SID)?.armed).toBe(false)
    service.stop()
  })
})

describe('scheduled send — remote-node session', () => {
  const NODE_SID = 'node-sess-1'
  const REMOTE_KEY = 'remote:conn-1:/srv/app'
  const TURN = { providerId: 'claude', model: 'opus', permissionMode: 'acceptEdits' }
  const remoteInit = { projectPath: REMOTE_KEY, harnessId: 'claude' as const, remoteTurn: TURN }

  function remoteRateLimit(resetsAtSeconds: number): AgentEvent {
    return { ...rateLimitFailure(resetsAtSeconds), sessionId: NODE_SID, projectPath: REMOTE_KEY }
  }

  it('arms without a local session row and sends through the node', async () => {
    const { service, send, sendRemote, broadcast, sessionManager } = setup()
    service.set(NODE_SID, { armed: true, sendAt: IN_ONE_HOUR, message: 'ship it' }, remoteInit)
    expect(sessions.has(NODE_SID)).toBe(false)

    vi.setSystemTime(IN_ONE_HOUR)
    service.start()
    await vi.waitFor(() => expect(sendRemote).toHaveBeenCalled())

    expect(sendRemote).toHaveBeenCalledWith(expect.objectContaining({
      target: { projectKey: REMOTE_KEY, turn: TURN },
      sessionId: NODE_SID,
      text: 'ship it',
      clientMessageId: `scheduled-send:${NODE_SID}:${IN_ONE_HOUR}`,
    }))
    expect(send).not.toHaveBeenCalled()
    expect(sessionManager.resumeSession).not.toHaveBeenCalled()
    // Accepted by the node is delivered: the composer that mirrored it may empty.
    expect(store.has(NODE_SID)).toBe(false)
    expect(broadcast).toHaveBeenLastCalledWith(NODE_SID, null, true)
    service.stop()
  })

  it('offers a resume when a remote turn hits a rate limit, and delivers it remotely', async () => {
    const { service, sendRemote } = setup()
    service.observe(NODE_SID, remoteRateLimit(IN_ONE_HOUR / 1000))
    expect(store.get(NODE_SID)).toMatchObject({ armed: false, source: 'rate_limit' })

    service.set(NODE_SID, { armed: true }, remoteInit)
    vi.setSystemTime(IN_ONE_HOUR + RESET_BUFFER_MS)
    service.start()
    await vi.waitFor(() => expect(sendRemote).toHaveBeenCalled())
    expect(sendRemote.mock.calls[0]![0]).toMatchObject({ target: { projectKey: REMOTE_KEY, turn: TURN } })

    // The resumed turn limits again: the user's consent carries the chain on.
    const later = IN_ONE_HOUR + 3_600_000
    service.observe(NODE_SID, remoteRateLimit(later / 1000))
    expect(store.get(NODE_SID)).toMatchObject({ armed: true, sendAt: later + RESET_BUFFER_MS })
    expect(remoteTargets.get(NODE_SID)).toEqual({ projectKey: REMOTE_KEY, turn: TURN })
    vi.setSystemTime(later + RESET_BUFFER_MS)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(sendRemote).toHaveBeenCalledTimes(2)
    expect(sendRemote.mock.calls[1]![0]).toMatchObject({ target: { projectKey: REMOTE_KEY, turn: TURN } })
    service.stop()
  })

  it('keeps the send armed when the node is unreachable', async () => {
    const { service, sendRemote } = setup()
    sendRemote.mockRejectedValueOnce(Object.assign(new Error('not connected'), { code: 'unavailable' }))
    service.set(NODE_SID, { armed: true, sendAt: IN_ONE_HOUR }, remoteInit)

    vi.setSystemTime(IN_ONE_HOUR)
    service.start()
    await vi.waitFor(() => expect(sendRemote).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(store.get(NODE_SID)?.armed).toBe(true))

    await vi.advanceTimersByTimeAsync(30_000)
    expect(sendRemote).toHaveBeenCalledTimes(2)
    expect(store.has(NODE_SID)).toBe(false)
    service.stop()
  })

  it('treats a conflict with a durable successful receipt as delivered', async () => {
    const { service, sendRemote, broadcast } = setup()
    sendRemote.mockRejectedValueOnce(Object.assign(new Error('reused'), { code: 'idempotency_conflict', details: { receiptStored: true } }))
    service.set(NODE_SID, { armed: true, sendAt: IN_ONE_HOUR }, remoteInit)

    vi.setSystemTime(IN_ONE_HOUR)
    service.start()
    await vi.waitFor(() => expect(store.has(NODE_SID)).toBe(false))
    expect(broadcast).toHaveBeenLastCalledWith(NODE_SID, null, true)
    service.stop()
  })

  it.each([undefined, { receiptStored: false }])('retains a conflicting send without a successful receipt (%j)', async (details) => {
    const { service, sendRemote, broadcast } = setup()
    sendRemote.mockRejectedValueOnce(Object.assign(new Error('request still pending'), { code: 'idempotency_conflict', details }))
    service.set(NODE_SID, { armed: true, sendAt: IN_ONE_HOUR }, remoteInit)
    vi.setSystemTime(IN_ONE_HOUR)
    service.start()
    await vi.waitFor(() => expect(sendRemote).toHaveBeenCalledTimes(1))
    expect(store.get(NODE_SID)?.armed).toBe(true)
    expect(broadcast).not.toHaveBeenCalledWith(NODE_SID, null, true)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(sendRemote).toHaveBeenCalledTimes(2)
    expect(store.has(NODE_SID)).toBe(false)
    service.stop()
  })

  it('drops the send once the session is gone from the node', async () => {
    const { service, sendRemote, broadcast } = setup()
    sendRemote.mockRejectedValueOnce(Object.assign(new Error('session not found'), { code: 'not_found' }))
    service.set(NODE_SID, { armed: true, sendAt: IN_ONE_HOUR }, remoteInit)

    vi.setSystemTime(IN_ONE_HOUR)
    service.start()
    await vi.waitFor(() => expect(store.has(NODE_SID)).toBe(false))
    expect(broadcast).toHaveBeenLastCalledWith(NODE_SID, null, false)
    service.stop()
  })
})
