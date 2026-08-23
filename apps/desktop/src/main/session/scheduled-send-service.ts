import { isRateLimitErrorInfo } from '@superone/shared/agent-error'
import {
  SCHEDULED_SEND_DEFAULT_MESSAGE,
  type AgentEvent,
  type PermissionMode,
  type SandboxMode,
  type ScheduledSend,
  type ScheduledSendPatch,
} from '@superone/shared/agent-types'
import log from '../logger'
import {
  deleteScheduledSend,
  deleteScheduledSendBySource,
  getScheduledSend,
  listDueScheduledSends,
  upsertScheduledSend,
} from '../db-scheduled-sends'
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

/**
 * How many consecutive failures to resolve a session before the schedule is
 * disarmed instead of retried. Some failures never clear — a deleted provider,
 * an unregistered harness — and a silent 30s loop helps nobody.
 */
const MAX_RESOLVE_FAILURES = 10

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
  /**
   * Sessions whose queued text is in flight. Consumed by the very
   * `user_message_appended` that text raises, which is the only moment it is
   * known to have landed — a broadcast from anything else (a cancel racing the
   * send, a re-time) must not tell the composer its draft went out.
   */
  private readonly delivering = new Set<string>()
  /** Consecutive resolve failures per session, so a permanent one is bounded. */
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

  /**
   * Create or amend the queued send from the composer. Omitted fields keep what
   * is stored, so arming, re-timing and re-wording are three independent writes.
   */
  set(sessionId: string, patch: ScheduledSendPatch): ScheduledSend | null {
    const next = upsertScheduledSend(sessionId, patch)
    if (patch.armed === false) this.autoRearm.delete(sessionId)
    this.emit(sessionId, next)
    return next
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

  /**
   * Retire the delivered row, but only if it is still the row that was sent.
   *
   * `Session.send` awaits the whole turn, so minutes can pass inside it — long
   * enough for the user to re-time the schedule. `sendAt` is the identity that
   * matters: a mirror write changes the text of the same promise, a re-time
   * makes it a different one.
   */
  private retireIfUnchanged(sessionId: string, sendAt: number): void {
    if (getScheduledSend(sessionId)?.sendAt !== sendAt) return
    this.retire(sessionId)
  }

  /** Wire to `sessionManager.onAny`. */
  observe(sessionId: string, event: AgentEvent): void {
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
      case 'user_message_appended': {
        // Not a retirement signal — `appendTranscriptMessage` raises this for a
        // mailbox bubble that never reaches the model, so a peer message
        // arriving mid-stall must not retire an offer nobody answered. It is,
        // however, the exact moment a delivery's text lands in the transcript,
        // which is the only safe cue for emptying the composer that mirrors it.
        if (this.delivering.delete(sessionId)) {
          this.deps.broadcast(sessionId, getScheduledSend(sessionId), true)
        }
        return
      }
      case 'agent_setting_change': {
        // Switching the credential switches the quota, so the stall the offer
        // describes is no longer the one this session is under. Retiring it is
        // also the composer's only way out: an unanswered offer blocks sending,
        // and nothing else can clear it without a turn the user cannot start.
        // Scoped to `apiProviderId` — a model change inside the same provider
        // draws on the same quota and changes nothing.
        if (event.patch?.apiProviderId !== undefined) {
          this.autoRearm.delete(sessionId)
          this.clearStallOffer(sessionId)
        }
        return
      }
      // A turn that got anywhere means the stall is over.
      case 'message_complete':
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
   * Retire the offer a stall left behind. Scoped to `rate_limit` rows on
   * purpose: a schedule the user set by hand is a promise about a future time,
   * not a description of this turn, so an unrelated turn completing must not
   * quietly cancel it.
   */
  private clearStallOffer(sessionId: string): void {
    const existing = getScheduledSend(sessionId)
    if (existing?.source !== 'rate_limit') return
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
    if (getScheduledSend(sessionId)?.source === 'manual') return

    const rearmMessage = this.autoRearm.get(sessionId)
    const rearming = this.autoRearm.has(sessionId)
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
        // usually transient and the next tick is a cheap retry. Usually, not
        // always: a session whose provider was deleted, or whose harness never
        // registered, fails identically and forever. Disarm rather than delete
        // after enough tries, so the promise is not silently thrown away and the
        // composer still shows that it did not fire.
        const failures = (this.resolveFailures.get(sessionId) ?? 0) + 1
        this.resolveFailures.set(sessionId, failures)
        log.warn('[scheduled-send] session %s unavailable (%d), will retry', sessionId, failures)
        if (failures >= MAX_RESOLVE_FAILURES) {
          log.warn('[scheduled-send] giving up on session %s, disarming', sessionId)
          this.resolveFailures.delete(sessionId)
          this.set(sessionId, { armed: false })
        }
        return
      }
      this.resolveFailures.delete(sessionId)
      // Something else already took the session — a rate-limit offer is moot,
      // but a promise the user made by hand still has to be kept.
      if (session.isStreaming()) {
        if (fresh.source === 'rate_limit') this.clearStallOffer(sessionId)
        return
      }
      const content = fresh.message?.trim() || SCHEDULED_SEND_DEFAULT_MESSAGE
      if (fresh.source === 'rate_limit') this.autoRearm.set(sessionId, fresh.message)
      log.info('[scheduled-send] delivering queued send for session %s', sessionId)
      this.delivering.add(sessionId)
      try {
        // A stable id makes the transcript append idempotent. Without it every
        // retry of a send that fails *after* the bubble is appended (backend
        // start, rebuild) would leave another copy in the transcript, once per
        // poll, forever.
        await session.send({ content, clientMessageId: `scheduled-send:${sessionId}:${fresh.sendAt}` })
      } finally {
        // A no-op once the append consumed it; this covers the send that failed
        // before ever reaching the transcript.
        this.delivering.delete(sessionId)
      }
      // A rate-limit row is retired by the turn's own terminal event, and must
      // not be retired here: if that turn rate-limits again, `offerResume` has
      // already written the *next* offer by the time this send resolves, and
      // deleting it would end the auto-resume chain at its first link.
      if (fresh.source === 'manual') this.retireIfUnchanged(sessionId, fresh.sendAt)
    } catch (err) {
      // Keep the row armed: a failed send is usually the quota still being out,
      // and the next tick is a cheap retry.
      log.warn('[scheduled-send] send failed sid=%s: %s', sessionId, String(err))
    } finally {
      this.sending.delete(sessionId)
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
