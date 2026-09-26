import { isRateLimitErrorInfo } from '@superone/shared/agent-error'
import {
  SCHEDULED_SEND_DEFAULT_MESSAGE,
  type AgentEvent,
  type PermissionMode,
  type SandboxMode,
  type ScheduledSend,
  type ScheduledSendPatch,
  type ScheduledSendSessionInit,
} from '@superone/shared/agent-types'
import { baseSessionProviderId } from '@superone/shared/session-provider-definitions'
import log from '../logger'
import {
  deleteScheduledSend,
  deleteScheduledSendBySource,
  getScheduledSend,
  listDueScheduledSends,
  listScheduledSends,
  upsertScheduledSend,
} from '../db-scheduled-sends'
import { hideSession, sessionHasMessages } from '../db-sessions'
import { insertSessionRecord } from './session-repo'
import type { SessionManagerImpl } from './session-manager'

/**
 * Poll cadence for due sends. The case this exists for — waiting out a quota
 * window — is measured in hours, so a one-shot `setTimeout` would buy nothing
 * and would still have to be rebuilt on every launch. A poll is both simpler and
 * the only thing that survives a restart, which is the point of the feature.
 */
const POLL_INTERVAL_MS = 30_000

/**
 * How far past a provider's `resetsAt` a rate-limit offer is placed.
 *
 * The quota clock and the local clock are never exactly aligned, and `resetsAt`
 * is the *start* of the new window — firing on it re-fails the turn and burns
 * the user's opt-in. The buffer is baked into the offered time rather than
 * applied at delivery so the time shown is the time it happens; a control that
 * says 20:37 and fires at 20:38 is lying about the only fact it exists to tell.
 */
const RESET_BUFFER_MS = 60_000

export interface ScheduledSendDeps {
  sessionManager: SessionManagerImpl
  /**
   * Push the row (or its removal) to every renderer. `delivered` marks the one
   * removal that means "this went out", as opposed to cancelled or superseded —
   * the composer mirrors the queued text, so only that case may empty it.
   */
  broadcast: (sessionId: string, scheduled: ScheduledSend | null, delivered: boolean) => void
  /** Session prefs used when the send has to load a session that is not in memory. */
  resumeDefaults: () => { permissionMode: PermissionMode; sandboxMode: SandboxMode | undefined }
}

/**
 * Owns "send this message at that time" for a session.
 *
 * Two halves that deliberately do not know about each other:
 * - **observe** turns a provider rate limit into a pre-filled, unarmed offer (the
 *   composer's only source of truth, in main so a reload or restart cannot lose
 *   it);
 * - **poll** delivers rows the user armed, whatever put them there.
 *
 * No backend or harness learns about any of this — everything it needs is
 * already on the session event stream.
 */
export class ScheduledSendService {
  private poll: ReturnType<typeof setInterval> | null = null
  /** Sends in flight — a slow send must not be started twice by the next tick. */
  private readonly sending = new Set<string>()
  /**
   * Sessions whose current turn *is* an auto-resume. If that turn rate-limits
   * again the fresh offer re-arms itself with the same message instead of
   * silently reverting to "ask the user again" — which would defeat the point
   * for anyone who armed it and walked away.
   */
  private readonly autoRearm = new Map<string, string | null>()
  /** Latest `resetsAt` (epoch ms) seen per session, as a fallback when the failure carries none. */
  private readonly lastResetsAt = new Map<string, number>()
  /** Due time of each send awaiting evidence that the provider received it. */
  private readonly delivering = new Map<string, number>()
  /** Consecutive resolve failures per session, for diagnostic logging. */
  private readonly resolveFailures = new Map<string, number>()

  constructor(private readonly deps: ScheduledSendDeps) {}

  private emit(sessionId: string, scheduled: ScheduledSend | null): void {
    this.deps.broadcast(sessionId, scheduled, false)
  }

  start(): void {
    if (this.poll) return
    this.poll = setInterval(() => this.flushDue(), POLL_INTERVAL_MS)
    // Catch up on anything that came due while the app was closed.
    this.flushDue()
  }

  stop(): void {
    if (this.poll) clearInterval(this.poll)
    this.poll = null
    this.sending.clear()
    this.autoRearm.clear()
    this.lastResetsAt.clear()
    this.delivering.clear()
    this.resolveFailures.clear()
  }

  get(sessionId: string): ScheduledSend | null {
    return getScheduledSend(sessionId)
  }

