import { randomUUID } from 'node:crypto'
import {
  DEFAULT_HOST_ACTION_TOOL_GROUPS,
  HOST_ACTION_CAPABILITY_VERSION,
  projectSessionTurnEvent,
  SESSION_DURABLE_EVENT,
  type ClaimHostActionResult,
  type HostActionChange,
  type HostActionPublicView,
  type HostActionReplayPolicy,
  type HostActionsPollResult,
  type HostActionTerminalResult,
  type RespondHostActionResult,
  type SessionRef,
} from '@superone/shared/environment'
import { stripMiniAppMarkup } from '@superone/shared/miniapp-prompt-tags'
import type { LeaseGuard, SessionEventLog, SessionStore } from './ports'
import {
  DEFAULT_HOST_ACTION_CLAIM_TTL_MS,
  DEFAULT_HOST_ACTION_DEADLINE_MS,
  type HostActionStore,
} from './host-action-store'
import {
  DEFAULT_PERMISSION_TIMEOUT_MS,
  type NodeSessionRecord,
  type PendingInteraction,
  type PermissionDecision,
  type SessionStatus,
  type SessionTurnEvent,
  type TranscriptBlock,
  type TurnRunner,
} from './types'

/** Match desktop extractClaudeTitle: first user text, stripped, max 100 chars. */
export function deriveSessionTitleFromUserText(text: string): string | null {
  const cleaned = stripMiniAppMarkup(text).trim().replace(/\s+/g, ' ')
  if (!cleaned) return null
  return cleaned.length > 100 ? `${cleaned.slice(0, 100)}…` : cleaned
}

/** Match desktop session-fork title: append " (fork)" once. */
export function forkSessionTitle(title: string | null): string {
  const base = title?.trim() || 'Session'
  return base.endsWith('(fork)') ? base : `${base} (fork)`
}

export type {
  NodeSessionRecord,
  PendingInteraction,
  PermissionDecision,
  SessionStatus,
  SessionTurnEvent,
  TranscriptBlock,
  TurnRunner,
} from './types'
export { DEFAULT_PERMISSION_TIMEOUT_MS } from './types'
export type { LeaseGuard, SessionEventLog, SessionStore } from './ports'

interface PermissionWaiter {
  sessionId: string
  /**
   * Single-settlement path for respond / timeout / abort.
   * Always resolves the runner Promise exactly once.
   */
  settle: (result: {
    decision: PermissionDecision
    reason: 'responded' | 'timeout' | 'aborted'
    /** Wire decision when reason is responded (may be allow_always). */
    clientDecision?: 'allow' | 'deny' | 'allow_always'
  }) => void
  timer: ReturnType<typeof setTimeout>
}

/**
 * Electron-free Session runtime (Phase 3+).
 * Persistence and leases are host ports — SQLite adapters live in apps/cli.
 *
 * Permission lifecycle (Stage 5-D):
 * 1. Runner calls `onPermission` → durable `session.permission_requested`
 * 2. Runtime parks the turn on a promise waiter
 * 3. Client with control lease calls `respondPermission`
 * 4. Waiter resolves allow|deny; timeout / abort / close resolve deny
 */
interface HostActionWaiter {
  settle: (result: HostActionTerminalResult) => void
  timer: ReturnType<typeof setTimeout> | null
}

