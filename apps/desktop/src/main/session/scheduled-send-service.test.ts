import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, ScheduledSend, ScheduledSendPatch } from '@superone/shared/agent-types'

/**
 * SQLite is the only thing stubbed — the row store below behaves exactly like
 * the real table (same patch-merge rule, same due predicate, same source-scoped
 * delete), so the service's real logic runs end to end.
 */
const { store, sessions, hidden, transcripts } = vi.hoisted(() => ({
  store: new Map<string, ScheduledSend>(),
  /** Sessions that have a `sessions` row — the schedule's foreign key. */
  sessions: new Set<string>(),
  /** Sessions kept out of the sidebar's list. */
  hidden: new Set<string>(),
  /** Sessions that hold a transcript, which is what "not empty" means here. */
  transcripts: new Set<string>(),
}))

vi.mock('../db-scheduled-sends', () => ({
  getScheduledSend: (sessionId: string) => store.get(sessionId) ?? null,
  listDueScheduledSends: (nowMs: number) =>
    [...store.values()].filter((r) => r.armed && r.sendAt <= nowMs),
  upsertScheduledSend: (sessionId: string, patch: ScheduledSendPatch) => {
    // The real table's foreign key: a session with no row cannot hold a schedule.
    if (!sessions.has(sessionId)) return null
    const prev = store.get(sessionId)
    const sendAt = patch.sendAt ?? prev?.sendAt
    if (sendAt === undefined) return null
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
  deleteScheduledSend: (sessionId: string) => { store.delete(sessionId) },
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
  const service = new ScheduledSendService({
    sessionManager: sessionManager as never,
    broadcast,
    resumeDefaults: () => ({ permissionMode: 'default', sandboxMode: undefined }),
  })
  return { service, send, broadcast, sessionManager }
}

beforeEach(() => {
  store.clear()
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

  it('reports delivery on the append that carries the text, not on any other change', async () => {
    const { service, send, broadcast } = setup()
    service.set(SID, { sendAt: IN_ONE_HOUR, armed: true, message: 'run the tests', source: 'manual' })
    send.mockImplementation(async () => {
      service.observe(SID, { type: 'user_message_appended', message: { id: 'm1' } } as unknown as AgentEvent)
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

  it('disarms instead of retrying forever when a session can never be resolved', async () => {
    const { service, send, sessionManager } = setup()
    service.set(SID, { sendAt: IN_ONE_HOUR, armed: true, message: 'run the tests', source: 'manual' })
    sessionManager.getSession.mockReturnValue(undefined as never)
    sessionManager.resumeSession.mockImplementation(() => { throw new Error('SessionProvider not found') })

    vi.setSystemTime(IN_ONE_HOUR + 2 * RESET_BUFFER_MS)
    service.start()
    for (let i = 0; i < 12; i++) await vi.advanceTimersByTimeAsync(30_000)
    service.stop()

    expect(send).not.toHaveBeenCalled()
    // Disarmed, not deleted — the promise stays visible so the user can see it
    // did not fire.
    expect(store.get(SID)).toMatchObject({ armed: false, message: 'run the tests' })
  })

  it('spends a hand-made schedule on delivery instead of leaving it queued', async () => {
    const { service, send } = setup()
    service.set(SID, { sendAt: IN_ONE_HOUR, armed: true, message: 'run the tests', source: 'manual' })

    vi.setSystemTime(IN_ONE_HOUR + 2 * RESET_BUFFER_MS)
    service.start()
    await vi.waitFor(() => expect(send).toHaveBeenCalled())
    await vi.waitFor(() => expect(store.get(SID)).toBeUndefined())
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

  it('stays armed when the auto-resumed turn rate-limits again', async () => {
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
      sendAt: later + RESET_BUFFER_MS,
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