  /** Every queued send, so the sidebar can mark and order the sessions holding one. */
  list(): ScheduledSend[] {
    return listScheduledSends()
  }

  /**
   * Create or amend the queued send from the composer. Omitted fields keep what
   * is stored, so arming, re-timing and re-wording are three independent writes.
   *
   * `init` describes the session for the one case where it does not exist yet —
   * see `materializeSession`.
   */
  set(sessionId: string, patch: ScheduledSendPatch, init?: ScheduledSendSessionInit): ScheduledSend | null {
    if (!this.armableInPast(sessionId, patch)) {
      const current = getScheduledSend(sessionId)
      log.warn('[scheduled-send] refused to arm sid=%s in the past (%s)', sessionId, new Date(patch.sendAt ?? 0).toISOString())
      // Report what is actually stored rather than staying silent, so a caller
      // holding a stale time is corrected instead of believing it took.
      this.emit(sessionId, current)
      return current
    }
    let next = upsertScheduledSend(sessionId, patch)
    // `sendAt` as well as `armed`: a write with neither a time of its own nor a
    // stored one to fall back on has nothing to schedule, and persisting a
    // session for it would leave an empty one behind for no promise at all.
    if (!next && patch.armed && patch.sendAt !== undefined && init && this.materializeSession(sessionId, init)) {
      next = upsertScheduledSend(sessionId, patch)
    }
    if (patch.armed === false) this.autoRearm.delete(sessionId)
    this.emit(sessionId, next)
    return next
  }

  /**
   * Whether this write may arm the row given where its due time sits.
   *
   * A hand-made schedule is a promise about the future, so arming one already
   * behind the clock is refused outright rather than clamped: the row would be
   * due on arrival and go out on the very next poll, which is exactly the
   * surprise the user was trying to avoid by scheduling it. Inventing a
   * replacement time here would be worse — main cannot know which future
   * instant they meant, and it would fire at one nobody chose.
   *
   * Three things are deliberately still allowed:
   * - anything that is not arming (re-timing, mirroring text, disarming);
   * - a rate-limit offer, whose time is a gate that has already opened rather
   *   than a plan — accepting it late means "the quota is back, go now";
   * - an already-armed row whose time has passed, which is the normal state
   *   between falling due and being delivered, and while a failed send retries.
   */
  private armableInPast(sessionId: string, patch: ScheduledSendPatch): boolean {
    if (patch.armed !== true) return true
    const prev = getScheduledSend(sessionId)
    if (prev?.armed) return true
    const source = patch.source ?? prev?.source ?? 'manual'
    if (source === 'rate_limit') return true
    const sendAt = patch.sendAt ?? prev?.sendAt
    return sendAt === undefined || sendAt > Date.now()
  }

  /**
   * Write the `sessions` row a schedule needs to exist against.
   *
   * A session gets its row from its first send, so a composer nobody has sent
   * from yet has none — and the schedule's foreign key has nothing to point at,
   * which is exactly the case "queue this for later" is for. Two reasons to
   * persist rather than relax the key: delivery resumes the session out of the
   * database, so a row it cannot load is a promise that silently never fires;
   * and the wait is routinely hours, outliving the app run that made it.
   *
   * Only on arming. An offer nobody answered, or a time picked and abandoned,
   * has not asked for anything to be kept, and would leave an empty session in
   * the project's history for a schedule that was never made.
   *
   * Hidden, because until the send fires there is nothing in this session to
   * show: the composer it mirrors is already on screen as a draft, and an empty
   * "Untitled" row beside it would be the same pending message drawn twice.
   * `reveal` puts it back the moment it stops being empty.
   *
   * The base provider is a placeholder the first real send overwrites; nothing
   * reads it until delivery, and by then either the send has corrected it or it
   * is the harness the composer was pointed at anyway.
   */
  private materializeSession(sessionId: string, init: ScheduledSendSessionInit): boolean {
    try {
      insertSessionRecord({
        id: sessionId,
        projectPath: init.projectPath,
        providerId: baseSessionProviderId(init.harnessId),
        isWorktree: !!init.worktreePath,
        worktreePath: init.worktreePath ?? null,
        isHidden: true,
      })
      return true
    } catch (err) {
      log.warn('[scheduled-send] could not persist session sid=%s: %s', sessionId, String(err))
      return false
    }
  }

  /** User cleared the schedule — forget it, consent included. */
  clear(sessionId: string): void {
    this.autoRearm.delete(sessionId)
    this.retire(sessionId)
  }