export class SessionRuntime {
  private readonly aborts = new Map<string, AbortController>()
  private readonly live = new Map<string, NodeSessionRecord>()
  /** In-flight turn promises (including runner cleanup / process kill). */
  private readonly inFlightTurns = new Set<Promise<void>>()
  /** Set synchronously at the start of dispose(); rejects new send(). */
  private disposing = false
  /**
   * Active permission waiters keyed by interactionId.
   * respondPermission resolves these; timeout/abort/close deny them.
   */
  private readonly permissionWaiters = new Map<string, PermissionWaiter>()
  private readonly permissionTimeoutMs: number
  private readonly hostActions: HostActionStore | null
  /** Live waiters for requestHostAction terminal settlement. */
  private readonly hostActionWaiters = new Map<string, HostActionWaiter>()
  /** Long-poll waiters woken on host action change. */
  private readonly hostActionPollWaiters = new Set<() => void>()
  private hostActionExpiryTimer: ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly store: SessionStore,
    private readonly events: SessionEventLog,
    private readonly leases: LeaseGuard,
    private readonly environmentId: string,
    private readonly turnRunner: TurnRunner,
    opts?: { permissionTimeoutMs?: number; hostActions?: HostActionStore | null },
  ) {
    this.permissionTimeoutMs = opts?.permissionTimeoutMs ?? DEFAULT_PERMISSION_TIMEOUT_MS
    this.hostActions = opts?.hostActions ?? null
    this.hydrateFromStore()
    this.reconcileAfterRestart()
    if (this.hostActions) {
      this.hostActions.subscribe(() => this.wakeHostActionPollers())
      // Periodic claim/deadline reconciliation (claim TTL requeue / cancel).
      this.hostActionExpiryTimer = setInterval(() => {
        this.reconcileHostActionExpiry()
      }, 2_000)
      // Don't keep the process alive solely for this timer (tests + node).
      if (typeof this.hostActionExpiryTimer === 'object' && 'unref' in this.hostActionExpiryTimer) {
        this.hostActionExpiryTimer.unref()
      }
    }
  }

  /** True while dispose() is in progress or has completed. */
  isDisposing(): boolean {
    return this.disposing
  }

  private hydrateFromStore(): void {
    for (const session of this.store.loadAll()) {
      this.live.set(session.sessionId, session)
    }
  }

  /**
   * After node restart, any session still marked streaming cannot reattach
   * (turnReattach=false for Phase 3 default) — mark interrupted explicitly.
   */
  private reconcileAfterRestart(): void {
    for (const session of this.live.values()) {
      let changed = false
      if (session.status === 'streaming') {
        session.status = 'interrupted'
        changed = true
      }
      // No live permissionWaiters after restart — drop sticky pending UI or clients hang.
      if (session.pendingInteraction != null) {
        session.pendingInteraction = null
        changed = true
      }
      // Backfill controller fields for rows loaded from older schema.
      if (session.controllerClientSessionId === undefined) {
        session.controllerClientSessionId = null
        changed = true
      }
      if (session.hostActionCapabilityVersion === undefined) {
        session.hostActionCapabilityVersion = 0
        changed = true
      }
      if (!Array.isArray(session.hostActionToolGroups)) {
        session.hostActionToolGroups = []
        changed = true
      }
      if (!changed) continue
      session.updatedAt = Date.now()
      this.persist(session)
      this.events.appendSession({
        sessionId: session.sessionId,
        eventType: SESSION_DURABLE_EVENT.reconciled,
        payload: {
          status: session.status,
          reason: 'node_restart_non_reattachable',
          pendingInteraction: null,
        },
      })
    }

    // Cancel every non-terminal host action so crash-window waiters settle.
    if (this.hostActions) {
      const cancelled = this.hostActions.reconcileAfterRestart()
      for (const row of cancelled) {
        this.settleHostActionWaiter(this.hostActions.toTerminal(row))
      }
    }
  }

  create(input: {
    projectId: string
    harnessId?: string
    providerId?: string
    title?: string
    /**
     * Pairing-level controller identity. Bound once at create; multi-desktop
     * handoff is deferred (fail closed).
     */
    controllerClientSessionId?: string | null
    /** Session-scoped host-action tool groups. Defaults to [browser.read] when controller is set. */
    hostActionToolGroups?: string[]
    hostActionCapabilityVersion?: number
  }): NodeSessionRecord {
    const now = Date.now()
    const controller =
      typeof input.controllerClientSessionId === 'string' && input.controllerClientSessionId.trim()
        ? input.controllerClientSessionId.trim()
        : null
    const session: NodeSessionRecord = {
      sessionId: randomUUID(),
      projectId: input.projectId,
      harnessId: input.harnessId ?? 'claude',
      providerId: input.providerId ?? input.harnessId ?? 'claude',
      title: input.title ?? null,
      status: 'idle',
      transcript: [],
      pendingInteraction: null,
      providerResume: null,
      cwd: null,
      createdAt: now,
      updatedAt: now,
      isPinned: false,
      isHidden: false,
      controllerClientSessionId: controller,
      hostActionCapabilityVersion: controller
        ? (input.hostActionCapabilityVersion ?? HOST_ACTION_CAPABILITY_VERSION)
        : 0,
      hostActionToolGroups: controller
        ? (input.hostActionToolGroups ?? [...DEFAULT_HOST_ACTION_TOOL_GROUPS])
        : [],
    }
    this.live.set(session.sessionId, session)
    this.persist(session)
    this.events.appendSession({
      sessionId: session.sessionId,
      eventType: SESSION_DURABLE_EVENT.created,
      payload: {
        projectId: session.projectId,
        harnessId: session.harnessId,
        providerId: session.providerId,
        controllerClientSessionId: session.controllerClientSessionId,
        hostActionCapabilityVersion: session.hostActionCapabilityVersion,
        hostActionToolGroups: session.hostActionToolGroups,
      },
    })
    return this.clone(session)
  }

  /** Set agent cwd (project root or worktree). Null clears to project default. */
  setCwd(sessionId: string, cwd: string | null): NodeSessionRecord {
    const session = this.live.get(sessionId)
    if (!session) throw Object.assign(new Error('session not found'), { code: 'not_found' })
    session.cwd = cwd && cwd.trim() ? cwd.trim() : null
    session.updatedAt = Date.now()
    this.persist(session)
    return this.clone(session)
  }

  /**
   * Fork a session into a new independent session on this node.
   *
   * Clones the durable transcript (optionally truncated at `forkFromMessageId`)
   * and title; source is left untouched. `cwd` is set on the fork (worktree path
   * or same-dir local).
   *
   * `providerResume` must be a **new** harness session/thread id from
   * `forkClaudeTranscript` / `forkCodexThread` — never the source id (that would
   * share live state). Omit / null when no SDK fork was performed (UI-only).
   */
  fork(input: {
    sourceSessionId: string
    /** Absolute host cwd for the forked session (worktree or shared local). */
    cwd?: string | null
    forkFromMessageId?: string
    /**
     * New provider resume token for the forked session
     * (e.g. `claude-session:<id>` / `thread:<id>`). Defaults to null.
     */
    providerResume?: string | null
  }): NodeSessionRecord {
    if (this.disposing) {
      throw Object.assign(new Error('runtime is shutting down'), { code: 'failed_precondition' })
    }
    const source = this.live.get(input.sourceSessionId)
    if (!source) throw Object.assign(new Error('session not found'), { code: 'not_found' })
    if (source.closed || source.status === 'ended') {
      throw Object.assign(new Error('session is closed'), { code: 'failed_precondition' })
    }
    if (source.transcript.length === 0 && !source.providerResume) {
      throw Object.assign(new Error('This session has no conversation to fork yet'), {
        code: 'failed_precondition',
      })
    }

    let transcript = source.transcript.map((t) => ({ ...t }))
    if (input.forkFromMessageId) {
      const idx = transcript.findIndex((b) => b.id === input.forkFromMessageId)
      if (idx >= 0) transcript = transcript.slice(0, idx + 1)
    }

    const now = Date.now()
    const cwd =
      input.cwd !== undefined
        ? input.cwd && input.cwd.trim()
          ? input.cwd.trim()
          : null
        : source.cwd
    const providerResume =
      input.providerResume !== undefined
        ? input.providerResume && input.providerResume.trim()
          ? input.providerResume.trim()
          : null
        : null
    const session: NodeSessionRecord = {
      sessionId: randomUUID(),
      projectId: source.projectId,
      harnessId: source.harnessId,
      providerId: source.providerId,
      title: forkSessionTitle(source.title),
      status: 'idle',
      transcript,
      pendingInteraction: null,
      providerResume,
      cwd,
      createdAt: now,
      updatedAt: now,
      isPinned: false,
      isHidden: false,
      // Fork inherits controller binding (same paired desktop).
      controllerClientSessionId: source.controllerClientSessionId,
      hostActionCapabilityVersion: source.hostActionCapabilityVersion,
      hostActionToolGroups: [...(source.hostActionToolGroups ?? [])],
    }
    this.live.set(session.sessionId, session)
    this.persist(session)
    this.events.appendSession({
      sessionId: session.sessionId,
      eventType: SESSION_DURABLE_EVENT.created,
      payload: {
        projectId: session.projectId,
        harnessId: session.harnessId,
        providerId: session.providerId,
        forkedFromSessionId: source.sessionId,
        cwd: session.cwd,
      },
    })
    return this.clone(session)
  }

  get(sessionId: string): NodeSessionRecord | null {
    const s = this.live.get(sessionId)
    return s ? this.clone(s) : null
  }

  list(projectId?: string): NodeSessionRecord[] {
    return [...this.live.values()]
      .filter((s) => !projectId || s.projectId === projectId)
      .map((s) => this.clone(s))
  }

  snapshotSequence(): string {
    return this.events.headSequence()
  }

  listEventsAfter(afterSequence: string) {
    return this.events.listAfter(afterSequence)
  }

  async send(input: {
    sessionId: string
    text: string
    client: { clientSessionId: string }
    leaseId: string
    generation: string
    requestId?: string
    /** UI-selected model for this turn (optional). */
    model?: string | null
    /** Node provider credential id for API keys this turn. */
    apiProviderId?: string | null
  }): Promise<NodeSessionRecord> {
    if (this.disposing) {
      throw Object.assign(new Error('runtime is shutting down'), { code: 'failed_precondition' })
    }
    const session = this.live.get(input.sessionId)
    if (!session) throw Object.assign(new Error('session not found'), { code: 'not_found' })

    const ref: SessionRef = { environmentId: this.environmentId, sessionId: session.sessionId }
    this.leases.assertValid({
      resource: ref,
      leaseId: input.leaseId,
      generation: input.generation,
      holderClientId: input.client.clientSessionId,
    })

    if (session.closed || session.status === 'ended') {
      throw Object.assign(new Error('session is closed'), { code: 'failed_precondition' })
    }
    if (session.status === 'streaming') {
      throw Object.assign(new Error('session already streaming'), { code: 'failed_precondition' })
    }

    const userBlock: TranscriptBlock = {
      id: randomUUID(),
      role: 'user',
      text: input.text,
      createdAt: Date.now(),
    }
    session.transcript.push(userBlock)
    session.status = 'streaming'
    session.updatedAt = Date.now()

    // Desktop parity: empty titles become a slice of the first user message until
    // the agent renames via session_rename / session.rename.
    let autoTitle: string | null = null
    if (!session.title || !session.title.trim()) {
      autoTitle = deriveSessionTitleFromUserText(input.text)
      if (autoTitle) session.title = autoTitle
    }

    this.persist(session)
    this.events.appendSession({
      sessionId: session.sessionId,
      eventType: SESSION_DURABLE_EVENT.userMessage,
      payload: { blockId: userBlock.id, text: input.text },
      causationRequestId: input.requestId,
    })
    if (autoTitle) {
      this.events.appendSession({
        sessionId: session.sessionId,
        eventType: SESSION_DURABLE_EVENT.renamed,
        payload: { title: autoTitle, source: 'agent' },
        causationRequestId: input.requestId,
      })
    }
    this.events.appendSession({
      sessionId: session.sessionId,
      eventType: SESSION_DURABLE_EVENT.turnStarted,
      payload: { status: 'streaming' },
      causationRequestId: input.requestId,
    })

    const abort = new AbortController()
    this.aborts.set(session.sessionId, abort)

    // Fire-and-forget for the RPC path, but track the promise so dispose/stop
    // can await runner cleanup (e.g. Codex SIGTERM → SIGKILL window).
    const turnPromise = this.runTurn(
      session,
      input.text,
      abort,
      input.requestId,
      input.model,
      input.apiProviderId,
    )
    this.inFlightTurns.add(turnPromise)
    void turnPromise.finally(() => {
      this.inFlightTurns.delete(turnPromise)
      this.aborts.delete(session.sessionId)
    })

    return this.clone(session)
  }

  private async runTurn(
    session: NodeSessionRecord,
    text: string,
    abort: AbortController,
    requestId?: string,
    model?: string | null,
    apiProviderId?: string | null,
  ): Promise<void> {
    const assistantId = randomUUID()
    let assistantText = ''
    try {
      const result = await this.turnRunner({
        session: this.clone(session),
        messageId: assistantId,
        text,
        model: model && model.trim() ? model.trim() : undefined,
        apiProviderId: apiProviderId && apiProviderId.trim() ? apiProviderId.trim() : undefined,
        signal: abort.signal,
        onDelta: (delta) => {
          if (abort.signal.aborted) return
          assistantText += delta
          this.events.appendSession({
            sessionId: session.sessionId,
            eventType: SESSION_DURABLE_EVENT.assistantDelta,
            payload: { blockId: assistantId, delta },
            causationRequestId: requestId,
          })
        },
        onEvent: (event) => {
          this.projectOnEvent(session, event, abort.signal, requestId, (delta) => {
            assistantText += delta
          })
        },
        onAgentEvent: (event) => {
          if (abort.signal.aborted) return
          this.events.appendSession({
            sessionId: session.sessionId,
            eventType: SESSION_DURABLE_EVENT.agentEvent,
            payload: { event },
            causationRequestId: requestId,
          })
        },
        onPermission: (interaction) =>
          this.waitForPermissionDecision(session, interaction, abort.signal, requestId),
      })

      if (session.closed) {
        // close() already tombstoned the session; do not overwrite status.
      } else if (abort.signal.aborted) {
        // Runner may return successfully after seeing AbortSignal (no throw).
        session.status = 'interrupted'
        this.events.appendSession({
          sessionId: session.sessionId,
          eventType: SESSION_DURABLE_EVENT.turnInterrupted,
          payload: { reason: 'client_interrupt' },
          causationRequestId: requestId,
        })
      } else {
        assistantText = result.finalText || assistantText
        session.transcript.push({
          id: assistantId,
          role: 'assistant',
          text: assistantText,
          createdAt: Date.now(),
        })
        session.status = 'idle'
        session.providerResume = result.providerResume ?? session.providerResume
        this.events.appendSession({
          sessionId: session.sessionId,
          eventType: SESSION_DURABLE_EVENT.assistantMessage,
          payload: { blockId: assistantId, text: assistantText },
          causationRequestId: requestId,
        })
        this.events.appendSession({
          sessionId: session.sessionId,
          eventType: SESSION_DURABLE_EVENT.turnCompleted,
          payload: { status: 'idle' },
          causationRequestId: requestId,
        })
      }
    } catch (err) {
      if (session.closed) {
        /* keep ended */
      } else if (abort.signal.aborted) {
        session.status = 'interrupted'
        this.events.appendSession({
          sessionId: session.sessionId,
          eventType: SESSION_DURABLE_EVENT.turnInterrupted,
          payload: { reason: 'client_interrupt' },
        })
      } else {
        session.status = 'error'
        this.events.appendSession({
          sessionId: session.sessionId,
          eventType: SESSION_DURABLE_EVENT.turnError,
          payload: { message: (err as Error).message },
        })
      }
    } finally {
      // Any host action still open when the turn ends cannot be claimed (active-turn
      // gate) — cancel so requestHostAction waiters settle rather than hang to deadline.
      if (!session.closed) {
        this.cancelHostActionsForSession(session.sessionId, 'turn_ended')
      }
      if (!session.closed) {
        session.updatedAt = Date.now()
        this.persist(session)
      }
      this.aborts.delete(session.sessionId)
    }
  }

  close(sessionId: string): void {
    const session = this.live.get(sessionId)
    if (!session) throw Object.assign(new Error('session not found'), { code: 'not_found' })
    if (session.closed) return
    const abort = this.aborts.get(sessionId)
    abort?.abort()
    this.aborts.delete(sessionId)
    session.closed = true
    session.status = 'ended'
    this.rejectPendingPermission(session, 'aborted')
    this.cancelHostActionsForSession(sessionId, 'session_closed')
    session.updatedAt = Date.now()
    this.persist(session)
    this.events.appendSession({
      sessionId: session.sessionId,
      eventType: SESSION_DURABLE_EVENT.closed,
      payload: { status: 'ended' },
    })
  }

  /** Soft-delete: close + remove from registry (disk files untouched). */
  remove(sessionId: string): NodeSessionRecord | null {
    const session = this.live.get(sessionId)
    if (!session) return null
    if (!session.closed) this.close(sessionId)
    this.live.delete(sessionId)
    this.store.delete(sessionId)
    this.events.appendSession({
      sessionId,
      eventType: SESSION_DURABLE_EVENT.removed,
      payload: {},
    })
    return this.clone(session)
  }

  rename(sessionId: string, title: string): NodeSessionRecord {
    const session = this.live.get(sessionId)
    if (!session) throw Object.assign(new Error('session not found'), { code: 'not_found' })
    if (session.closed) {
      throw Object.assign(new Error('session is closed'), { code: 'failed_precondition' })
    }
    session.title = title.trim() || null
    session.updatedAt = Date.now()
    this.persist(session)
    this.events.appendSession({
      sessionId: session.sessionId,
      eventType: SESSION_DURABLE_EVENT.renamed,
      payload: { title: session.title },
    })
    return this.clone(session)
  }

  setUiFlags(
    sessionId: string,
    flags: { isPinned?: boolean; isHidden?: boolean },
  ): NodeSessionRecord {
    const session = this.live.get(sessionId)
    if (!session) throw Object.assign(new Error('session not found'), { code: 'not_found' })
    if (typeof flags.isPinned === 'boolean') session.isPinned = flags.isPinned
    if (typeof flags.isHidden === 'boolean') session.isHidden = flags.isHidden
    session.updatedAt = Date.now()
    this.persist(session)
    this.events.appendSession({
      sessionId: session.sessionId,
      eventType: SESSION_DURABLE_EVENT.uiFlags,
      payload: { isPinned: session.isPinned, isHidden: session.isHidden },
    })
    return this.clone(session)
  }

  interrupt(sessionId: string, client: { clientSessionId: string }, leaseId: string, generation: string): void {
    const session = this.live.get(sessionId)
    if (!session) throw Object.assign(new Error('session not found'), { code: 'not_found' })
    this.leases.assertValid({
      resource: { environmentId: this.environmentId, sessionId },
      leaseId,
      generation,
      holderClientId: client.clientSessionId,
    })
    const abort = this.aborts.get(sessionId)
    abort?.abort()
    // Cancel outstanding host actions so the desktop can abort local work (AbortSignal).
    this.cancelHostActionsForSession(sessionId, 'interrupt')
    if (session.status === 'streaming') {
      session.status = 'interrupted'
      session.updatedAt = Date.now()
      this.persist(session)
    }
  }

  // ---------------------------------------------------------------------------
  // Host Action channel (controller-scoped durable poll / claim / respond)
  // ---------------------------------------------------------------------------

  /**
   * Create a host action and await its terminal state.
   * Cancelled by interrupt / turn timeout / session close / deadline / node restart.
   * Late responses after cancellation are rejected by the store.
   */
  requestHostAction(input: {
    sessionId: string
    turnId?: string | null
    toolName: string
    toolGroup: string
    args: unknown
    replayPolicy?: HostActionReplayPolicy
    deadlineMs?: number
    /**
     * When aborted, cancel this action (MCP tool handler should pass the turn signal).
     * Also auto-bound to the session's in-flight turn AbortSignal when present.
     */
    signal?: AbortSignal
  }): Promise<HostActionTerminalResult> {
    if (!this.hostActions) {
      return Promise.reject(
        Object.assign(new Error('host action store not configured'), {
          code: 'failed_precondition',
        }),
      )
    }
    if (this.disposing) {
      return Promise.reject(
        Object.assign(new Error('runtime is shutting down'), { code: 'failed_precondition' }),
      )
    }
    const session = this.live.get(input.sessionId)
    if (!session) {
      return Promise.reject(Object.assign(new Error('session not found'), { code: 'not_found' }))
    }
    if (!session.controllerClientSessionId) {
      return Promise.reject(
        Object.assign(new Error('session has no controller binding'), {
          code: 'failed_precondition',
        }),
      )
    }
    if (session.hostActionCapabilityVersion < 1) {
      return Promise.reject(
        Object.assign(new Error('hostActionV1 not granted on this session'), {
          code: 'failed_precondition',
        }),
      )
    }
    if (!session.hostActionToolGroups.includes(input.toolGroup)) {
      return Promise.reject(
        Object.assign(new Error(`tool group not granted: ${input.toolGroup}`), {
          code: 'forbidden',
        }),
      )
    }
    if (session.closed || session.status === 'ended') {
      return Promise.reject(
        Object.assign(new Error('session is closed'), { code: 'failed_precondition' }),
      )
    }

    const deadlineMs = input.deadlineMs ?? DEFAULT_HOST_ACTION_DEADLINE_MS
    const row = this.hostActions.create({
      sessionId: session.sessionId,
      turnId: input.turnId ?? null,
      controllerClientSessionId: session.controllerClientSessionId,
      toolName: input.toolName,
      toolGroup: input.toolGroup,
      args: input.args,
      replayPolicy: input.replayPolicy ?? 'safe',
      deadlineMs,
    })

    // Observability only — never args.
    this.events.appendSession({
      sessionId: session.sessionId,
      eventType: SESSION_DURABLE_EVENT.hostActionRequested,
      payload: { actionId: row.actionId },
    })

    return new Promise<HostActionTerminalResult>((resolve) => {
      const remaining = Math.max(0, row.deadline - Date.now())
      const timer = setTimeout(() => {
        this.cancelHostActionInternal(row.actionId, 'deadline_exceeded')
      }, remaining + 50)

      const abortCleanups: Array<() => void> = []
      const onAbort = (reason: string) => {
        this.cancelHostActionInternal(row.actionId, reason)
      }

      // Bind to explicit signal + active turn abort (interrupt / turn end).
      const signals: AbortSignal[] = []
      if (input.signal) signals.push(input.signal)
      const turnAbort = this.aborts.get(session.sessionId)?.signal
      if (turnAbort && turnAbort !== input.signal) signals.push(turnAbort)

      for (const sig of signals) {
        if (sig.aborted) {
          // Defer so the waiter is registered before settle.
          queueMicrotask(() => onAbort('aborted'))
          break
        }
        const handler = () => onAbort('aborted')
        sig.addEventListener('abort', handler, { once: true })
        abortCleanups.push(() => sig.removeEventListener('abort', handler))
      }

      this.hostActionWaiters.set(row.actionId, {
        settle: (result) => {
          clearTimeout(timer)
          for (const c of abortCleanups) c()
          this.hostActionWaiters.delete(row.actionId)
          resolve(result)
        },
        timer,
      })
    })
  }

  /**
   * Controller-scoped long-poll. Without afterSequence: outstanding snapshot + cursor.
   * With afterSequence: durable state changes after the cursor (waits up to waitMs).
   * Exposes IDs, state, version, replayPolicy — never args.
   */
  async pollHostActions(input: {
    controllerClientSessionId: string
    afterSequence?: string | null
    waitMs?: number
    limit?: number
  }): Promise<HostActionsPollResult> {
    if (!this.hostActions) {
      throw Object.assign(new Error('host action store not configured'), {
        code: 'failed_precondition',
      })
    }
    // Opportunistic expiry pass before answering.
    this.reconcileHostActionExpiry()

    const limit = Math.min(Math.max(input.limit ?? 100, 1), 500)
    const waitMs = Math.min(Math.max(input.waitMs ?? 0, 0), 30_000)
    const hasCursor = input.afterSequence != null && input.afterSequence !== ''

    if (!hasCursor) {
      const outstanding = this.hostActions.listOutstanding(input.controllerClientSessionId)
      return {
        outstanding,
        changes: [],
        cursor: this.hostActions.headSequence(),
      }
    }

    const after = String(input.afterSequence)
    const existing = this.hostActions.listChangesAfter(
      input.controllerClientSessionId,
      after,
      limit,
    )
    if (existing.length > 0 || waitMs === 0) {
      return {
        changes: existing,
        cursor: existing.length
          ? existing[existing.length - 1]!.sequence
          : this.hostActions.headSequence(),
      }
    }

    // Long-poll: wait for a change or timeout.
    await new Promise<void>((resolve) => {
      let settled = false
      const done = () => {
        if (settled) return
        settled = true
        this.hostActionPollWaiters.delete(done)
        clearTimeout(timer)
        resolve()
      }
      const timer = setTimeout(done, waitMs)
      this.hostActionPollWaiters.add(done)
    })

    const changes = this.hostActions.listChangesAfter(
      input.controllerClientSessionId,
      after,
      limit,
    )
    return {
      changes,
      cursor: changes.length
        ? changes[changes.length - 1]!.sequence
        : this.hostActions.headSequence(),
    }
  }

  /**
   * Atomically claim a pending action for the authenticated controller.
   * Verifies binding, capability/grant, active turn, and pending state.
   */
  claimHostAction(input: {
    actionId: string
    expectedVersion: number
    controllerClientSessionId: string
    claimTtlMs?: number
  }): ClaimHostActionResult {
    if (!this.hostActions) {
      throw Object.assign(new Error('host action store not configured'), {
        code: 'failed_precondition',
      })
    }
    this.reconcileHostActionExpiry()

    const existing = this.hostActions.get(input.actionId)
    if (!existing) {
      throw Object.assign(new Error('host action not found'), { code: 'not_found' })
    }
    if (existing.controllerClientSessionId !== input.controllerClientSessionId) {
      throw Object.assign(new Error('not the session controller'), { code: 'forbidden' })
    }

    const session = this.live.get(existing.sessionId)
    if (!session) {
      throw Object.assign(new Error('session not found'), { code: 'not_found' })
    }
    if (session.controllerClientSessionId !== input.controllerClientSessionId) {
      throw Object.assign(new Error('not the session controller'), { code: 'forbidden' })
    }
    if (session.hostActionCapabilityVersion < 1) {
      throw Object.assign(new Error('hostActionV1 not granted'), { code: 'failed_precondition' })
    }
    if (!session.hostActionToolGroups.includes(existing.toolGroup)) {
      throw Object.assign(new Error(`tool group not granted: ${existing.toolGroup}`), {
        code: 'forbidden',
      })
    }
    if (session.closed || session.status === 'ended') {
      throw Object.assign(new Error('session is closed'), { code: 'failed_precondition' })
    }
    // Active turn required — host tools only make sense mid-turn.
    if (session.status !== 'streaming') {
      throw Object.assign(new Error('no active turn'), { code: 'failed_precondition' })
    }

    const { row, claimToken } = this.hostActions.claim({
      actionId: input.actionId,
      expectedVersion: input.expectedVersion,
      controllerClientSessionId: input.controllerClientSessionId,
      claimTtlMs: input.claimTtlMs ?? DEFAULT_HOST_ACTION_CLAIM_TTL_MS,
    })

    return {
      actionId: row.actionId,
      version: row.version,
      claimToken,
      claimExpiresAt: row.claimExpiresAt!,
      toolName: row.toolName,
      toolGroup: row.toolGroup,
      args: JSON.parse(row.argsJson),
      replayPolicy: row.replayPolicy,
      sessionId: row.sessionId,
      turnId: row.turnId,
    }
  }

  /**
   * Atomically verify claim token, persist terminal result, settle live waiter.
   * Identical response returns stored receipt; different payload → conflict.
   */
  respondHostAction(input: {
    actionId: string
    claimToken: string
    controllerClientSessionId: string
    outcome: 'succeeded' | 'failed'
    result?: unknown
    error?: unknown
  }): RespondHostActionResult {
    if (!this.hostActions) {
      throw Object.assign(new Error('host action store not configured'), {
        code: 'failed_precondition',
      })
    }

    const { row, duplicate } = this.hostActions.respond({
      actionId: input.actionId,
      claimToken: input.claimToken,
      controllerClientSessionId: input.controllerClientSessionId,
      outcome: input.outcome,
      result: input.result,
      error: input.error,
    })

    if (!duplicate) {
      this.settleHostActionWaiter(this.hostActions.toTerminal(row))
    } else {
      // Duplicate identical response — still ensure any waiter is settled.
      this.settleHostActionWaiter(this.hostActions.toTerminal(row))
    }

    return {
      actionId: row.actionId,
      state: row.state as 'succeeded' | 'failed',
      version: row.version,
      duplicate,
    }
  }

  /** Test/helper: list outstanding public views for a controller. */
  listOutstandingHostActions(controllerClientSessionId: string): HostActionPublicView[] {
    if (!this.hostActions) return []
    return this.hostActions.listOutstanding(controllerClientSessionId)
  }

  /** Test/helper: peek a change log after sequence. */
  listHostActionChanges(
    controllerClientSessionId: string,
    afterSequence: string,
    limit = 100,
  ): HostActionChange[] {
    if (!this.hostActions) return []
    return this.hostActions.listChangesAfter(controllerClientSessionId, afterSequence, limit)
  }

  private cancelHostActionsForSession(sessionId: string, reason: string): void {
    if (!this.hostActions) return
    try {
      const cancelled = this.hostActions.cancel({ sessionId, reason })
      for (const row of cancelled) {
        this.settleHostActionWaiter(this.hostActions.toTerminal(row))
      }
    } catch (err) {
      // Shutdown races: db may already be closed when turn finally runs.
      if ((err as Error).message?.includes('not open')) return
      throw err
    }
  }

  private cancelHostActionInternal(actionId: string, reason: string): void {
    if (!this.hostActions) return
    try {
      const cancelled = this.hostActions.cancel({ actionId, reason })
      for (const row of cancelled) {
        this.settleHostActionWaiter(this.hostActions.toTerminal(row))
      }
    } catch (err) {
      if ((err as Error).message?.includes('not open')) return
      throw err
    }
  }

  private settleHostActionWaiter(result: HostActionTerminalResult): void {
    const waiter = this.hostActionWaiters.get(result.actionId)
    if (!waiter) return
    if (waiter.timer) clearTimeout(waiter.timer)
    this.hostActionWaiters.delete(result.actionId)
    waiter.settle(result)
  }

  private wakeHostActionPollers(): void {
    for (const w of [...this.hostActionPollWaiters]) {
      try {
        w()
      } catch {
        /* ignore */
      }
    }
  }

  private reconcileHostActionExpiry(): void {
    if (!this.hostActions) return
    try {
      const changed = this.hostActions.reconcileExpired()
      for (const row of changed) {
        if (row.state === 'cancelled' || row.state === 'succeeded' || row.state === 'failed') {
          this.settleHostActionWaiter(this.hostActions.toTerminal(row))
        }
      }
    } catch {
      /* ignore reconcile errors (db closed during dispose) */
    }
  }

  respondPermission(input: {
    sessionId: string
    interactionId: string
    decision: 'allow' | 'deny' | 'allow_always'
    client: { clientSessionId: string }
    leaseId: string
    generation: string
  }): void {
    const session = this.live.get(input.sessionId)
    if (!session) throw Object.assign(new Error('session not found'), { code: 'not_found' })
    this.leases.assertValid({
      resource: { environmentId: this.environmentId, sessionId: input.sessionId },
      leaseId: input.leaseId,
      generation: input.generation,
      holderClientId: input.client.clientSessionId,
    })
    if (!session.pendingInteraction || session.pendingInteraction.interactionId !== input.interactionId) {
      throw Object.assign(new Error('no matching pending permission'), { code: 'failed_precondition' })
    }
    const waiter = this.permissionWaiters.get(input.interactionId)
    if (!waiter || waiter.sessionId !== input.sessionId) {
      throw Object.assign(new Error('no matching pending permission'), { code: 'failed_precondition' })
    }
    // allow_always is accepted on the wire; Stage 5-D treats it as allow for the
    // runner (persistent always-allow rules are a later host concern).
    const decision: PermissionDecision = input.decision === 'deny' ? 'deny' : 'allow'
    waiter.settle({
      decision,
      reason: 'responded',
      clientDecision: input.decision,
    })
  }

  /**
   * Block the turn until the control-lease holder responds, or until
   * timeout / abort / session close. Always emits a durable permission event.
   */
  private waitForPermissionDecision(
    session: NodeSessionRecord,
    interaction: PendingInteraction,
    signal: AbortSignal,
    requestId?: string,
  ): Promise<PermissionDecision> {
    // Only one pending interaction per session (wire contract).
    if (session.pendingInteraction) {
      this.rejectPendingPermission(session, 'aborted')
    }

    return new Promise<PermissionDecision>((resolve) => {
      let settled = false
      session.pendingInteraction = interaction
      session.updatedAt = Date.now()
      this.persist(session)
      this.events.appendSession({
        sessionId: session.sessionId,
        eventType: SESSION_DURABLE_EVENT.permissionRequested,
        payload: interaction,
        causationRequestId: requestId,
      })

      const settle = (result: {
        decision: PermissionDecision
        reason: 'responded' | 'timeout' | 'aborted'
        clientDecision?: 'allow' | 'deny' | 'allow_always'
      }): void => {
        if (settled) return
        settled = true
        const waiter = this.permissionWaiters.get(interaction.interactionId)
        if (waiter) {
          clearTimeout(waiter.timer)
          this.permissionWaiters.delete(interaction.interactionId)
        }
        if (session.pendingInteraction?.interactionId === interaction.interactionId) {
          session.pendingInteraction = null
          session.updatedAt = Date.now()
          this.persist(session)
        }
        if (result.reason === 'responded') {
          this.events.appendSession({
            sessionId: session.sessionId,
            eventType: SESSION_DURABLE_EVENT.permissionResponded,
            payload: {
              interactionId: interaction.interactionId,
              decision: result.clientDecision ?? result.decision,
            },
          })
        } else if (result.reason === 'timeout') {
          this.events.appendSession({
            sessionId: session.sessionId,
            eventType: SESSION_DURABLE_EVENT.permissionTimeout,
            payload: { interactionId: interaction.interactionId, decision: 'deny' },
          })
        } else {
          this.events.appendSession({
            sessionId: session.sessionId,
            eventType: SESSION_DURABLE_EVENT.permissionAborted,
            payload: { interactionId: interaction.interactionId, decision: 'deny' },
          })
        }
        resolve(result.decision)
      }

      const timer = setTimeout(() => {
        settle({ decision: 'deny', reason: 'timeout' })
      }, this.permissionTimeoutMs)

      this.permissionWaiters.set(interaction.interactionId, {
        sessionId: session.sessionId,
        settle,
        timer,
      })

      if (signal.aborted) {
        settle({ decision: 'deny', reason: 'aborted' })
        return
      }
      signal.addEventListener(
        'abort',
        () => {
          settle({ decision: 'deny', reason: 'aborted' })
        },
        { once: true },
      )
    })
  }

  /** Deny and clear any active permission waiter for this session. */
  private rejectPendingPermission(
    session: NodeSessionRecord,
    reason: 'timeout' | 'aborted',
  ): void {
    const pending = session.pendingInteraction
    if (!pending) return
    const waiter = this.permissionWaiters.get(pending.interactionId)
    if (waiter) {
      waiter.settle({ decision: 'deny', reason })
    } else {
      session.pendingInteraction = null
    }
  }

  /**
   * Project a structured turn stream event into durable environment_events.
   * Text deltas also accumulate into the turn's assistant buffer when the
   * runner uses onEvent instead of (or in addition to) onDelta.
   */
  private projectOnEvent(
    session: NodeSessionRecord,
    event: SessionTurnEvent,
    signal: AbortSignal,
    requestId: string | undefined,
    onTextDelta: (delta: string) => void,
  ): void {
    if (signal.aborted) return
    // Avoid double-append when onPermission already logged this interaction.
    if (
      event.kind === 'permission' &&
      session.pendingInteraction?.interactionId === event.interactionId
    ) {
      return
    }
    if (event.kind === 'text' && event.delta) {
      onTextDelta(event.delta)
    }
    for (const proj of projectSessionTurnEvent(event)) {
      this.events.appendSession({
        sessionId: session.sessionId,
        eventType: proj.eventType,
        payload: proj.payload,
        causationRequestId: requestId,
      })
    }
  }

  /**
   * Abort all in-flight turns and wait for their cleanup (runner finally blocks,
   * child process kill escalation). Call before closing the database.
   *
   * Sets `disposing` synchronously so concurrent `send()` cannot register new
   * turns after the drain snapshot.
   *
   * @param timeoutMs Maximum wait for turns to settle after abort (default 5s,
   *   covers client killTimeout 2s + SIGKILL window with headroom).
   */
  async dispose(timeoutMs = 5_000): Promise<void> {
    this.disposing = true
    if (this.hostActionExpiryTimer) {
      clearInterval(this.hostActionExpiryTimer)
      this.hostActionExpiryTimer = null
    }
    // Cancel outstanding host actions so requestHostAction waiters settle.
    if (this.hostActions) {
      for (const session of this.live.values()) {
        this.cancelHostActionsForSession(session.sessionId, 'runtime_dispose')
      }
    }
    this.wakeHostActionPollers()

    const deadline = Date.now() + timeoutMs
    // Abort currently tracked controllers; re-abort if any late map entries appear.
    for (const abort of this.aborts.values()) abort.abort()

    while (this.inFlightTurns.size > 0 && Date.now() < deadline) {
      for (const abort of this.aborts.values()) abort.abort()
      const batch = [...this.inFlightTurns]
      const remaining = Math.max(0, deadline - Date.now())
      let settled = false
      await Promise.race([
        Promise.allSettled(batch).then(() => {
          settled = true
        }),
        new Promise<void>((resolve) => setTimeout(resolve, remaining)),
      ])
      if (!settled && Date.now() >= deadline) break
      // If all current batch settled, loop checks for any newly registered turns
      // (should not happen once disposing=true; belt-and-suspenders).
    }
    this.aborts.clear()
  }

  private persist(session: NodeSessionRecord): void {
    try {
      this.store.save(session)
    } catch (err) {
      // Ignore writes after dispose/db.close during shutdown races.
      if ((err as Error).message?.includes('not open')) return
      throw err
    }
  }

  private clone(s: NodeSessionRecord): NodeSessionRecord {
    return {
      ...s,
      transcript: s.transcript.map((t) => ({ ...t })),
      pendingInteraction: s.pendingInteraction ? { ...s.pendingInteraction } : null,
      controllerClientSessionId: s.controllerClientSessionId ?? null,
      hostActionCapabilityVersion: s.hostActionCapabilityVersion ?? 0,
      hostActionToolGroups: [...(s.hostActionToolGroups ?? [])],
    }
  }
}

