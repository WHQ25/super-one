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
  type SessionMessagesListResult,
  type SessionRef,
} from '@superone/shared/environment'
import {
  buildSessionMessageCatalog,
  pageSessionMessageCatalog,
} from './message-catalog'
import { stripMiniAppMarkup } from '@superone/shared/miniapp-prompt-tags'
import type { LeaseGuard, SessionEventLog, SessionStore } from './ports'
import {
  DEFAULT_HOST_ACTION_CLAIM_TTL_MS,
  DEFAULT_HOST_ACTION_DEADLINE_MS,
  type HostActionStore,
} from './host-action-store'
import {
  type ActiveHarnessRuntime,
  DEFAULT_PERMISSION_TIMEOUT_MS,
  type AgentsConfirmOutcome,
  type NodeSessionRecord,
  type NodeSessionSettings,
  type PendingInteraction,
  type PermissionDecision,
  type PlanDecisionResult,
  type QuestionAnswers,
  type SessionStatus,
  type SessionTurnEvent,
  type TranscriptBlock,
  type TurnImageAttachment,
  type TurnRunner,
} from './types'
import {
  getRuntimeIdleTimeoutMs,
  SESSION_RUNTIME_REAPER_INTERVAL_MS,
} from './runtime-policy'

/** Default wall-clock wait for multi-launch agent confirm (ms). Desktop: 10 min. */
export const DEFAULT_AGENTS_CONFIRM_TIMEOUT_MS = 10 * 60_000

/**
 * Strip collaboration bearer credentials from a host wake prompt before the
 * user bubble is persisted. Full text still goes to the model via turn text.
 */