  /**
   * Drop the row without touching `autoRearm`.
   *
   * Delivery uses this rather than `clear`: the consent to keep continuing is
   * the whole point of an auto-resume chain, and spending it on the send that
   * chain just made would end the chain at its first link.
   */
  private retire(sessionId: string): void {
    deleteScheduledSend(sessionId)
    this.emit(sessionId, null)
  }

  /** Retire only the promise that completed, leaving a re-timed row intact. */
  private retireDelivered(sessionId: string, sendAt: number): void {
    const current = getScheduledSend(sessionId)
    if (current?.sendAt !== sendAt) {
      this.deps.broadcast(sessionId, current, true)
      return
    }
    deleteScheduledSend(sessionId)
    this.deps.broadcast(sessionId, null, true)
  }

  private confirmDelivery(sessionId: string): void {
    const sendAt = this.delivering.get(sessionId)
    if (sendAt === undefined) return
    this.delivering.delete(sessionId)
    this.retireDelivered(sessionId, sendAt)
  }

  /** Wire to `sessionManager.onAny`. */
  observe(sessionId: string, event: AgentEvent, replay = false): void {
    // Session restoration replays UI settings through the same event bus. A
    // saved provider ID is not a new switch that should cancel a queued send.
    if (replay) return
    switch (event.type) {
      case 'rate_limit': {
        // Unix seconds on the wire; epoch ms everywhere in this module.
        if (typeof event.resetsAt === 'number') this.lastResetsAt.set(sessionId, event.resetsAt * 1000)
        return
      }
      case 'message_error': {
        const info = event.errorInfo
        if (!info || !isRateLimitErrorInfo(info)) {
          // Failing for some other reason ends the auto-resume chain too —
          // otherwise a much later, unrelated rate limit would arm itself off a
          // consent the user gave for a turn that is long gone.
          this.autoRearm.delete(sessionId)
          this.clearStallOffer(sessionId)
          return
        }
        this.offerResume(sessionId, info.resetsAt)
        return
      }
      case 'stream_message_start':
      case 'content_delta': {
        // Unlike the local user bubble or a backend's optimistic message_start,
        // these come from provider output after the scheduled request arrived.
        this.confirmDelivery(sessionId)
        return
      }
      case 'agent_setting_change': {
        // A provider switch invalidates an unanswered offer. An armed send
        // stays queued across account changes.
        if (event.patch?.apiProviderId !== undefined) {
          this.autoRearm.delete(sessionId)
          this.clearStallOffer(sessionId)
        }
        return
      }
      case 'message_complete': {
        // Some backends can complete without a streamed response.
        this.confirmDelivery(sessionId)
        this.autoRearm.delete(sessionId)
        this.clearStallOffer(sessionId)
        return
      }
      case 'message_interrupted': {
        this.autoRearm.delete(sessionId)
        this.clearStallOffer(sessionId)
        return
      }
      default:
        return
    }
  }

  /**
   * Retire only an unanswered rate-limit offer. Once armed, its source no
   * longer changes its lifetime: only explicit cancellation or delivery does.
   */
  private clearStallOffer(sessionId: string): void {
    const existing = getScheduledSend(sessionId)
    if (existing?.source !== 'rate_limit' || existing.armed) return
    deleteScheduledSendBySource(sessionId, 'rate_limit')
    this.emit(sessionId, null)
  }

  private offerResume(sessionId: string, resetsAtSeconds: number | undefined): void {
    const now = Date.now()
    const fromError = typeof resetsAtSeconds === 'number' ? resetsAtSeconds * 1000 : undefined
    const candidate = fromError ?? this.lastResetsAt.get(sessionId)
    // A reset time already in the past describes a window that has since
    // recovered — stale, and scheduling against it would fire instantly. With no
    // usable time there is nothing to offer, so no row is written at all.
    if (candidate === undefined || candidate <= now) return

    // A schedule the user made by hand outranks an automatic offer. Overwriting
    // it would re-time it, disarm it and re-source it to `rate_limit` — and the
    // next completed turn would then delete it as if it had been ours.
    const existing = getScheduledSend(sessionId)
    if (existing?.source === 'manual') return
    // A new rate-limit signal must not re-time or disarm an accepted promise.
    // During its own send, another limit may instead move the retry window.
    if (existing?.armed && !this.sending.has(sessionId)) return

    const rearming = this.autoRearm.has(sessionId) || (this.sending.has(sessionId) && existing?.armed === true)
    const rearmMessage = this.autoRearm.get(sessionId) ?? existing?.message ?? null
    const next = upsertScheduledSend(sessionId, {
      sendAt: candidate + RESET_BUFFER_MS,
      source: 'rate_limit',
      armed: rearming,
      ...(rearming ? { message: rearmMessage ?? null } : {}),
    })
    if (next) this.emit(sessionId, next)
  }