/** Default test/sim harness: streams chunks, optionally requests permission / tools. */
export function createSimulatedTurnRunner(opts?: {
  chunks?: string[]
  delayMs?: number
  requestPermission?: boolean
  /**
   * When true, emit Stage 5-A structured onEvent tool/status events in addition
   * to onDelta text (for contract tests). Codex production path does not use this.
   */
  emitStructuredEvents?: boolean
}): TurnRunner {
  const chunks = opts?.chunks ?? ['Hello', ' from', ' remote', ' Codex']
  const delayMs = opts?.delayMs ?? 30
  return async ({ onDelta, onEvent, onPermission, signal }) => {
    onEvent?.({ kind: 'status', status: 'streaming' })
    if (opts?.requestPermission && onPermission) {
      const decision = await onPermission({
        interactionId: randomUUID(),
        kind: 'permission',
        toolName: 'shell',
        createdAt: Date.now(),
      })
      if (decision === 'deny') {
        onEvent?.({ kind: 'status', status: 'idle', message: 'permission_denied' })
        return { finalText: 'Permission denied.', providerResume: null }
      }
    }
    if (opts?.emitStructuredEvents && onEvent) {
      const toolUseId = randomUUID()
      onEvent({
        kind: 'tool',
        phase: 'started',
        toolUseId,
        toolName: 'Read',
        input: '{"path":"README.md"}',
      })
      onEvent({
        kind: 'tool',
        phase: 'completed',
        toolUseId,
        toolName: 'Read',
        output: 'ok',
      })
    }
    let finalText = ''
    const blockId = randomUUID()
    for (const chunk of chunks) {
      if (signal.aborted) throw new Error('aborted')
      await new Promise((r) => setTimeout(r, delayMs))
      if (signal.aborted) throw new Error('aborted')
      // Prefer one text path: onEvent when structured, else Codex onDelta.
      // Runners must not emit the same delta on both (would double-append).
      if (opts?.emitStructuredEvents) {
        onEvent?.({ kind: 'text', blockId, delta: chunk })
      } else {
        onDelta(chunk)
      }
      finalText += chunk
    }
    if (opts?.emitStructuredEvents) {
      onEvent?.({ kind: 'text', blockId, final: true, text: finalText })
    }
    onEvent?.({ kind: 'status', status: 'idle' })
    return { finalText, providerResume: `resume-${randomUUID()}` }
  }
}

/** @deprecated Prefer createSimulatedTurnRunner */
export const createSimulatedCodexRunner = createSimulatedTurnRunner
