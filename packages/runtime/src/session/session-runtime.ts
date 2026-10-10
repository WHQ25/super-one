import { createMcpAppResourceGc } from '../mcp-apps/resource-gc'
import type { McpAppResourceStore, McpAppResourceSnapshot } from '@superone/shared/mcp-app-resource'
import { parseMessageDisplay, type MessageDisplayFields } from '@superone/shared/message-display'
import { McpAppsError, type McpAppsBinding, type McpAppOrigin, type McpAppsProvider } from '@superone/shared/mcp-apps'
import type { McpAppAttachmentUpdate } from '@superone/shared/mcp-apps'
import { mcpAppResourceHashes, mcpAppModelContextInput, mcpAppModelInput, validateMcpAppAttachmentUpdate } from '@superone/shared/mcp-apps-state'
import { McpAppAttachmentIndex } from './mcp-apps-index'
import type { McpAppsResolvedAttachment } from '@superone/shared/environment/mcp-apps-state-rpc'
import { assertCodexAccountSwitchAllowed } from '@superone/shared/codex-accounts'
import { randomUUID } from 'node:crypto'
import type { AgentEvent, ChatMessage, ChatMessageSource } from '@superone/shared/agent-types'
import { isAgentOutputEvent } from '@superone/shared/send-failure'
import { MOD_UI_MUTATING_OPS, MOD_UI_UNAVAILABLE, asNodeCallerModUiRequest, asNodeReaderModEvent, type ModUiOp, type ModUiRequest, type ModUiResult } from '@superone/shared/mod-ui'
import { acceptedElicitationContent } from '@superone/shared/schema-form'
import {
  DEFAULT_HOST_ACTION_TOOL_GROUPS,
  HOST_ACTION_CAPABILITY_VERSION,
  projectSessionTurnEvent,
  SESSION_DURABLE_EVENT,
  type ClaimHostActionResult,
  type HostActionChange,
  type HostActionPublicView,
  type HostActionsPollResult,
  type HostActionTerminalResult,
  type RespondHostActionResult,
  type SessionLoadResult,
  type SessionMessagesListResult,
  type EnvironmentEventEnvelope,
  type SessionRef,
} from '@superone/shared/environment'
import {
  pageSessionMessageCatalog,
} from './message-catalog'
import { stripMiniAppMarkup } from '@superone/shared/miniapp-prompt-tags'
import { SESSION_TITLE_MAX_CHARS } from '@superone/shared/session-title'
import { isModelOnlyHostWake } from '@superone/shared/host-wake'
import type { LeaseGuard, SessionEventLog, SessionStore } from './ports'
import type { SessionReadModel } from './read-model'
import { chatMessageToSessionMessageBlock } from '@superone/shared/node-message-catalog'
import type { HostActionStore } from './host-action-store'
import { HostActionChannel } from './host-action-channel'
import { collaborationSystemPrompt } from '../collaboration/text'
import {
  type ActiveHarnessRuntime,
  type AgentsConfirmOutcome,
  type ElicitationDecision,
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

// TurnImageAttachment used by TurnOpts / send queue.

/** Match desktop extractClaudeTitle: first user text, stripped, capped at SESSION_TITLE_MAX_CHARS. */
export function deriveSessionTitleFromUserText(text: string): string | null {
  const cleaned = stripMiniAppMarkup(text).trim().replace(/\s+/g, ' ')
  if (!cleaned) return null
  return cleaned.length > SESSION_TITLE_MAX_CHARS ? `${cleaned.slice(0, SESSION_TITLE_MAX_CHARS)}…` : cleaned
}

/** Match desktop session-fork title: append " (fork)" once. */
export function forkSessionTitle(title: string | null): string {
  const base = title?.trim() || 'Session'
  return base.endsWith('(fork)') ? base : `${base} (fork)`
}

export type {
  ActiveHarnessRuntime,
  AgentsConfirmOutcome,
  ElicitationDecision,
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
export type { LeaseGuard, SessionEventLog, SessionStore } from './ports'

interface PermissionResponse {
  decision: PermissionDecision
  reason: 'responded' | 'aborted'
  clientDecision?: 'allow' | 'deny' | 'allow_always'
  formAnswers?: Record<string, unknown>
  cancel?: boolean
}

interface PermissionWaiter {
  sessionId: string
  /**
   * Single-settlement path for respond / timeout / abort.
   * Always resolves the runner Promise exactly once.
   */
  settle: (result: PermissionResponse) => void
}

interface QuestionWaiter {
  sessionId: string
  settle: (result: {
    answers: QuestionAnswers
    reason: 'responded' | 'aborted'
  }) => void
}

interface PlanWaiter {
  sessionId: string
  settle: (result: {
    decision: 'approve' | 'reject'
    options?: Record<string, unknown>
    reason: 'responded' | 'aborted'
  }) => void
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
interface TurnOpts extends MessageDisplayFields {
  clientMessageId?: string
  echoUserMessage?: boolean
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
   * Who wrote the text (see TurnRunner `source`). Transcript/events store a
   * redacted copy so collaboration credentials never leak into the UI snapshot.
   */
  source?: ChatMessageSource
  /** Claude Ultracode from this turn on; omitted keeps the live process's. */
  ultracode?: boolean
  /** The transcript user row this turn runs; absent for a model-only host wake. */
  userBlockId?: string
}

/** A queued message whose turn never started because the node restarted. */
const QUEUED_SEND_LOST_ON_RESTART = 'The node restarted before this queued message ran'
/** A queued message dropped because the turn ahead of it stopped or failed. */
const QUEUED_SEND_DROPPED = 'The turn before this queued message stopped, so it did not run'

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
export class SessionRuntime {
  /** Host context changes invalidate this; ordinary sends do not rescan the event log. */
  private readonly mcpAppContexts = new Map<string, ReturnType<typeof mcpAppModelContextInput>>()
  private readonly mcpAppIndex = new McpAppAttachmentIndex()
  private readonly aborts = new Map<string, Set<AbortController>>()
  private readonly live = new Map<string, NodeSessionRecord>()
  /** In-flight turn promises (including runner cleanup / process kill). */
  private readonly inFlightTurns = new Set<Promise<void>>()
  /** Set synchronously at the start of dispose(); rejects new send(). */
  private disposing = false
  /**
   * Active permission waiters keyed by interactionId.
   * respondPermission resolves these; abort/close deny them.
   */
  private readonly permissionWaiters = new Map<string, PermissionWaiter>()
  private readonly questionWaiters = new Map<string, QuestionWaiter>()
  private readonly planWaiters = new Map<string, PlanWaiter>()
  private readonly agentsConfirmWaiters = new Map<string, AgentsConfirmWaiter>()
  private readonly defaultApiProviderId?: (harnessId: string) => string | null
  private readonly agentsConfirmTimeoutMs: number
  private readonly mcpAppResources?: McpAppResourceStore
  private readonly mcpAppGc?: ReturnType<typeof createMcpAppResourceGc>
  private readonly hostActions: HostActionStore | null
  private readonly hostActionChannel: HostActionChannel | null
  private readonly readModel: SessionReadModel | null
  private runtimeReaperTimer: ReturnType<typeof setInterval> | null = null
  async getMcpAppsProvider(binding: McpAppsBinding, origin: McpAppOrigin): Promise<McpAppsProvider> {
    const session = this.get(binding.session)
    if (!session || binding.node !== this.environmentId || !this.turnRunner.getMcpAppsProvider) throw new McpAppsError('not_connected', 'MCP Apps provider is unavailable')
    return this.turnRunner.getMcpAppsProvider(session, binding, origin, {
      onElicitation: (interaction, signal) => this.requestElicitation(session.sessionId, interaction, signal),
    })
  }

  /**
   * A view's op on the session's mod surface. Ops that change what a plugin
   * sees or does need the control lease; drawing does not.
   */
  async modUi<O extends ModUiOp>(input: {
    sessionId: string
    op: O
    request: ModUiRequest<O>
    client: { clientSessionId: string }
    leaseId?: string
    generation?: string
  }): Promise<ModUiResult<O>> {
    const session = this.live.get(input.sessionId)
    if (!session) throw Object.assign(new Error('session not found'), { code: 'not_found' })
    if (MOD_UI_MUTATING_OPS.has(input.op)) {
      this.leases.assertValid({
        resource: { environmentId: this.environmentId, sessionId: input.sessionId },
        leaseId: input.leaseId ?? '',
        generation: input.generation ?? '',
        holderClientId: input.client.clientSessionId,
      })
    }
    if (!this.turnRunner.modUi) throw Object.assign(new Error('This harness draws no mod interfaces'), { name: MOD_UI_UNAVAILABLE, code: 'unavailable' })
    return this.turnRunner.modUi(session, input.op, asNodeCallerModUiRequest(input.request, input.client.clientSessionId))
  }

  /** Live runtimes pick up a plugin change on disk; released ones load it at their next start. */
  async reloadPlugins(): Promise<void> {
    await this.turnRunner.reloadPlugins?.()
  }

  private readonly runtimeReleases = new Set<string>()
  /**
   * Per-session FIFO of turns accepted while status is streaming for harnesses
   * without a live inject channel (e.g. Codex). Claude uses concurrent
   * beginTurn + long-lived SDK session instead.
   */
  private readonly turnQueues = new Map<string, TurnQueueItem[]>()
  /**
   * `session + notificationId` already delivered, so a retried
   * artifact-completion RPC injects once. In memory: a node restart may let
   * one duplicate through, which is the right way round — a repeated wake is
   * noise, a lost one leaves the agent believing a path it can read is gone.
   */
  private readonly deliveredArtifactNotifications = new Set<string>()
  /** Deliveries in flight, so concurrent retries share one turn instead of racing. */
  private readonly deliveringArtifactNotifications = new Map<string, Promise<void>>()
  /** In-flight runTurn count per session (for multi-turn live inject). */
  private readonly activeTurnCounts = new Map<string, number>()
  private readonly ambientTurns = new Map<string, { messageId: string; text: string }>()
  /**
   * Ephemeral system-prompt append (e.g. collaboration credential instructions).
   * Not durable in sessions table — reconstructed from grants on restart when needed.
   */
  private readonly systemPromptAppends = new Map<string, string>()
  private readonly controllerLabel?: (clientSessionId: string) => string | null

  constructor(
    private readonly store: SessionStore,
    private readonly events: SessionEventLog,
    private readonly leases: LeaseGuard,
    private readonly environmentId: string,
    private readonly turnRunner: TurnRunner,
    opts?: {
      defaultApiProviderId?: (harnessId: string) => string | null
      agentsConfirmTimeoutMs?: number
      hostActions?: HostActionStore | null
      mcpAppResources?: McpAppResourceStore
      /** Tests may disable or shorten the runtime sweep; production uses 30s. */
      runtimeReaperIntervalMs?: number
      /** Pairing label of a controller, so its agent's launch tasks say which device sent them. */
      controllerLabel?: (clientSessionId: string) => string | null
      /**
       * Builds the read model over this runtime's sessions, before restart
       * reconciliation appends anything; messages and snapshots come from it.
       */
      readModel?: (records: { get(sessionId: string): NodeSessionRecord | null }) => SessionReadModel
    },
  ) {
    this.controllerLabel = opts?.controllerLabel
    this.defaultApiProviderId = opts?.defaultApiProviderId
    this.agentsConfirmTimeoutMs =
      opts?.agentsConfirmTimeoutMs ?? DEFAULT_AGENTS_CONFIRM_TIMEOUT_MS
    this.hostActions = opts?.hostActions ?? null
    this.hostActionChannel = this.hostActions
      ? new HostActionChannel({
          store: this.hostActions,
          session: (sessionId) => {
            const session = this.live.get(sessionId)
            if (!session) return null
            return {
              controllerClientSessionId: session.controllerClientSessionId,
              hostActionCapabilityVersion: session.hostActionCapabilityVersion,
              hostActionToolGroups: session.hostActionToolGroups,
              closed: !!session.closed || session.status === 'ended',
              streaming: session.status === 'streaming',
            }
          },
          turnSignal: (sessionId) => this.aborts.get(sessionId)?.values().next().value?.signal,
          // Observability only — never args.
          onRequested: (sessionId, actionId) => {
            this.events.appendSession({
              sessionId,
              eventType: SESSION_DURABLE_EVENT.hostActionRequested,
              payload: { actionId },
            })
          },
          isDisposing: () => this.disposing,
        })
      : null
    this.mcpAppResources = opts?.mcpAppResources
    this.hydrateFromStore()
    this.readModel = opts?.readModel?.({ get: (sessionId) => this.live.get(sessionId) ?? null }) ?? null
    this.reconcileAfterRestart()
    if (this.mcpAppResources) {
      this.mcpAppGc = createMcpAppResourceGc(this.mcpAppResources, () => mcpAppResourceHashes(this.store.loadAll().flatMap(session => this.mcpAppMessageCatalog(session.sessionId))))
      this.mcpAppGc.schedule()
    }
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
      // The prompt append is in memory only; a child of another machine's
      // session has no local grant to rebuild it from.
      if (session.externalParent) {
        this.systemPromptAppends.set(session.sessionId, collaborationSystemPrompt(session.externalParent.sessionId))
      }
    }
  }

  /**
   * After node restart, any session still marked streaming cannot reattach
   * (turnReattach=false for Phase 3 default) — mark interrupted explicitly.
   */
  private reconcileAfterRestart(): void {
    for (const session of this.live.values()) {
      let changed = false
      // Recorded as events so the read model shows the interruption, not a message streaming forever.
      if (session.status === 'streaming') {
        session.status = 'interrupted'
        changed = true
        this.events.appendSession({
          sessionId: session.sessionId,
          eventType: SESSION_DURABLE_EVENT.turnInterrupted,
          payload: { reason: 'node_restart', messageId: this.readModel?.streamingMessageId(session.sessionId) ?? undefined },
        })
      }
      // The FIFO is in memory only: what it held never ran, so each queued
      // message becomes a failed row the user can resend, rather than work the
      // node starts on its own after the turn ahead of it was interrupted.
      for (const block of session.transcript) {
        if (block.queued && this.markSendFailed(session, block.id, QUEUED_SEND_LOST_ON_RESTART)) changed = true
      }
      // No live permissionWaiters after restart — drop sticky pending UI or clients hang.
      if (session.pendingInteraction != null) {
        const { interactionId, kind } = session.pendingInteraction
        session.pendingInteraction = null
        changed = true
        this.events.appendSession({
          sessionId: session.sessionId,
          eventType: kind === 'question' ? SESSION_DURABLE_EVENT.questionAborted
            : kind === 'plan' ? SESSION_DURABLE_EVENT.planAborted
            : SESSION_DURABLE_EVENT.permissionAborted,
          payload: { interactionId, reason: 'node_restart' },
        })
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
    this.hostActionChannel?.reconcileAfterRestart()
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
    /** Collaboration parent on another machine (see {@link NodeSessionRecord.externalParent}). */
    externalParent?: { sessionId: string } | null
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
      apiProviderId: input.apiProviderId ?? this.defaultApiProviderId?.(input.harnessId ?? 'claude') ?? null,
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
      ...(input.externalParent ? { externalParent: { sessionId: input.externalParent.sessionId } } : {}),
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

    this.hostActionChannel?.rebind(session.sessionId, next)

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

    if (session.harnessId === 'codex' && 'apiProviderId' in patch) {
      assertCodexAccountSwitchAllowed(session.apiProviderId, patch.apiProviderId, session.transcript.length > 0 || session.status === 'streaming')
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

  /** Internal read-only archive projection; avoids cloning transcript bodies for header reads. */
  archiveEntries(): Iterable<Readonly<NodeSessionRecord>> {
    return this.live.values()
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

  onEventsAppended(listener: (envelope: EnvironmentEventEnvelope) => void): () => void {
    return this.events.onAppend(listener)
  }

  streamEpoch(): string {
    return this.events.epoch
  }

  streamingAfter(sessionId: string, version: number): EnvironmentEventEnvelope[] | null {
    return this.events.streamingAfter(sessionId, version)
  }

  streamingEvents(): EnvironmentEventEnvelope[] {
    return this.events.streaming()
  }

  listEventsAfter(afterSequence: string, reader?: { clientSessionId: string }): EnvironmentEventEnvelope[] {
    return this.events.listAfter(afterSequence).map((envelope) => this.viewEvent(envelope, reader))
  }

  /** Mod events are addressed per reader; a host request no longer pending reads as empty. */
  viewEvent(envelope: EnvironmentEventEnvelope, reader?: { clientSessionId: string }): EnvironmentEventEnvelope {
    if (envelope.aggregateType !== 'session' || envelope.eventType !== SESSION_DURABLE_EVENT.agentEvent) return envelope
    const payload = envelope.payload as { event?: AgentEvent } | null
    const event = payload?.event
    if (!event?.type.startsWith('mod_')) return envelope
    if (event.type === 'mod_host_request' && !this.turnRunner.isModHostRequestPending?.(envelope.aggregateId, event.requestId)) {
      return { ...envelope, payload: {} }
    }
    return reader ? { ...envelope, payload: { ...payload, event: asNodeReaderModEvent(event, reader.clientSessionId) } } : envelope
  }

  /** Paged messages for `session.messages.list`, from the read model. */
  listMessages(input: {
    sessionId: string
    cursor?: string | number | null
    limit?: number
  }): SessionMessagesListResult {
    const sessionId = String(input.sessionId ?? '').trim()
    this.requireReadModel()
    return pageSessionMessageCatalog(sessionId, this.mcpAppMessageCatalog(sessionId), {
      cursor: input.cursor,
      limit: input.limit,
    })
  }

  /** `session.load`: the session's reduced state and a page of its messages, at its current version. */
  load(input: { sessionId: string; before?: number | null; limit?: number }): SessionLoadResult {
    const sessionId = this.requireSessionId(input.sessionId)
    const snapshot = this.requireReadModel().snapshot(sessionId, { before: input.before, limit: input.limit })
    // The newest page ends with the session's last message.
    return input.before == null ? { ...snapshot, messages: this.withProviderResume(sessionId, snapshot.messages) } : snapshot
  }

  /** The session's reduced transcript now; a host without a read model keeps none. */
  messages(sessionId: string): ChatMessage[] {
    sessionId = this.requireSessionId(sessionId)
    return this.withProviderResume(sessionId, this.readModel?.messages(sessionId) ?? [])
  }

  /** The session's messages as catalog blocks; a host without a read model keeps none. */
  private mcpAppMessageCatalog(sessionId: string) {
    return this.messages(sessionId).map((message, i) => chatMessageToSessionMessageBlock(message, i))
  }

  /** The last assistant message carries the harness resume id, which forks resume from. */
  private withProviderResume(sessionId: string, messages: ChatMessage[]): ChatMessage[] {
    const resume = this.live.get(sessionId)?.providerResume
    const last = messages.at(-1)
    if (!resume || last?.role !== 'assistant' || last.resumePointId) return messages
    return [...messages.slice(0, -1), { ...last, resumePointId: resume }]
  }

  private requireSessionId(sessionId: string): string {
    if (!sessionId) {
      throw Object.assign(new Error('sessionId required'), { code: 'invalid_argument' })
    }
    if (!this.live.has(sessionId)) {
      throw Object.assign(new Error('session not found'), { code: 'not_found' })
    }
    return sessionId
  }

  private requireReadModel(): SessionReadModel {
    if (!this.readModel) throw Object.assign(new Error('this host keeps no read model'), { code: 'unsupported' })
    return this.readModel
  }

  resolveMcpAppAttachment(sessionId: string, appInstanceId: string): McpAppsResolvedAttachment {
    const target = this.mcpAppIndex.resolve(sessionId, appInstanceId, this.events.headSequence(), () => this.mcpAppMessageCatalog(sessionId))
    if (target.app.binding.node !== this.environmentId || target.app.binding.session !== sessionId) throw new McpAppsError('denied', 'MCP App attachment does not belong to this session')
    return { ...target, projectId: this.live.get(sessionId)!.projectId }
  }

  loadMcpAppResource(sessionId: string, appInstanceId: string): McpAppResourceSnapshot {
    const { app } = this.resolveMcpAppAttachment(sessionId, appInstanceId)
    if (!app.resource) throw new McpAppsError('invalid', 'Saved MCP App resource is unavailable')
    if (app.resource.html !== undefined) return app.resource as McpAppResourceSnapshot
    if (!this.mcpAppResources) throw new McpAppsError('invalid', 'Saved MCP App HTML is unavailable')
    return this.mcpAppResources.hydrate(app.resource)
  }

  updateMcpApp(sessionId: string, appInstanceId: string, update: McpAppAttachmentUpdate): void {
    const target = this.resolveMcpAppAttachment(sessionId, appInstanceId)
    const binding = target.app.binding
    // A remote writer must supply bytes; accepting a caller-chosen CAS reference
    // could attach another session's blob to an otherwise authorized View.
    if (update.resource && update.resource.html === undefined) throw new McpAppsError('invalid', 'MCP App resource updates must include HTML')

    const patch: McpAppAttachmentUpdate = {
      ...(update.resource ? { resource: update.resource.html !== undefined && this.mcpAppResources ? this.mcpAppResources.put(update.resource as McpAppResourceSnapshot) : update.resource } : {}),
      ...(update.presentation ? { presentation: update.presentation } : {}),
      ...(update.modelContext !== undefined ? { modelContext: update.modelContext ? { ...update.modelContext, source: { appInstanceId, server: binding.server } } : null } : {}),
    }
    validateMcpAppAttachmentUpdate(patch)
    this.events.appendSession({ sessionId, eventType: SESSION_DURABLE_EVENT.agentEvent, payload: {
      event: { type: 'mcp_app_updated', messageId: target.messageId, appInstanceId, update: patch } satisfies AgentEvent,
    } })
    this.mcpAppContexts.delete(sessionId)
  }

  private mcpAppContextInput(sessionId: string): ReturnType<typeof mcpAppModelContextInput> {
    const cached = this.mcpAppContexts.get(sessionId)
    if (cached !== undefined) return cached
    const text = mcpAppModelContextInput(this.mcpAppMessageCatalog(sessionId))
    this.mcpAppContexts.set(sessionId, text)
    return text
  }

  async send(input: {
    sessionId: string
    text: string
    /** Stable user block id shared by optimistic UI, live echo and history. */
    clientMessageId?: string
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
    userMessageContent?: MessageDisplayFields['userMessageContent']
    contexts?: MessageDisplayFields['contexts']
    /** A launch task from the controller's agent; named after the controller here, whatever it claims. */
    collaboration?: MessageDisplayFields['collaboration']
    echoUserMessage?: boolean
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
    /** Claude Ultracode from this turn on; omitted keeps the live process's. */
    ultracode?: boolean
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
    // Each delivery attempt carries its own RPC idempotency key, so a Resend of
    // a message this node already took (queued, running or answered) is held
    // here. Only a message that never reached the agent runs again.
    const taken = this.userRow(session, input.clientMessageId)
    if (taken && !taken.metadata?.sendFailure) return this.clone(session)

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

    const controller = input.collaboration ? this.controllerLabel?.(input.client.clientSessionId) : null
    const turnOpts: TurnOpts = {
      text: input.text,
      clientMessageId: input.clientMessageId,
      ...parseMessageDisplay(input),
      ...(input.collaboration
        ? { collaboration: { kind: 'initial_task' as const, ...(controller ? { fromSessionTitle: controller } : {}) } }
        : {}),
      echoUserMessage: input.echoUserMessage,
      requestId: input.requestId,
      model: pick(input.model, session.model),
      effort: pick(input.effort, session.effort),
      images: input.images,
      permissionMode: pick(input.permissionMode, session.permissionMode),
      sandboxMode: pick(input.sandboxMode, session.sandboxMode),
      additionalDirectories: input.additionalDirectories,
      enabledSkills: input.enabledSkills,
      disabledSkills: input.disabledSkills,
      apiProviderId: session.harnessId === 'codex' ? input.apiProviderId ?? session.apiProviderId : pick(input.apiProviderId, session.apiProviderId),
      turnKind,
      collaborationMode: input.collaborationMode,
      reviewTarget: input.reviewTarget,
      ultracode: input.ultracode,
    }

    // Always accept the user message into the durable transcript (queue or run).
    if (session.harnessId === 'codex') {
      assertCodexAccountSwitchAllowed(session.apiProviderId, turnOpts.apiProviderId, session.transcript.length > 0)
      session.apiProviderId = turnOpts.apiProviderId ?? session.apiProviderId
    }
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
      this.enqueueTurn(session, turnOpts)
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
    /** A peer's task or a host wake; absent for the user's own text. */
    source?: ChatMessageSource
    /** A launch task from an agent on this node, named after its session. */
    collaboration?: MessageDisplayFields['collaboration']
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
      apiProviderId: session.harnessId === 'codex' ? input.apiProviderId ?? session.apiProviderId : pick(input.apiProviderId, session.apiProviderId),
      source: input.source,
      ...(input.collaboration ? { collaboration: input.collaboration } : {}),
    }

    if (session.harnessId === 'codex') {
      assertCodexAccountSwitchAllowed(session.apiProviderId, turnOpts.apiProviderId, session.transcript.length > 0)
      session.apiProviderId = turnOpts.apiProviderId ?? session.apiProviderId
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
      this.enqueueTurn(session, turnOpts)
      return this.clone(session)
    }

    this.beginTurn(session, turnOpts)
    return this.clone(session)
  }

  /**
   * Deliver a host-built completion notification for finished artifact
   * transfers (`docs/architecture/session-sync-zone.md` §5.3). Controller-bound like
   * the Host Action channel, and idempotent by `notificationId` so a desktop
   * retry after a dropped ACK injects the turn once. The text is built on the
   * node from files it has confirmed — the desktop cannot inject arbitrary
   * text as a user turn through this path.
   */
  async notifyArtifactsCompleted(input: {
    sessionId: string
    controllerClientSessionId: string
    notificationId: string
    text: string
  }): Promise<{ delivered: boolean }> {
    const session = this.live.get(input.sessionId)
    if (!session) throw Object.assign(new Error('session not found'), { code: 'not_found' })
    if (!session.controllerClientSessionId || session.controllerClientSessionId !== input.controllerClientSessionId) {
      throw Object.assign(new Error('not the session controller'), { code: 'forbidden' })
    }
    // Keyed by session as well as id: two sessions' jobs are unrelated even
    // when their ids collide. Recorded only *after* the turn is accepted — a
    // receipt written before the await turns a transient failure into a
    // permanently lost notification, which is the one outcome this channel
    // exists to prevent.
    const key = `${input.sessionId}\u0000${input.notificationId}`
    // The receipt lives in the host-action store, which survives a restart;
    // the in-memory set only stands in when there is no store at all.
    const delivered = this.hostActions
      ? this.hostActions.hasDeliveredNotification(input.sessionId, input.notificationId)
      : this.deliveredArtifactNotifications.has(key)
    if (delivered) return { delivered: true }
    const existing = this.deliveringArtifactNotifications.get(key)
    if (existing) {
      await existing
      return { delivered: true }
    }
    const work = this.sendWithoutLease({ sessionId: input.sessionId, text: input.text, source: 'task-notification' })
      .then(() => {
        if (this.hostActions) {
          this.hostActions.recordDeliveredNotification(input.sessionId, input.notificationId)
          return
        }
        this.deliveredArtifactNotifications.add(key)
        if (this.deliveredArtifactNotifications.size > 4096) {
          const oldest = this.deliveredArtifactNotifications.values().next().value
          if (oldest !== undefined) this.deliveredArtifactNotifications.delete(oldest)
        }
      })
      .finally(() => this.deliveringArtifactNotifications.delete(key))
    this.deliveringArtifactNotifications.set(key, work)
    await work
    return { delivered: true }
  }

  private appendUserMessage(session: NodeSessionRecord, opts: TurnOpts): void {
    // The turn still runs; the transcript just keeps no bubble for a model-only wake.
    if (opts.source === 'task-notification' && isModelOnlyHostWake(opts.text)) return
    const failed = this.userRow(session, opts.clientMessageId)
    if (failed?.metadata?.sendFailure) {
      // Sent again under the same id: the row runs now and is no longer failed.
      const { sendFailure: _, ...metadata } = failed.metadata
      if (Object.keys(metadata).length > 0) failed.metadata = metadata
      else delete failed.metadata
      opts.userBlockId = failed.id
      session.updatedAt = Date.now()
      this.persist(session)
      this.appendAgentEvent(session.sessionId, { type: 'user_message_send_retried', clientMessageId: failed.id }, opts.requestId)
      return
    }
    const userBlock: TranscriptBlock = {
      // Keep the same canonical id in both durable history and the event log.
      // Peers still receive the message; only the sender already has this id.
      id: opts.clientMessageId || randomUUID(),
      role: 'user',
      text: opts.text,
      ...(opts.userMessageContent ? { userMessageContent: opts.userMessageContent } : {}),
      ...(opts.contexts?.length ? { contexts: opts.contexts } : {}),
      ...(opts.collaboration ? { collaboration: opts.collaboration } : {}),
      ...(opts.images?.length ? { attachments: opts.images } : {}),
      createdAt: Date.now(),
    }
    session.transcript.push(userBlock)
    opts.userBlockId = userBlock.id
    session.updatedAt = Date.now()

    let autoTitle: string | null = null
    if (!session.title || !session.title.trim()) {
      autoTitle = deriveSessionTitleFromUserText(opts.text)
      if (autoTitle) session.title = autoTitle
    }

    this.persist(session)
    this.events.appendSession({
      sessionId: session.sessionId,
      eventType: SESSION_DURABLE_EVENT.userMessage,
      payload: {
        blockId: userBlock.id,
        text: opts.text,
        ...(userBlock.userMessageContent ? { userMessageContent: userBlock.userMessageContent } : {}),
        ...(userBlock.contexts ? { contexts: userBlock.contexts } : {}),
        ...(userBlock.collaboration ? { collaboration: userBlock.collaboration } : {}),
        ...(userBlock.attachments ? { attachments: userBlock.attachments } : {}),
        ...(opts.echoUserMessage ? { echoUserMessage: true } : {}),
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

  private userRow(session: NodeSessionRecord, id: string | undefined): TranscriptBlock | undefined {
    return id ? session.transcript.find((block) => block.role === 'user' && block.id === id) : undefined
  }

  private appendAgentEvent(sessionId: string, event: AgentEvent, causationRequestId?: string): void {
    this.events.appendSession({ sessionId, eventType: SESSION_DURABLE_EVENT.agentEvent, payload: { event }, causationRequestId })
  }

  /**
   * Record that user row `id` never reached the agent, with the shared
   * `metadata.sendFailure` marker every client renders as a failed row with
   * Resend; a send of the same id then runs it again (see `send`). The caller
   * persists. False when the row is gone (a model-only wake has none).
   */
  private markSendFailed(session: NodeSessionRecord, id: string | undefined, error: string): boolean {
    const row = this.userRow(session, id)
    if (!row) return false
    delete row.queued
    row.metadata = { ...row.metadata, sendFailure: { error } }
    session.updatedAt = Date.now()
    this.appendAgentEvent(session.sessionId, { type: 'user_message_send_failed', clientMessageId: row.id, error })
    return true
  }

  /** Queue a turn behind the running one; its row is marked so a restart can tell it never ran. */
  private enqueueTurn(session: NodeSessionRecord, opts: TurnOpts): void {
    const row = this.userRow(session, opts.userBlockId)
    if (row) {
      row.queued = true
      this.persist(session)
    }
    const q = this.turnQueues.get(session.sessionId) ?? []
    q.push(opts)
    this.turnQueues.set(session.sessionId, q)
    this.events.appendSession({
      sessionId: session.sessionId,
      eventType: SESSION_DURABLE_EVENT.statusChanged,
      payload: { status: 'streaming', queued: true },
      causationRequestId: opts.requestId,
    })
  }

  private beginTurn(session: NodeSessionRecord, opts: TurnOpts): void {
    const sid = session.sessionId
    const prev = this.activeTurnCounts.get(sid) ?? 0
    this.activeTurnCounts.set(sid, prev + 1)

    const row = this.userRow(session, opts.userBlockId)
    if (row?.queued) delete row.queued
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

  private handleAmbientEvent(sessionId: string, event: AgentEvent): void {
    const session = this.live.get(sessionId)
    if (!session || session.closed || this.disposing) return
    // A mod redrawing is not session activity: deliver it without touching the
    // session's turn state or `updatedAt` (which orders the session list).
    if (event.type.startsWith('mod_')) {
      this.events.appendSession({ sessionId, eventType: SESSION_DURABLE_EVENT.agentEvent, payload: { event } })
      return
    }
    const activeUsers = this.activeTurnCounts.get(sessionId) ?? 0
    if (event.type === 'status_change' && event.status === 'idle' && activeUsers > 0) return

    if (event.type === 'message_start') {
      this.ambientTurns.set(sessionId, { messageId: event.message.id, text: '' })
      session.status = 'streaming'
      if (activeUsers === 0) {
        this.events.appendSession({ sessionId, eventType: SESSION_DURABLE_EVENT.turnStarted, payload: { status: 'streaming' } })
      }
    }

    const ambient = this.ambientTurns.get(sessionId)
    if (ambient && event.type === 'content_delta' && event.messageId === ambient.messageId && event.delta.type === 'text' && !event.delta.parentToolUseId) {
      ambient.text += event.delta.text
    }
    this.events.appendSession({ sessionId, eventType: SESSION_DURABLE_EVENT.agentEvent, payload: { event } })

    if (ambient && event.type === 'message_complete' && event.messageId === ambient.messageId) {
      const text = ambient.text || event.metadata?.resultText || ''
      session.transcript.push({ id: ambient.messageId, role: 'assistant', text, createdAt: Date.now() })
      this.events.appendSession({ sessionId, eventType: SESSION_DURABLE_EVENT.assistantMessage, payload: { blockId: ambient.messageId, text } })
      this.ambientTurns.delete(sessionId)
      if (activeUsers === 0) {
        session.status = 'idle'
        this.events.appendSession({ sessionId, eventType: SESSION_DURABLE_EVENT.turnCompleted, payload: { status: 'idle' } })
        this.cancelHostActionsForSession(sessionId, 'turn_ended')
      }
    } else if (ambient && (event.type === 'message_error' || event.type === 'message_interrupted') && event.messageId === ambient.messageId) {
      this.ambientTurns.delete(sessionId)
      if (activeUsers === 0) {
        session.status = event.type === 'message_error' ? 'error' : 'interrupted'
        this.events.appendSession({
          sessionId,
          eventType: event.type === 'message_error' ? SESSION_DURABLE_EVENT.turnError : SESSION_DURABLE_EVENT.turnInterrupted,
          payload: event.type === 'message_error' ? { message: event.error } : { reason: 'ambient_interrupted' },
        })
        this.cancelHostActionsForSession(sessionId, 'turn_ended')
      }
    }
    session.updatedAt = Date.now()
    this.persist(session)
  }

  private async runTurn(
    session: NodeSessionRecord,
    opts: TurnOpts,
    abort: AbortController,
  ): Promise<void> {
    const assistantId = randomUUID()
    let assistantText = ''
    const requestId = opts.requestId
    // Whether the harness may have acted on this message: the runner's
    // `onInputAccepted`, or — as a safety net — real output or an interaction
    // from the agent. A runner that throws before either never delivered the
    // message, so the failure is the message's, not a reply's.
    let started = false
    const markStarted = () => { started = true }
    const permissionMode =
      typeof opts.permissionMode === 'string' && opts.permissionMode.trim()
        ? opts.permissionMode.trim()
        : undefined
    const sandboxMode =
      typeof opts.sandboxMode === 'string' && opts.sandboxMode.trim()
        ? opts.sandboxMode.trim()
        : undefined
    try {
      const modelInput = mcpAppModelInput({ text: opts.text, images: opts.images?.map(image => ({ ...image, name: image.name ?? 'Attachment' })) }, this.mcpAppContextInput(session.sessionId))
      const result = await this.turnRunner({
        session: this.clone(session),
        messageId: assistantId,
        text: modelInput.text,
        model: opts.model && opts.model.trim() ? opts.model.trim() : undefined,
        effort: opts.effort && opts.effort.trim() ? opts.effort.trim() : undefined,
        images: modelInput.images?.length ? modelInput.images : undefined,
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
        source: opts.source,
        ultracode: opts.ultracode,
        signal: abort.signal,
        onInputAccepted: markStarted,
        onDelta: (delta) => {
          if (delta) started = true
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
          if (event.kind !== 'status') started = true
          this.projectOnEvent(session, event, abort.signal, requestId, (delta) => {
            assistantText += delta
          })
        },
        onAgentEvent: (event) => {
          if (isAgentOutputEvent(event)) started = true
          if (abort.signal.aborted) return
          this.appendAgentEvent(session.sessionId, event, requestId)
        },
        onAmbientEvent: (event) => this.handleAmbientEvent(session.sessionId, event),
        onPermission: (interaction) => {
          markStarted()
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
        onElicitation: (interaction, signal) => (markStarted(), this.requestElicitation(session.sessionId, interaction,
          signal ? AbortSignal.any([abort.signal, signal]) : abort.signal, requestId)),
        onQuestion: (interaction) =>
          (markStarted(), this.waitForQuestionDecision(session, interaction, abort.signal, requestId)),
        onPlan: (interaction) =>
          (markStarted(), this.waitForPlanDecision(session, interaction, abort.signal, requestId)),
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
        if (remainingPeers > 0 || fifo > 0 || this.ambientTurns.has(session.sessionId)) {
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
        if (!started && this.markSendFailed(session, opts.userBlockId, (err as Error).message)) {
          // Nothing ran: the failure sits on the row, and work queued behind it may still run.
          const fifo = this.turnQueues.get(session.sessionId)?.length ?? 0
          if (remainingPeers <= 0 && fifo === 0) {
            session.status = 'idle'
            this.events.appendSession({
              sessionId: session.sessionId,
              eventType: SESSION_DURABLE_EVENT.statusChanged,
              payload: { status: 'idle' },
              causationRequestId: requestId,
            })
          } else if (remainingPeers <= 0) {
            session.status = 'streaming'
          }
        } else if (remainingPeers <= 0) {
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
      if (!session.closed && remainingAfter <= 0 && !this.ambientTurns.has(sid)) {
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
        const dropped = this.turnQueues.get(sid) ?? []
        this.turnQueues.delete(sid)
        // Queued messages never ran: keep each as a failed row to resend.
        if (!session.closed) {
          const marked = dropped.filter((item) => this.markSendFailed(session, item.userBlockId, QUEUED_SEND_DROPPED))
          if (marked.length > 0) this.persist(session)
        }
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
    this.ambientTurns.delete(sessionId)
    const aborts = this.aborts.get(sessionId)
    for (const abort of aborts ?? []) abort.abort()
    this.aborts.delete(sessionId)
    session.closed = true
    session.status = 'ended'
    this.rejectPendingPermission(session)
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
    this.mcpAppContexts.delete(sessionId)
    this.mcpAppIndex.delete(sessionId)
    this.store.delete(sessionId)
    this.mcpAppGc?.schedule()
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
    this.events.appendSession({
      sessionId: session.sessionId,
      eventType: SESSION_DURABLE_EVENT.tagsChanged,
      payload: { tags: session.tags },
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
    const aborts = this.aborts.get(sessionId)
    for (const abort of aborts ?? []) abort.abort()
    // Standalone View forms can be pending while no model turn owns an abort.
    this.rejectPendingPermission(session)
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

  private requireHostActions(): HostActionChannel {
    if (!this.hostActionChannel) {
      throw Object.assign(new Error('host action store not configured'), { code: 'failed_precondition' })
    }
    return this.hostActionChannel
  }

  /** See {@link HostActionChannel.request}. */
  requestHostAction(input: Parameters<HostActionChannel['request']>[0]): Promise<HostActionTerminalResult> {
    if (!this.hostActionChannel) {
      return Promise.reject(
        Object.assign(new Error('host action store not configured'), { code: 'failed_precondition' }),
      )
    }
    return this.hostActionChannel.request(input)
  }

  pollHostActions(input: Parameters<HostActionChannel['poll']>[0]): Promise<HostActionsPollResult> {
    return this.requireHostActions().poll(input)
  }

  claimHostAction(input: Parameters<HostActionChannel['claim']>[0]): ClaimHostActionResult {
    return this.requireHostActions().claim(input)
  }

  renewHostActionClaim(
    input: Parameters<HostActionChannel['renew']>[0],
  ): { actionId: string; version: number; claimExpiresAt: number } {
    return this.requireHostActions().renew(input)
  }

  respondHostAction(input: Parameters<HostActionChannel['respond']>[0]): RespondHostActionResult {
    return this.requireHostActions().respond(input)
  }

  /** Test/helper: list outstanding public views for a controller. */
  listOutstandingHostActions(controllerClientSessionId: string): HostActionPublicView[] {
    return this.hostActionChannel?.listOutstanding(controllerClientSessionId) ?? []
  }

  /** Test/helper: peek a change log after sequence. */
  listHostActionChanges(
    controllerClientSessionId: string,
    afterSequence: string,
    limit = 100,
  ): HostActionChange[] {
    return this.hostActionChannel?.listChanges(controllerClientSessionId, afterSequence, limit) ?? []
  }

  private cancelHostActionsForSession(sessionId: string, reason: string): void {
    this.hostActionChannel?.cancelForSession(sessionId, reason)
  }

  respondPermission(input: {
    sessionId: string
    interactionId: string
    decision: 'allow' | 'deny' | 'allow_always'
    client: { clientSessionId: string }
    leaseId: string
    generation: string
    /** Answers for declarative forms or multi-launch confirmation. */
    formAnswers?: Record<string, unknown>
    /** True when the UI cancelled the dialog. */
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
    const decision: PermissionDecision = input.decision === 'deny' || input.cancel ? 'deny' : 'allow'
    if (pending.requestKind === 'mcp_elicitation' && decision === 'allow') {
      const accepted = acceptedElicitationContent(pending.schemaForm, input.formAnswers)
      if (!accepted.ok) throw Object.assign(new Error(accepted.reason), { code: 'failed_precondition' })
    }
    if (input.decision === 'allow_always' && pending.requestKind !== 'mcp_elicitation' && !input.cancel) {
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
      formAnswers: input.formAnswers,
      cancel: input.cancel,
    })
  }

  /** Elicitation uses the existing durable permission channel and control lease. */
  async requestElicitation(sessionId: string, interaction: PendingInteraction, signal: AbortSignal, requestId?: string): Promise<ElicitationDecision> {
    const session = this.live.get(sessionId)
    if (!session || session.closed || signal.aborted) return { action: 'cancel', content: null, _meta: null }
    const result = await this.waitForPermissionResponse(session, interaction, signal, requestId)
    if (result.reason === 'aborted' || result.cancel) return { action: 'cancel', content: null, _meta: null }
    if (result.decision === 'deny') return { action: 'decline', content: null, _meta: null }
    const accepted = acceptedElicitationContent(interaction.schemaForm, result.formAnswers)
    if (!accepted.ok) return { action: 'cancel', content: null, _meta: null }
    return { action: 'accept', content: interaction.schemaForm ? accepted.content : null,
      _meta: !interaction.schemaForm && interaction.supportsAlwaysPersist && result.clientDecision === 'allow_always' ? { persist: 'always' } : null }
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
      this.rejectPendingPermission(session)
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
   * abort / session close. Always emits a durable permission event.
   */
  private waitForPermissionDecision(
    session: NodeSessionRecord,
    interaction: PendingInteraction,
    signal: AbortSignal,
    requestId?: string,
  ): Promise<PermissionDecision> {
    return this.waitForPermissionResponse(session, interaction, signal, requestId).then(result => result.decision)
  }

  private waitForPermissionResponse(
    session: NodeSessionRecord,
    interaction: PendingInteraction,
    signal: AbortSignal,
    requestId?: string,
  ): Promise<PermissionResponse> {
    // Only one pending interaction per session (wire contract).
    if (session.pendingInteraction) {
      this.rejectPendingPermission(session)
    }

    return new Promise<PermissionResponse>((resolve) => {
      let settled = false
      const onAbort = () => settle({ decision: 'deny', reason: 'aborted' })
      session.pendingInteraction = interaction
      session.updatedAt = Date.now()
      this.persist(session)
      this.events.appendSession({
        sessionId: session.sessionId,
        eventType: SESSION_DURABLE_EVENT.permissionRequested,
        payload: interaction,
        causationRequestId: requestId,
      })

      const settle = (result: PermissionResponse): void => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', onAbort)
        this.permissionWaiters.delete(interaction.interactionId)
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
              decision: result.cancel ? 'deny' : result.clientDecision ?? result.decision,
              ...(result.cancel ? { cancel: true } : {}),
            },
          })
        } else {
          this.events.appendSession({
            sessionId: session.sessionId,
            eventType: SESSION_DURABLE_EVENT.permissionAborted,
            payload: { interactionId: interaction.interactionId, decision: 'deny' },
          })
        }
        resolve(result)
      }

      // No deadline: like the desktop, a prompt waits until answered or the turn is aborted.
      this.permissionWaiters.set(interaction.interactionId, {
        sessionId: session.sessionId,
        settle,
      })

      if (signal.aborted) {
        settle({ decision: 'deny', reason: 'aborted' })
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  /** Deny and clear any active permission waiter for this session. */
  private rejectPendingPermission(session: NodeSessionRecord): void {
    const pending = session.pendingInteraction
    if (!pending) return
    if (pending.kind === 'question') {
      const qw = this.questionWaiters.get(pending.interactionId)
      if (qw) qw.settle({ answers: {}, reason: 'aborted' })
      else session.pendingInteraction = null
      return
    }
    if (pending.kind === 'plan') {
      const pw = this.planWaiters.get(pending.interactionId)
      if (pw) pw.settle({ decision: 'reject', reason: 'aborted' })
      else session.pendingInteraction = null
      return
    }
    if (pending.kind === 'session_agents_confirm') {
      const aw = this.agentsConfirmWaiters.get(pending.interactionId)
      if (aw) aw.settle({ action: 'cancel', reason: 'aborted' })
      else session.pendingInteraction = null
      return
    }
    const waiter = this.permissionWaiters.get(pending.interactionId)
    if (waiter) {
      waiter.settle({ decision: 'deny', reason: 'aborted' })
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
      this.rejectPendingPermission(session)
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
        reason: 'responded' | 'aborted'
      }): void => {
        if (settled) return
        settled = true
        this.questionWaiters.delete(pending.interactionId)
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
        } else {
          this.events.appendSession({
            sessionId: session.sessionId,
            eventType: SESSION_DURABLE_EVENT.questionAborted,
            payload: { interactionId: pending.interactionId },
          })
        }
        resolve(result.answers)
      }

      this.questionWaiters.set(pending.interactionId, {
        sessionId: session.sessionId,
        settle,
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
      this.rejectPendingPermission(session)
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
        reason: 'responded' | 'aborted'
      }): void => {
        if (settled) return
        settled = true
        this.planWaiters.delete(pending.interactionId)
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
        } else {
          this.events.appendSession({
            sessionId: session.sessionId,
            eventType: SESSION_DURABLE_EVENT.planAborted,
            payload: { interactionId: pending.interactionId, decision: 'reject' },
          })
        }
        resolve({ decision: result.decision, options: result.options })
      }

      this.planWaiters.set(pending.interactionId, {
        sessionId: session.sessionId,
        settle,
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
    this.mcpAppGc?.dispose()
    this.disposing = true
    if (this.runtimeReaperTimer) {
      clearInterval(this.runtimeReaperTimer)
      this.runtimeReaperTimer = null
    }
    // Cancel outstanding host actions so requestHostAction waiters settle.
    for (const session of this.live.values()) {
      this.cancelHostActionsForSession(session.sessionId, 'runtime_dispose')
    }
    this.hostActionChannel?.dispose()

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
  return async ({ onInputAccepted, onDelta, onEvent, onPermission, onQuestion, onPlan, signal }) => {
    // Nothing to submit to: the simulated agent has the input as soon as it runs.
    onInputAccepted?.()
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