  private flushDue(): void {
    let due: ScheduledSend[]
    try {
      due = listDueScheduledSends(Date.now())
    } catch (err) {
      log.warn('[scheduled-send] due query failed: %s', String(err))
      return
    }
    for (const row of due) {
      if (this.sending.has(row.sessionId)) continue
      void this.deliver(row)
    }
  }

  private async deliver(row: ScheduledSend): Promise<void> {
    const { sessionId } = row
    this.sending.add(sessionId)
    try {
      // Re-read rather than trusting the poll's snapshot: a cancel, a re-time or
      // a mirror write can land between the query and here.
      const fresh = getScheduledSend(sessionId)
      if (!fresh?.armed || fresh.sendAt > Date.now()) return

      const session = this.resolveSession(sessionId)
      if (!session) {
        // A deleted session cannot leave a row behind — the table's
        // `ON DELETE CASCADE` takes it along — so a failure to resolve one is
        // usually transient and the next tick is a cheap retry. Even a missing
        // provider must leave an accepted promise armed until it can send or
        // the user cancels it.
        const failures = (this.resolveFailures.get(sessionId) ?? 0) + 1
        this.resolveFailures.set(sessionId, failures)
        if (failures === 1 || failures % 10 === 0) {
          log.warn('[scheduled-send] session %s unavailable (%d), will retry', sessionId, failures)
        }
        return
      }
      this.resolveFailures.delete(sessionId)
      // A busy session cannot take this send yet; retry on the next poll.
      if (session.isStreaming()) {
        return
      }
      const content = fresh.message?.trim() || SCHEDULED_SEND_DEFAULT_MESSAGE
      if (fresh.source === 'rate_limit') this.autoRearm.set(sessionId, fresh.message)
      this.reveal(sessionId)
      log.info('[scheduled-send] delivering queued send for session %s', sessionId)
      this.delivering.set(sessionId, fresh.sendAt)
      try {
        // A stable id makes the transcript append idempotent. Without it every
        // retry of a send that fails *after* the bubble is appended (backend
        // start, rebuild) would leave another copy in the transcript, once per
        // poll, forever.
        await session.send({ content, clientMessageId: `scheduled-send:${sessionId}:${fresh.sendAt}` })
      } finally {
        // A no-op once provider output or message_complete consumed it.
        this.delivering.delete(sessionId)
      }
      // A send without provider output or completion stays armed for a safe
      // retry with the same clientMessageId.
    } catch (err) {
      // Keep the row armed: a failed send is usually the quota still being out,
      // and the next tick is a cheap retry.
      log.warn('[scheduled-send] send failed sid=%s: %s', sessionId, String(err))
    } finally {
      this.sending.delete(sessionId)
    }
  }

  /**
   * Undo the hiding `materializeSession` applied, now that the session is about
   * to hold a conversation.
   *
   * Guarded on emptiness rather than on a flag: only a session with nothing in
   * it can be one this service created, and a session the *user* hid is one they
   * chose to hide — a scheduled send arriving in it is no reason to overrule
   * that. Before the send rather than after, so the row is already there when
   * the first token streams into it.
   */
  private reveal(sessionId: string): void {
    try {
      if (sessionHasMessages(sessionId)) return
      hideSession(sessionId, false)
    } catch (err) {
      log.warn('[scheduled-send] could not reveal session sid=%s: %s', sessionId, String(err))
    }
  }

  private resolveSession(sessionId: string) {
    const live = this.deps.sessionManager.getSession(sessionId)
    if (live) return live
    try {
      const defaults = this.deps.resumeDefaults()
      // `passive` — reviving a backgrounded session must not steal the project's
      // active-session slot out from under whatever the user is looking at.
      return this.deps.sessionManager.resumeSession(sessionId, { ...defaults, passive: true })
    } catch (err) {
      log.warn('[scheduled-send] resumeSession failed sid=%s: %s', sessionId, String(err))
      return null
    }
  }
}