export function redactTaskNotificationForDisplay(content: string): string {
  return content
    .replace(/\s+with credential\s+(?:"[^"]*"|'[^']*')/gi, '')
    .replace(/\bs1sc_[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

// TurnImageAttachment used by TurnOpts / send queue.

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
  ActiveHarnessRuntime,
  AgentsConfirmOutcome,
  NodeSessionRecord,
  NodeSessionSettings,
  PendingInteraction,
  PermissionDecision,
  PlanDecisionResult,
  QuestionAnswers,
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

interface QuestionWaiter {
  sessionId: string
  settle: (result: {
    answers: QuestionAnswers
    reason: 'responded' | 'timeout' | 'aborted'
  }) => void
  timer: ReturnType<typeof setTimeout>
}

interface PlanWaiter {
  sessionId: string
  settle: (result: {
    decision: 'approve' | 'reject'
    options?: Record<string, unknown>
    reason: 'responded' | 'timeout' | 'aborted'
  }) => void
  timer: ReturnType<typeof setTimeout>
}

interface AgentsConfirmWaiter {
  sessionId: string
  settle: (result: {
    action: AgentsConfirmOutcome['action']
    content?: Record<string, unknown>
    reason: 'responded' | 'timeout' | 'aborted'
  }) => void
  timer: ReturnType<typeof setTimeout>
}

/** Options for one harness turn (active or queued). */
interface TurnOpts {
  text: string
  requestId?: string
  model?: string | null
  effort?: string | null
  images?: TurnImageAttachment[]
  permissionMode?: string | null
  sandboxMode?: string | null
  additionalDirectories?: string[]
  enabledSkills?: string[]
  disabledSkills?: string[]
  apiProviderId?: string | null
  /** Codex turn kind (run|steer|review|compact). */
  turnKind?: 'run' | 'steer' | 'review' | 'compact' | null
  collaborationMode?: string | Record<string, unknown> | null
  reviewTarget?: unknown
  /**
   * Host-origin synthetic turn (mailbox peer wake). Transcript/events store a
   * redacted copy so collaboration credentials never leak into the UI snapshot.
   */
  source?: 'user' | 'task-notification'
}

/** Normalize optional string settings: empty → null; non-string → leave as-is (caller filters). */
function normalizeSettingValue(value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

type TurnQueueItem = TurnOpts

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
  private readonly aborts = new Map<string, Set<AbortController>>()
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
  private readonly questionWaiters = new Map<string, QuestionWaiter>()
  private readonly planWaiters = new Map<string, PlanWaiter>()
  private readonly agentsConfirmWaiters = new Map<string, AgentsConfirmWaiter>()
  private readonly permissionTimeoutMs: number
  private readonly agentsConfirmTimeoutMs: number
  private readonly hostActions: HostActionStore | null
  /** Live waiters for requestHostAction terminal settlement. */
  private readonly hostActionWaiters = new Map<string, HostActionWaiter>()
  /** Long-poll waiters woken on host action change. */
  private readonly hostActionPollWaiters = new Set<() => void>()
  private hostActionExpiryTimer: ReturnType<typeof setInterval> | null = null
  private runtimeReaperTimer: ReturnType<typeof setInterval> | null = null
  private readonly runtimeReleases = new Set<string>()
  /**
   * Per-session FIFO of turns accepted while status is streaming for harnesses
   * without a live inject channel (e.g. Codex). Claude uses concurrent
   * beginTurn + long-lived SDK session instead.
   */
  private readonly turnQueues = new Map<string, TurnQueueItem[]>()
  /** In-flight runTurn count per session (for multi-turn live inject). */
  private readonly activeTurnCounts = new Map<string, number>()
  /**
   * Ephemeral system-prompt append (e.g. collaboration credential instructions).
   * Not durable in sessions table — reconstructed from grants on restart when needed.
   */
  private readonly systemPromptAppends = new Map<string, string>()

  constructor(
    private readonly store: SessionStore,
    private readonly events: SessionEventLog,
    private readonly leases: LeaseGuard,
    private readonly environmentId: string,
    private readonly turnRunner: TurnRunner,
    opts?: {
      permissionTimeoutMs?: number
      agentsConfirmTimeoutMs?: number
      hostActions?: HostActionStore | null
      /** Tests may disable or shorten the runtime sweep; production uses 30s. */
      runtimeReaperIntervalMs?: number
    },
  ) {
    this.permissionTimeoutMs = opts?.permissionTimeoutMs ?? DEFAULT_PERMISSION_TIMEOUT_MS
    this.agentsConfirmTimeoutMs =
      opts?.agentsConfirmTimeoutMs ?? DEFAULT_AGENTS_CONFIRM_TIMEOUT_MS
    this.hostActions = opts?.hostActions ?? null
    this.hydrateFromStore()
    this.reconcileAfterRestart()
    const runtimeReaperIntervalMs =
      opts?.runtimeReaperIntervalMs ?? SESSION_RUNTIME_REAPER_INTERVAL_MS
    if (
      runtimeReaperIntervalMs > 0
      && this.turnRunner.listActiveRuntimes
      && this.turnRunner.disposeSession
    ) {
      this.runtimeReaperTimer = setInterval(() => {
        void this.reapIdleRuntimes()
      }, runtimeReaperIntervalMs)
      this.runtimeReaperTimer.unref?.()
    }
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

  /** Release idle long-lived harness processes without ending resumable sessions. */
  async reapIdleRuntimes(now = Date.now()): Promise<void> {
    if (this.disposing) return
    const listActiveRuntimes = this.turnRunner.listActiveRuntimes
    const disposeSession = this.turnRunner.disposeSession
    if (!listActiveRuntimes || !disposeSession) return

    const bySession = new Map<string, ActiveHarnessRuntime>()
    for (const entry of listActiveRuntimes()) {
      const previous = bySession.get(entry.sessionId)
      bySession.set(entry.sessionId, previous
        ? {
            sessionId: entry.sessionId,
            lastActivityAt: Math.max(previous.lastActivityAt, entry.lastActivityAt),
            busy: previous.busy || entry.busy,
          }
        : entry)
    }
    if (bySession.size === 0) return

    const timeoutMs = getRuntimeIdleTimeoutMs(bySession.size)
    const releases: Promise<void>[] = []
    for (const entry of bySession.values()) {
      if (entry.busy || now - entry.lastActivityAt < timeoutMs) continue
      if (this.runtimeReleases.has(entry.sessionId)) continue
      const session = this.live.get(entry.sessionId)
      if (
        session?.status === 'streaming'
        || session?.pendingInteraction != null
        || (this.activeTurnCounts.get(entry.sessionId) ?? 0) > 0
      ) continue

      this.runtimeReleases.add(entry.sessionId)
      releases.push(
        Promise.resolve()
          .then(() => disposeSession(entry.sessionId))
          .catch(() => undefined)
          .finally(() => this.runtimeReleases.delete(entry.sessionId)),
      )
    }
    await Promise.all(releases)
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
      if (!Array.isArray(session.alwaysAllowedTools)) {
        session.alwaysAllowedTools = []
        changed = true
      }
      if (session.isUserRenamed !== true && session.isUserRenamed !== false) {
        session.isUserRenamed = false
        changed = true
      }
      if (!Array.isArray(session.tags)) {
        session.tags = []
        changed = true
      }
      if (session.isAutomation !== true && session.isAutomation !== false) {
        session.isAutomation = false
        changed = true
      }
      if (session.automationId === undefined) {
        session.automationId = null
        changed = true
      }
      // Backfill durable settings for rows loaded from older schema (pre-settings_json).
      if (session.permissionMode === undefined) {
        session.permissionMode = null
        changed = true
      }
      if (session.sandboxMode === undefined) {
        session.sandboxMode = null
        changed = true
      }
      if (session.model === undefined) {
        session.model = null
        changed = true
      }
      if (session.effort === undefined) {
        session.effort = null
        changed = true
      }
      if (session.apiProviderId === undefined) {
        session.apiProviderId = null
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
     * Pairing-level controller identity for Host Actions. Stamped at create;
     * re-pointed via {@link rebindHostActionController} when a new client
     * acquires control (re-pair / handoff).
     */
    controllerClientSessionId?: string | null
    /** Session-scoped host-action tool groups. Defaults to [browser.read] when controller is set. */
    hostActionToolGroups?: string[]
    hostActionCapabilityVersion?: number
    /** Absolute host cwd (project root or worktree). */
    cwd?: string | null
    /** Durable turn defaults applied when send omits a field. */
    permissionMode?: string | null
    sandboxMode?: string | null
    model?: string | null
    effort?: string | null
    apiProviderId?: string | null
    /**
     * Collaboration / host system-prompt append (credential instructions).
     * Ephemeral in-memory; durable grants reconstruct it after restart.
     */
    systemPromptAppend?: string | null
    /** Mark session as automation-owned (filterable in session.list metadata). */
    isAutomation?: boolean
    automationId?: string | null
  }): NodeSessionRecord {
    const now = Date.now()
    const controller =
      typeof input.controllerClientSessionId === 'string' && input.controllerClientSessionId.trim()
        ? input.controllerClientSessionId.trim()
        : null
    const automationId =
      typeof input.automationId === 'string' && input.automationId.trim()
        ? input.automationId.trim()
        : null
    const isAutomation = input.isAutomation === true || !!automationId
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
      cwd: input.cwd && input.cwd.trim() ? input.cwd.trim() : null,
      permissionMode: input.permissionMode ?? null,
      sandboxMode: input.sandboxMode ?? null,
      model: input.model ?? null,
      effort: input.effort ?? null,
      apiProviderId: input.apiProviderId ?? null,
      createdAt: now,
      updatedAt: now,
      isPinned: false,
      isHidden: false,
      isUserRenamed: false,
      tags: [],
      controllerClientSessionId: controller,
      hostActionCapabilityVersion: controller
        ? (input.hostActionCapabilityVersion ?? HOST_ACTION_CAPABILITY_VERSION)
        : 0,
      hostActionToolGroups: controller
        ? (input.hostActionToolGroups ?? [...DEFAULT_HOST_ACTION_TOOL_GROUPS])
        : [],
      alwaysAllowedTools: [],
      isAutomation,
      automationId,
    }
    this.live.set(session.sessionId, session)
    if (input.systemPromptAppend && input.systemPromptAppend.trim()) {
      this.systemPromptAppends.set(session.sessionId, input.systemPromptAppend.trim())
    }
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
        ...(session.isAutomation
          ? { isAutomation: true, automationId: session.automationId ?? null }
          : {}),
      },
    })
    return this.clone(session)
  }

  /** Collaboration system-prompt append for a live session (if any). */
  getSystemPromptAppend(sessionId: string): string | undefined {
    return this.systemPromptAppends.get(sessionId)
  }

  /** Re-attach system-prompt append after restart (from durable grants). */
  setSystemPromptAppend(sessionId: string, prompt: string | null | undefined): void {
    if (!prompt || !prompt.trim()) {
      this.systemPromptAppends.delete(sessionId)
      return
    }
    this.systemPromptAppends.set(sessionId, prompt.trim())
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
   * Move Host Action controller identity to the client that just acquired control.
   *
   * Session.create stamps controllerClientSessionId once. Normal refresh keeps the
   * same clientSessionId, but re-pair / revoke+pair issues a new id. Control lease
   * can follow the new desktop while host_actions stay addressed to the revoked
   * controller — every SuperOne MCP then times out with deadline_exceeded.
   *
   * Call this from session.acquireControl after a successful lease acquire.
   * Idempotent when the controller is already the new client.
   */
  rebindHostActionController(
    sessionId: string,
    controllerClientSessionId: string,
  ): NodeSessionRecord {
    const session = this.live.get(sessionId)
    if (!session) {
      throw Object.assign(new Error('session not found'), { code: 'not_found' })
    }
    if (session.closed || session.status === 'ended') {
      throw Object.assign(new Error('session is closed'), { code: 'failed_precondition' })
    }
    const next =
      typeof controllerClientSessionId === 'string' ? controllerClientSessionId.trim() : ''
    if (!next) {
      throw Object.assign(new Error('controllerClientSessionId required'), {
        code: 'invalid_argument',
      })
    }

    const prev = session.controllerClientSessionId
    if (prev === next) {
      return this.clone(session)
    }

    session.controllerClientSessionId = next
    // First bind (e.g. automation session later claimed by a desktop) grants HA.
    if (session.hostActionCapabilityVersion < 1) {
      session.hostActionCapabilityVersion = HOST_ACTION_CAPABILITY_VERSION
    }
    if (!session.hostActionToolGroups.length) {
      session.hostActionToolGroups = [...DEFAULT_HOST_ACTION_TOOL_GROUPS]
    }
    session.updatedAt = Date.now()
    this.persist(session)

    if (this.hostActions) {
      const { cancelled } = this.hostActions.rebindSessionController({
        sessionId: session.sessionId,
        toControllerClientSessionId: next,
      })
      for (const row of cancelled) {
        this.settleHostActionWaiter(this.hostActions.toTerminal(row))
      }
      this.wakeHostActionPollers()
    }

    return this.clone(session)
  }

  /**
   * Patch durable per-session turn defaults.
   * Only keys present in `patch` are updated; null clears a stored default.
   * Applied as `send()` fallbacks when the turn payload omits the corresponding key.
   */
  patchSettings(sessionId: string, patch: NodeSessionSettings): NodeSessionRecord {
    const session = this.live.get(sessionId)
    if (!session) throw Object.assign(new Error('session not found'), { code: 'not_found' })
    if (session.closed || session.status === 'ended') {
      throw Object.assign(new Error('session is closed'), { code: 'failed_precondition' })
    }

    const apply = (key: keyof NodeSessionSettings): void => {
      if (!(key in patch)) return
      const next = normalizeSettingValue(patch[key])
      if (next === undefined) return
      session[key] = next
    }
    apply('permissionMode')
    apply('sandboxMode')
    apply('model')
    apply('effort')
    apply('apiProviderId')

    session.updatedAt = Date.now()
    this.persist(session)
    this.events.appendSession({
      sessionId: session.sessionId,
      eventType: SESSION_DURABLE_EVENT.settingsChanged,
      payload: {
        permissionMode: session.permissionMode ?? null,
        sandboxMode: session.sandboxMode ?? null,
        model: session.model ?? null,
        effort: session.effort ?? null,
        apiProviderId: session.apiProviderId ?? null,
      },
    })
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
      // Fork inherits durable turn defaults so the child keeps model/effort/etc.
      permissionMode: source.permissionMode ?? null,
      sandboxMode: source.sandboxMode ?? null,
      model: source.model ?? null,
      effort: source.effort ?? null,
      apiProviderId: source.apiProviderId ?? null,
      createdAt: now,
      updatedAt: now,
      isPinned: false,
      isHidden: false,
      // Fork title is derived; start unlocked so agent can rename the fork.
      isUserRenamed: false,
      tags: [],
      // Fork inherits controller binding (same paired desktop).
      controllerClientSessionId: source.controllerClientSessionId,
      hostActionCapabilityVersion: source.hostActionCapabilityVersion,
      hostActionToolGroups: [...(source.hostActionToolGroups ?? [])],
      alwaysAllowedTools: [...(source.alwaysAllowedTools ?? [])],
      // Forks of automation sessions are user sessions (not automation-owned).
      isAutomation: false,
      automationId: null,
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

  list(
    projectId?: string,
    options?: { limit?: number; offset?: number },
  ): NodeSessionRecord[] {
    const rows = [...this.live.values()]
      .filter((s) => !projectId || s.projectId === projectId)
      // Newest first — pagination must sort before slice (same idea as desktop history).
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || (b.createdAt ?? 0) - (a.createdAt ?? 0))
    const offset = Math.max(0, options?.offset ?? 0)
    const limited =
      options?.limit != null && options.limit >= 0
        ? rows.slice(offset, offset + options.limit)
        : offset > 0
          ? rows.slice(offset)
          : rows
    return limited.map((s) => this.clone(s))
  }

  snapshotSequence(): string {
    return this.events.headSequence()
  }

  listEventsAfter(afterSequence: string) {
    return this.events.listAfter(afterSequence)
  }

  /**
   * Paged denser message catalog for remote UI hydrate.
   * Source of truth: durable transcript; tool summaries / optional checkpoint
   * and resume ids are expanded from the session event log when present.
   */
  listMessages(input: {
    sessionId: string
    cursor?: string | number | null
    limit?: number
  }): SessionMessagesListResult {
    const sessionId = String(input.sessionId ?? '').trim()
    if (!sessionId) {
      throw Object.assign(new Error('sessionId required'), { code: 'invalid_argument' })
    }
    const session = this.live.get(sessionId)
    if (!session) {
      throw Object.assign(new Error('session not found'), { code: 'not_found' })
    }
    const events =
      typeof this.events.listForSession === 'function'
        ? this.events.listForSession(sessionId)
        : this.events.listAfter('0', 50_000).filter(
            (e) =>
              (!e.aggregateType || e.aggregateType === 'session') &&
              (!e.aggregateId || e.aggregateId === sessionId),
          )
    const catalog = buildSessionMessageCatalog(session, events)
    return pageSessionMessageCatalog(sessionId, catalog, {
      cursor: input.cursor,
      limit: input.limit,
    })
  }

  async send(input: {
    sessionId: string
    text: string
    client: { clientSessionId: string }
    leaseId: string
    generation: string
    requestId?: string
    /** UI-selected model for this turn (optional; falls back to session.model). */
    model?: string | null
    /** Reasoning / thinking effort for this turn (falls back to session.effort). */
    effort?: string | null
    /** Inline image/document attachments for this turn. */
    images?: TurnImageAttachment[]
    /** Claude-style permission mode for this turn (falls back to session.permissionMode). */
    permissionMode?: string | null
    /** Sandbox policy for this turn (falls back to session.sandboxMode). */
    sandboxMode?: string | null
    /** Extra readable directories. */
    additionalDirectories?: string[]
    /** Claude SDK skills allow-list (desktop disabled-skills parity). */
    enabledSkills?: string[]
    /** Skills to exclude when enabledSkills is not provided. */
    disabledSkills?: string[]
    /** Node provider credential id for API keys this turn (falls back to session.apiProviderId). */
    apiProviderId?: string | null
    /** Codex turn kind (run|steer|review|compact). */
    turnKind?: 'run' | 'steer' | 'review' | 'compact' | null
    /** Codex collaboration mode. */
    collaborationMode?: string | Record<string, unknown> | null
    /** Codex review/start target. */
    reviewTarget?: unknown
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

    // Turn payload wins; omitted/empty keys fall back to durable session settings
    // so remote clients need not re-send model/effort/etc. every turn.
    const pick = (
      provided: string | null | undefined,
      stored: string | null | undefined,
    ): string | null | undefined => {
      if (typeof provided === 'string' && provided.trim()) return provided.trim()
      if (provided === null) return null
      if (typeof stored === 'string' && stored.trim()) return stored.trim()
      return stored ?? undefined
    }

    const turnKind = input.turnKind ?? null

    const turnOpts: TurnOpts = {
      text: input.text,
      requestId: input.requestId,
      model: pick(input.model, session.model),
      effort: pick(input.effort, session.effort),
      images: input.images,
      permissionMode: pick(input.permissionMode, session.permissionMode),
      sandboxMode: pick(input.sandboxMode, session.sandboxMode),
      additionalDirectories: input.additionalDirectories,
      enabledSkills: input.enabledSkills,
      disabledSkills: input.disabledSkills,
      apiProviderId: pick(input.apiProviderId, session.apiProviderId),
      turnKind,
      collaborationMode: input.collaborationMode,
      reviewTarget: input.reviewTarget,
    }

    // Always accept the user message into the durable transcript (queue or run).
    this.appendUserMessage(session, turnOpts)

    if (session.status === 'streaming') {
      // Claude accepts concurrent priority=next sends. Codex only live-injects
      // an explicit steer; ordinary composer sends serialize through the FIFO.
      const harnessId = session.harnessId || 'claude'
      const liveInject =
        harnessId === 'claude' ||
        (harnessId === 'codex' && turnOpts.turnKind === 'steer')
      if (liveInject) {
        this.beginTurn(session, turnOpts)
        return this.clone(session)
      }
      const q = this.turnQueues.get(session.sessionId) ?? []
      q.push(turnOpts)
      this.turnQueues.set(session.sessionId, q)
      this.events.appendSession({
        sessionId: session.sessionId,
        eventType: SESSION_DURABLE_EVENT.statusChanged,
        payload: { status: 'streaming', queued: true },
        causationRequestId: input.requestId,
      })
      return this.clone(session)
    }

    this.beginTurn(session, turnOpts)
    return this.clone(session)
  }

  /**
   * Host-initiated turn without a control lease (collaboration initial task).
   * Still rejects closed/disposing sessions. Falls back to durable session settings.
   */
  async sendWithoutLease(input: {
    sessionId: string
    text: string
    requestId?: string
    model?: string | null
    effort?: string | null
    permissionMode?: string | null
    sandboxMode?: string | null
    apiProviderId?: string | null
    /** Host-origin synthetic turn (peer mailbox wake). */
    source?: 'user' | 'task-notification'
  }): Promise<NodeSessionRecord> {
    if (this.disposing) {
      throw Object.assign(new Error('runtime is shutting down'), { code: 'failed_precondition' })
    }
    const session = this.live.get(input.sessionId)
    if (!session) throw Object.assign(new Error('session not found'), { code: 'not_found' })
    if (session.closed || session.status === 'ended') {
      throw Object.assign(new Error('session is closed'), { code: 'failed_precondition' })
    }

    const pick = (
      provided: string | null | undefined,
      stored: string | null | undefined,
    ): string | null | undefined => {
      if (typeof provided === 'string' && provided.trim()) return provided.trim()
      if (provided === null) return null
      if (typeof stored === 'string' && stored.trim()) return stored.trim()
      return stored ?? undefined
    }

    const turnOpts: TurnOpts = {
      text: input.text,
      requestId: input.requestId,
      model: pick(input.model, session.model),
      effort: pick(input.effort, session.effort),
      permissionMode: pick(input.permissionMode, session.permissionMode),
      sandboxMode: pick(input.sandboxMode, session.sandboxMode),
      apiProviderId: pick(input.apiProviderId, session.apiProviderId),
      source: input.source,
    }

    this.appendUserMessage(session, turnOpts)

    if (session.status === 'streaming') {
      // Match send(): Claude live inject + Codex mid-stream steer/run concurrent;
      // other harnesses FIFO-queue.
      let turnKind = turnOpts.turnKind ?? null
      const harnessId = session.harnessId || 'claude'
      if (!turnKind && harnessId === 'codex') {
        turnKind = 'steer'
        turnOpts.turnKind = 'steer'
      }
      const liveInject =
        harnessId === 'claude' ||
        (harnessId === 'codex' && (turnKind === 'steer' || turnKind === 'run'))
      if (liveInject) {
        if (harnessId === 'codex' && turnOpts.turnKind === 'run') {
          turnOpts.turnKind = 'steer'
        }
        this.beginTurn(session, turnOpts)
        return this.clone(session)
      }
      const q = this.turnQueues.get(session.sessionId) ?? []
      q.push(turnOpts)
      this.turnQueues.set(session.sessionId, q)
      this.events.appendSession({
        sessionId: session.sessionId,
        eventType: SESSION_DURABLE_EVENT.statusChanged,
        payload: { status: 'streaming', queued: true },
        causationRequestId: input.requestId,
      })
      return this.clone(session)
    }

    this.beginTurn(session, turnOpts)
    return this.clone(session)
  }

  private appendUserMessage(session: NodeSessionRecord, opts: TurnOpts): void {
    // Model still receives full opts.text (incl. collab credential); transcript
    // stores a redacted copy for task-notification wakes.
    const displayText =
      opts.source === 'task-notification'
        ? redactTaskNotificationForDisplay(opts.text)
        : opts.text
    const userBlock: TranscriptBlock = {
      id: randomUUID(),
      role: 'user',
      text: displayText,
      createdAt: Date.now(),
    }
    session.transcript.push(userBlock)
    session.updatedAt = Date.now()

    let autoTitle: string | null = null
    if (!session.title || !session.title.trim()) {
      autoTitle = deriveSessionTitleFromUserText(displayText)
      if (autoTitle) session.title = autoTitle
    }

    this.persist(session)
    this.events.appendSession({
      sessionId: session.sessionId,
      eventType: SESSION_DURABLE_EVENT.userMessage,
      payload: {
        blockId: userBlock.id,
        text: displayText,
        ...(opts.source ? { source: opts.source } : {}),
      },
      causationRequestId: opts.requestId,
    })
    if (autoTitle) {
      this.events.appendSession({
        sessionId: session.sessionId,
        eventType: SESSION_DURABLE_EVENT.renamed,
        payload: { title: autoTitle, source: 'agent' },
        causationRequestId: opts.requestId,
      })
    }
  }

  private beginTurn(session: NodeSessionRecord, opts: TurnOpts): void {
    const sid = session.sessionId
    const prev = this.activeTurnCounts.get(sid) ?? 0
    this.activeTurnCounts.set(sid, prev + 1)

    session.status = 'streaming'
    session.updatedAt = Date.now()
    this.persist(session)
    // Only emit turnStarted for the first concurrent turn (avoid spam on inject).
    if (prev === 0) {
      this.events.appendSession({
        sessionId: sid,
        eventType: SESSION_DURABLE_EVENT.turnStarted,
        payload: { status: 'streaming' },
        causationRequestId: opts.requestId,
      })
    }

    // Per-turn abort; keep session-level aborts map for interrupt of "current".
    const abort = new AbortController()
    const aborts = this.aborts.get(sid) ?? new Set<AbortController>()
    aborts.add(abort)
    this.aborts.set(sid, aborts)
    const turnPromise = this.runTurn(session, opts, abort)
    this.inFlightTurns.add(turnPromise)
    void turnPromise.finally(() => {
      this.inFlightTurns.delete(turnPromise)
      // activeTurnCounts is decremented inside runTurn.finally *before* idle/FIFO
      // decisions so concurrent completions never both observe a stale count.
    })
  }

  private async runTurn(
    session: NodeSessionRecord,
    opts: TurnOpts,
    abort: AbortController,
  ): Promise<void> {
    const assistantId = randomUUID()
    let assistantText = ''
    const requestId = opts.requestId
    const permissionMode =
      typeof opts.permissionMode === 'string' && opts.permissionMode.trim()
        ? opts.permissionMode.trim()
        : undefined
    const sandboxMode =
      typeof opts.sandboxMode === 'string' && opts.sandboxMode.trim()
        ? opts.sandboxMode.trim()
        : undefined
    try {
      const result = await this.turnRunner({
        session: this.clone(session),
        messageId: assistantId,
        text: opts.text,
        model: opts.model && opts.model.trim() ? opts.model.trim() : undefined,
        effort: opts.effort && opts.effort.trim() ? opts.effort.trim() : undefined,
        images: opts.images && opts.images.length > 0 ? opts.images : undefined,
        permissionMode,
        sandboxMode,
        additionalDirectories: opts.additionalDirectories?.filter(Boolean),
        enabledSkills: opts.enabledSkills?.filter((s) => typeof s === 'string' && s.trim()),
        disabledSkills: opts.disabledSkills?.filter((s) => typeof s === 'string' && s.trim()),
        apiProviderId:
          opts.apiProviderId && opts.apiProviderId.trim() ? opts.apiProviderId.trim() : undefined,
        turnKind: opts.turnKind ?? undefined,
        collaborationMode: opts.collaborationMode ?? undefined,
        reviewTarget: opts.reviewTarget,
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
        onPermission: (interaction) => {
          // Modes that skip interactive permission prompts (desktop parity).
          if (
            permissionMode === 'bypassPermissions' ||
            permissionMode === 'dontAsk' ||
            permissionMode === 'acceptEdits'
          ) {
            return Promise.resolve('allow' as PermissionDecision)
          }
          const tool = interaction.toolName?.trim()
          if (tool && session.alwaysAllowedTools?.includes(tool)) {
            return Promise.resolve('allow' as PermissionDecision)
          }
          return this.waitForPermissionDecision(session, interaction, abort.signal, requestId)
        },
        onQuestion: (interaction) =>
          this.waitForQuestionDecision(session, interaction, abort.signal, requestId),
        onPlan: (interaction) =>
          this.waitForPlanDecision(session, interaction, abort.signal, requestId),
      })

      if (session.closed) {
        // close() already tombstoned the session; do not overwrite status.
      } else if (abort.signal.aborted) {
        session.status = 'interrupted'
        this.events.appendSession({
          sessionId: session.sessionId,
          eventType: SESSION_DURABLE_EVENT.turnInterrupted,
          payload: { reason: 'client_interrupt' },
          causationRequestId: requestId,
        })
      } else {
        assistantText = result.finalText || assistantText
        session.providerResume = result.providerResume ?? session.providerResume
        if (!result.skipAssistantTranscript) {
          session.transcript.push({
            id: assistantId,
            role: 'assistant',
            text: assistantText,
            createdAt: Date.now(),
          })
          this.events.appendSession({
            sessionId: session.sessionId,
            eventType: SESSION_DURABLE_EVENT.assistantMessage,
            payload: { blockId: assistantId, text: assistantText },
            causationRequestId: requestId,
          })
        }
        // Stay streaming if more concurrent turns or FIFO items remain.
        // Count is decremented in finally; peek peers as (count - 1).
        const remainingPeers = Math.max(0, (this.activeTurnCounts.get(session.sessionId) ?? 1) - 1)
        const fifo = this.turnQueues.get(session.sessionId)?.length ?? 0
        if (remainingPeers > 0 || fifo > 0) {
          session.status = 'streaming'
        } else {
          session.status = 'idle'
          this.events.appendSession({
            sessionId: session.sessionId,
            eventType: SESSION_DURABLE_EVENT.turnCompleted,
            payload: { status: 'idle' },
            causationRequestId: requestId,
          })
        }
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
        // Only mark error if this is the last active turn.
        const remainingPeers = Math.max(0, (this.activeTurnCounts.get(session.sessionId) ?? 1) - 1)
        if (remainingPeers <= 0) {
          session.status = 'error'
          this.events.appendSession({
            sessionId: session.sessionId,
            eventType: SESSION_DURABLE_EVENT.turnError,
            payload: { message: (err as Error).message },
          })
        }
      }
    } finally {
      const sid = session.sessionId
      // Decrement first so concurrent completions and FIFO drain see accurate counts.
      const remainingAfter = Math.max(0, (this.activeTurnCounts.get(sid) ?? 1) - 1)
      if (remainingAfter <= 0) this.activeTurnCounts.delete(sid)
      else this.activeTurnCounts.set(sid, remainingAfter)

      // Claude may have multiple injected turns in flight. Cancelling all
      // session actions when the first one settles would abort tools owned by
      // the remaining turn. Keep the historical eager cancellation for a
      // single-turn/FIFO session, but defer shared cleanup until the final
      // concurrent turn has finished.
      if (!session.closed && remainingAfter <= 0) {
        this.cancelHostActionsForSession(sid, 'turn_ended')
      }
      if (!session.closed) {
        session.updatedAt = Date.now()
        this.persist(session)
      }

      // Drain FIFO queue (non-live-inject harnesses). Claude/Codex live inject uses concurrent beginTurn.
      if (
        !session.closed &&
        remainingAfter <= 0 &&
        (session.status === 'idle' || session.status === 'streaming')
      ) {
        const q = this.turnQueues.get(sid)
        const next = q?.shift()
        if (next) {
          if (q && q.length === 0) this.turnQueues.delete(sid)
          // beginTurn will set streaming again
          this.beginTurn(session, next)
        } else {
          this.turnQueues.delete(sid)
          if (session.status === 'streaming') {
            // No more work — settle idle if we stayed streaming for injects.
            session.status = 'idle'
            this.events.appendSession({
              sessionId: sid,
              eventType: SESSION_DURABLE_EVENT.turnCompleted,
              payload: { status: 'idle' },
            })
            this.persist(session)
          }
        }
      } else if (session.closed || session.status === 'interrupted' || session.status === 'error') {
        this.turnQueues.delete(sid)
      }

      const activeAborts = this.aborts.get(sid)
      if (activeAborts) {
        activeAborts.delete(abort)
        if (activeAborts.size === 0) this.aborts.delete(sid)
      }
    }
  }

  close(sessionId: string): void {
    const session = this.live.get(sessionId)
    if (!session) throw Object.assign(new Error('session not found'), { code: 'not_found' })
    if (session.closed) return
    const aborts = this.aborts.get(sessionId)
    for (const abort of aborts ?? []) abort.abort()
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
    // Long-lived harnesses (ClaudeLiveSession) must drop their SDK process /
    // host-action MCP when the SuperOne session ends.
    void Promise.resolve(this.turnRunner.disposeSession?.(sessionId)).catch(() => undefined)
  }

  /** Soft-delete: close + remove from registry (disk files untouched). */
  remove(sessionId: string): NodeSessionRecord | null {
    const session = this.live.get(sessionId)
    if (!session) return null
    if (!session.closed) this.close(sessionId)
    // close() already requested disposeSession; call again so remove after a
    // previously-closed session still cleans long-lived harness state.
    void Promise.resolve(this.turnRunner.disposeSession?.(sessionId)).catch(() => undefined)
    this.live.delete(sessionId)
    this.store.delete(sessionId)
    this.events.appendSession({
      sessionId,
      eventType: SESSION_DURABLE_EVENT.removed,
      payload: {},
    })
    return this.clone(session)
  }

  /**
   * Rename a session title.
   * @param source `'user'` (sidebar) locks out further agent renames;
   *   `'agent'` (session_rename tool) is rejected when locked.
   */
  rename(
    sessionId: string,
    title: string,
    source: 'user' | 'agent' = 'user',
  ): NodeSessionRecord {
    const session = this.live.get(sessionId)
    if (!session) throw Object.assign(new Error('session not found'), { code: 'not_found' })
    if (session.closed) {
      throw Object.assign(new Error('session is closed'), { code: 'failed_precondition' })
    }
    if (source === 'agent' && session.isUserRenamed) {
      throw Object.assign(new Error('user_locked'), { code: 'user_locked' })
    }
    session.title = title.trim() || null
    if (source === 'user') {
      session.isUserRenamed = true
    }
    session.updatedAt = Date.now()
    this.persist(session)
    this.events.appendSession({
      sessionId: session.sessionId,
      eventType: SESSION_DURABLE_EVENT.renamed,
      payload: { title: session.title, source },
    })
    return this.clone(session)
  }

  setTags(sessionId: string, tags: string[]): NodeSessionRecord {
    const session = this.live.get(sessionId)
    if (!session) throw Object.assign(new Error('session not found'), { code: 'not_found' })
    if (session.closed) {
      throw Object.assign(new Error('session is closed'), { code: 'failed_precondition' })
    }
    session.tags = [...tags]
    session.updatedAt = Date.now()
    this.persist(session)
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
    const aborts = this.aborts.get(sessionId)
    for (const abort of aborts ?? []) abort.abort()
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
      const turnAbort = this.aborts.get(session.sessionId)?.values().next().value?.signal
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
    /** Multi-launch form edits / feedback (session_agents_confirm). */
    formAnswers?: Record<string, unknown>
    /** True when the UI cancelled the multi-launch dialog. */
    cancel?: boolean
  }): void {
    const session = this.live.get(input.sessionId)
    if (!session) throw Object.assign(new Error('session not found'), { code: 'not_found' })
    this.leases.assertValid({
      resource: { environmentId: this.environmentId, sessionId: input.sessionId },
      leaseId: input.leaseId,
      generation: input.generation,
      holderClientId: input.client.clientSessionId,
    })
    const pending = session.pendingInteraction
    if (!pending || pending.interactionId !== input.interactionId) {
      throw Object.assign(new Error('no matching pending permission'), { code: 'failed_precondition' })
    }

    // Multi-launch agent collaboration confirm (session_collab_request).
    if (pending.kind === 'session_agents_confirm') {
      const waiter = this.agentsConfirmWaiters.get(input.interactionId)
      if (!waiter || waiter.sessionId !== input.sessionId) {
        throw Object.assign(new Error('no matching pending agents confirm'), {
          code: 'failed_precondition',
        })
      }
      let action: AgentsConfirmOutcome['action']
      if (input.cancel === true) action = 'cancel'
      else if (input.decision === 'deny') action = 'decline'
      else action = 'accept'
      waiter.settle({
        action,
        content: input.formAnswers,
        reason: 'responded',
      })
      return
    }

    if (pending.kind && pending.kind !== 'permission') {
      throw Object.assign(new Error('no matching pending permission'), { code: 'failed_precondition' })
    }
    const waiter = this.permissionWaiters.get(input.interactionId)
    if (!waiter || waiter.sessionId !== input.sessionId) {
      throw Object.assign(new Error('no matching pending permission'), { code: 'failed_precondition' })
    }
    // allow_always: allow this turn and remember the tool for the session
    // (desktop "always allow" parity — session-scoped, not global).
    const decision: PermissionDecision = input.decision === 'deny' ? 'deny' : 'allow'
    if (input.decision === 'allow_always') {
      const tool = session.pendingInteraction?.toolName?.trim()
      if (tool) {
        const list = session.alwaysAllowedTools ?? []
        if (!list.includes(tool)) {
          session.alwaysAllowedTools = [...list, tool]
          session.updatedAt = Date.now()
          this.persist(session)
        }
      }
    }
    waiter.settle({
      decision,
      reason: 'responded',
      clientDecision: input.decision,
    })
  }

  /**
   * Block until the control-lease holder accepts/declines multi-launch collab.
   * Used by node-local session_collab_request (not Host Action).
   */
  requestAgentsConfirm(input: {
    sessionId: string
    launches: unknown[]
    profiles: unknown[]
    signal?: AbortSignal
    requestId?: string
  }): Promise<AgentsConfirmOutcome> {
    const session = this.live.get(input.sessionId)
    if (!session) {
      return Promise.reject(
        Object.assign(new Error('session not found'), { code: 'not_found' }),
      )
    }
    if (session.pendingInteraction) {
      this.rejectPendingPermission(session, 'aborted')
    }

    const interaction: PendingInteraction = {
      interactionId: `sessionagents_${Date.now()}_${randomUUID().slice(0, 8)}`,
      kind: 'session_agents_confirm',
      toolName: 'session_collab_request',
      toolUseId: undefined,
      input: {},
      createdAt: Date.now(),
      requestKind: 'session_agents_confirm',
      serverName: 'superone',
      message: 'Allow this agent to start the following sessions?',
      allowAlwaysAllow: false,
      sessionAgentsConfirm: {
        launches: input.launches,
        profiles: input.profiles,
      },
    }

    return new Promise<AgentsConfirmOutcome>((resolve) => {
      let settled = false
      session.pendingInteraction = interaction
      session.updatedAt = Date.now()
      this.persist(session)
      this.events.appendSession({
        sessionId: session.sessionId,
        eventType: SESSION_DURABLE_EVENT.permissionRequested,
        payload: interaction,
        causationRequestId: input.requestId,
      })

      const settle = (result: {
        action: AgentsConfirmOutcome['action']
        content?: Record<string, unknown>
        reason: 'responded' | 'timeout' | 'aborted'
      }): void => {
        if (settled) return
        settled = true
        const waiter = this.agentsConfirmWaiters.get(interaction.interactionId)
        if (waiter) {
          clearTimeout(waiter.timer)
          this.agentsConfirmWaiters.delete(interaction.interactionId)
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
              decision:
                result.action === 'accept'
                  ? 'allow'
                  : result.action === 'cancel'
                    ? 'cancel'
                    : 'deny',
              action: result.action,
            },
          })
          resolve({ action: result.action, content: result.content })
        } else {
          this.events.appendSession({
            sessionId: session.sessionId,
            eventType:
              result.reason === 'timeout'
                ? SESSION_DURABLE_EVENT.permissionTimeout
                : SESSION_DURABLE_EVENT.permissionAborted,
            payload: { interactionId: interaction.interactionId, decision: 'deny' },
          })
          // Timeout/abort look like cancel to the tool (status: cancelled).
          resolve({ action: 'cancel' })
        }
      }

      const timer = setTimeout(() => {
        settle({ action: 'cancel', reason: 'timeout' })
      }, this.agentsConfirmTimeoutMs)

      this.agentsConfirmWaiters.set(interaction.interactionId, {
        sessionId: session.sessionId,
        settle,
        timer,
      })

      const signal = input.signal
      if (signal?.aborted) {
        settle({ action: 'cancel', reason: 'aborted' })
        return
      }
      signal?.addEventListener(
        'abort',
        () => {
          settle({ action: 'cancel', reason: 'aborted' })
        },
        { once: true },
      )
    })
  }

  respondQuestion(input: {
    sessionId: string
    interactionId: string
    answers: QuestionAnswers
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
    if (
      !session.pendingInteraction ||
      session.pendingInteraction.interactionId !== input.interactionId ||
      session.pendingInteraction.kind !== 'question'
    ) {
      throw Object.assign(new Error('no matching pending question'), { code: 'failed_precondition' })
    }
    const waiter = this.questionWaiters.get(input.interactionId)
    if (!waiter || waiter.sessionId !== input.sessionId) {
      throw Object.assign(new Error('no matching pending question'), { code: 'failed_precondition' })
    }
    waiter.settle({ answers: input.answers, reason: 'responded' })
  }

  respondPlan(input: {
    sessionId: string
    interactionId: string
    decision: 'approve' | 'reject'
    options?: Record<string, unknown>
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
    if (
      !session.pendingInteraction ||
      session.pendingInteraction.interactionId !== input.interactionId ||
      session.pendingInteraction.kind !== 'plan'
    ) {
      throw Object.assign(new Error('no matching pending plan'), { code: 'failed_precondition' })
    }
    const waiter = this.planWaiters.get(input.interactionId)
    if (!waiter || waiter.sessionId !== input.sessionId) {
      throw Object.assign(new Error('no matching pending plan'), { code: 'failed_precondition' })
    }
    waiter.settle({
      decision: input.decision,
      options: input.options,
      reason: 'responded',
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
    if (pending.kind === 'question') {
      const qw = this.questionWaiters.get(pending.interactionId)
      if (qw) qw.settle({ answers: {}, reason })
      else session.pendingInteraction = null
      return
    }
    if (pending.kind === 'plan') {
      const pw = this.planWaiters.get(pending.interactionId)
      if (pw) pw.settle({ decision: 'reject', reason })
      else session.pendingInteraction = null
      return
    }
    if (pending.kind === 'session_agents_confirm') {
      const aw = this.agentsConfirmWaiters.get(pending.interactionId)
      if (aw) aw.settle({ action: 'cancel', reason })
      else session.pendingInteraction = null
      return
    }
    const waiter = this.permissionWaiters.get(pending.interactionId)
    if (waiter) {
      waiter.settle({ decision: 'deny', reason })
    } else {
      session.pendingInteraction = null
    }
  }

  private waitForQuestionDecision(
    session: NodeSessionRecord,
    interaction: PendingInteraction,
    signal: AbortSignal,
    requestId?: string,
  ): Promise<QuestionAnswers> {
    if (session.pendingInteraction) {
      this.rejectPendingPermission(session, 'aborted')
    }
    const pending: PendingInteraction = { ...interaction, kind: 'question' }
    return new Promise<QuestionAnswers>((resolve) => {
      let settled = false
      session.pendingInteraction = pending
      session.updatedAt = Date.now()
      this.persist(session)
      this.events.appendSession({
        sessionId: session.sessionId,
        eventType: SESSION_DURABLE_EVENT.questionRequested,
        payload: pending,
        causationRequestId: requestId,
      })

      const settle = (result: {
        answers: QuestionAnswers
        reason: 'responded' | 'timeout' | 'aborted'
      }): void => {
        if (settled) return
        settled = true
        const waiter = this.questionWaiters.get(pending.interactionId)
        if (waiter) {
          clearTimeout(waiter.timer)
          this.questionWaiters.delete(pending.interactionId)
        }
        if (session.pendingInteraction?.interactionId === pending.interactionId) {
          session.pendingInteraction = null
          session.updatedAt = Date.now()
          this.persist(session)
        }
        if (result.reason === 'responded') {
          this.events.appendSession({
            sessionId: session.sessionId,
            eventType: SESSION_DURABLE_EVENT.questionResponded,
            payload: { interactionId: pending.interactionId, answers: result.answers },
          })
        } else if (result.reason === 'timeout') {
          this.events.appendSession({
            sessionId: session.sessionId,
            eventType: SESSION_DURABLE_EVENT.questionTimeout,
            payload: { interactionId: pending.interactionId },
          })
        } else {
          this.events.appendSession({
            sessionId: session.sessionId,
            eventType: SESSION_DURABLE_EVENT.questionAborted,
            payload: { interactionId: pending.interactionId },
          })
        }
        resolve(result.answers)
      }

      const timer = setTimeout(() => {
        settle({ answers: {}, reason: 'timeout' })
      }, this.permissionTimeoutMs)

      this.questionWaiters.set(pending.interactionId, {
        sessionId: session.sessionId,
        settle,
        timer,
      })

      if (signal.aborted) {
        settle({ answers: {}, reason: 'aborted' })
        return
      }
      signal.addEventListener(
        'abort',
        () => {
          settle({ answers: {}, reason: 'aborted' })
        },
        { once: true },
      )
    })
  }

  private waitForPlanDecision(
    session: NodeSessionRecord,
    interaction: PendingInteraction,
    signal: AbortSignal,
    requestId?: string,
  ): Promise<PlanDecisionResult> {
    if (session.pendingInteraction) {
      this.rejectPendingPermission(session, 'aborted')
    }
    const pending: PendingInteraction = { ...interaction, kind: 'plan' }
    return new Promise<PlanDecisionResult>((resolve) => {
      let settled = false
      session.pendingInteraction = pending
      session.updatedAt = Date.now()
      this.persist(session)
      this.events.appendSession({
        sessionId: session.sessionId,
        eventType: SESSION_DURABLE_EVENT.planRequested,
        payload: pending,
        causationRequestId: requestId,
      })

      const settle = (result: {
        decision: 'approve' | 'reject'
        options?: Record<string, unknown>
        reason: 'responded' | 'timeout' | 'aborted'
      }): void => {
        if (settled) return
        settled = true
        const waiter = this.planWaiters.get(pending.interactionId)
        if (waiter) {
          clearTimeout(waiter.timer)
          this.planWaiters.delete(pending.interactionId)
        }
        if (session.pendingInteraction?.interactionId === pending.interactionId) {
          session.pendingInteraction = null
          session.updatedAt = Date.now()
          this.persist(session)
        }
        if (result.reason === 'responded') {
          this.events.appendSession({
            sessionId: session.sessionId,
            eventType: SESSION_DURABLE_EVENT.planResponded,
            payload: {
              interactionId: pending.interactionId,
              decision: result.decision,
              options: result.options,
            },
          })
        } else if (result.reason === 'timeout') {
          this.events.appendSession({
            sessionId: session.sessionId,
            eventType: SESSION_DURABLE_EVENT.planTimeout,
            payload: { interactionId: pending.interactionId, decision: 'reject' },
          })
        } else {
          this.events.appendSession({
            sessionId: session.sessionId,
            eventType: SESSION_DURABLE_EVENT.planAborted,
            payload: { interactionId: pending.interactionId, decision: 'reject' },
          })
        }
        resolve({ decision: result.decision, options: result.options })
      }

      const timer = setTimeout(() => {
        settle({ decision: 'reject', reason: 'timeout' })
      }, this.permissionTimeoutMs)

      this.planWaiters.set(pending.interactionId, {
        sessionId: session.sessionId,
        settle,
        timer,
      })

      if (signal.aborted) {
        settle({ decision: 'reject', reason: 'aborted' })
        return
      }
      signal.addEventListener(
        'abort',
        () => {
          settle({ decision: 'reject', reason: 'aborted' })
        },
        { once: true },
      )
    })
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
    if (this.runtimeReaperTimer) {
      clearInterval(this.runtimeReaperTimer)
      this.runtimeReaperTimer = null
    }
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
    for (const aborts of this.aborts.values()) {
      for (const abort of aborts) abort.abort()
    }

    while (this.inFlightTurns.size > 0 && Date.now() < deadline) {
      for (const aborts of this.aborts.values()) {
        for (const abort of aborts) abort.abort()
      }
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
    // Release long-lived Claude SDK processes after turns have been aborted.
    await Promise.resolve(this.turnRunner.disposeAll?.()).catch(() => undefined)
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
      isUserRenamed: s.isUserRenamed === true,
      tags: [...(s.tags ?? [])],
      controllerClientSessionId: s.controllerClientSessionId ?? null,
      hostActionCapabilityVersion: s.hostActionCapabilityVersion ?? 0,
      hostActionToolGroups: [...(s.hostActionToolGroups ?? [])],
      alwaysAllowedTools: [...(s.alwaysAllowedTools ?? [])],
      permissionMode: s.permissionMode ?? null,
      sandboxMode: s.sandboxMode ?? null,
      model: s.model ?? null,
      effort: s.effort ?? null,
      apiProviderId: s.apiProviderId ?? null,
      isAutomation: s.isAutomation === true,
      automationId: s.automationId ?? null,
    }
  }
}

/** Default test/sim harness: streams chunks, optionally requests permission / tools. */
export function createSimulatedTurnRunner(opts?: {
  chunks?: string[]
  delayMs?: number
  requestPermission?: boolean
  /** When true, parks on onQuestion before streaming. */
  requestQuestion?: boolean
  /** When true, parks on onPlan before streaming. */
  requestPlan?: boolean
  /**
   * When true, emit Stage 5-A structured onEvent tool/status events in addition
   * to onDelta text (for contract tests). Codex production path does not use this.
   */
  emitStructuredEvents?: boolean
}): TurnRunner {
  const chunks = opts?.chunks ?? ['Hello', ' from', ' remote', ' Codex']
  const delayMs = opts?.delayMs ?? 30
  return async ({ onDelta, onEvent, onPermission, onQuestion, onPlan, signal }) => {
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
    if (opts?.requestQuestion && onQuestion) {
      await onQuestion({
        interactionId: randomUUID(),
        kind: 'question',
        toolName: 'AskUserQuestion',
        input: {
          questions: [{ question: 'Continue?', header: 'Confirm', options: [{ label: 'Yes' }] }],
        },
        createdAt: Date.now(),
      })
    }
    if (opts?.requestPlan && onPlan) {
      const plan = await onPlan({
        interactionId: randomUUID(),
        kind: 'plan',
        toolName: 'ExitPlanMode',
        input: { plan: 'Do the work' },
        createdAt: Date.now(),
      })
      if (plan.decision === 'reject') {
        onEvent?.({ kind: 'status', status: 'idle', message: 'plan_rejected' })
        return { finalText: 'Plan rejected.', providerResume: null }
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
