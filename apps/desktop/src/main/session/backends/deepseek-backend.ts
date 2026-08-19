import { randomUUID } from 'node:crypto'
import {
  displayToolName,
  dshEffortFromSuperone,
  dshPresetForMode,
  type DeepseekAgentHandle,
  type DeepseekMcpServerSpec,
} from '@superone/deepseek'
import type {
  AgentEvent,
  ContextUsageInfo,
  McpServerInfo,
  PermissionMode,
  PermissionRequest,
  QuestionAnnotations,
  RewindFilesResult,
  SandboxInfo,
  SendMessageRequest,
} from '@superone/shared/agent-types'
import log from '../../logger'
import { addToolsChangedListener } from '../../mcp/superone-mcp-server'
import { readDshMcpServerSpecs, trackDshMcpConfig } from '../../deepseek/deepseek-mcp-sync'
import { executeSuperoneMcpTool, listSuperoneMcpTools } from '../../mcp/superone-mcp-tool-surface'
import {
  DEEPSEEK_DEFAULT_MODEL as DEFAULT_MODEL,
  DEEPSEEK_DEFAULT_PROVIDER as DEFAULT_PROVIDER,
  getDeepseekRuntime,
  registerApprovalRouter,
} from '../../deepseek/deepseek-runtime-host'
import type { BackendEvent, BackendStartOptions, HarnessId, SessionBackend } from '../types'

interface DeepseekConfig {
  provider?: string
  model?: string
  maxTokens?: number
  /**
   * The agent preset — dsh's "mode" — this session composes from. Only read at
   * creation: a resumed session recomposes from its own durable log instead,
   * and a live one switches through `switchPreset`.
   */
  agentPreset?: string
}

function readConfig(config: unknown): DeepseekConfig {
  return (config && typeof config === 'object' ? config : {}) as DeepseekConfig
}


interface PendingApproval {
  request: PermissionRequest
  event: AgentEvent
  settle: (decision: 'allowed-once' | 'rejected' | 'cancelled') => void
}

/**
 * DeepSeek Harness backend — a thin state machine over the shared in-process
 * dsh Cordis tree (docs/draft/deepseek-harness-integration.md, D1/D4). All dsh
 * vocabulary lives in `@superone/deepseek`; this class only owns SuperOne's
 * session contract.
 */
export class DeepseekBackend implements SessionBackend {
  readonly kind: HarnessId = 'dsh'

  private agent: DeepseekAgentHandle | null = null
  private startPromise: Promise<DeepseekAgentHandle> | null = null
  private opts: BackendStartOptions | null = null
  private permissionMode: PermissionMode = 'default'
  private unregisterApproval: (() => void) | null = null
  private pendingApprovals = new Map<string, PendingApproval>()

  private listeners = new Set<(event: BackendEvent) => void>()
  private providerSessionListeners = new Set<(id: string) => void>()
  private permissionModeListeners = new Set<(mode: PermissionMode) => void>()

  hasActiveRuntime(): boolean {
    return Boolean(this.agent || this.startPromise)
  }

  async releaseRuntime(_reason: 'idle'): Promise<void> {
    await this.teardownAgent()
  }

  async start(opts: BackendStartOptions): Promise<void> {
    this.opts = opts
    this.permissionMode = opts.permissionMode
    await this.ensureAgent()
  }

  async rebuild(opts: BackendStartOptions): Promise<void> {
    await this.teardownAgent()
    await this.start(opts)
  }

  prewarm(opts: BackendStartOptions): void {
    this.opts = opts
    void this.ensureAgent().catch((error: unknown) => {
      log.warn('[deepseek] prewarm failed', error)
    })
  }

  private async ensureAgent(): Promise<DeepseekAgentHandle> {
    if (this.agent) return this.agent
    if (this.startPromise) return this.startPromise
    const opts = this.opts
    if (!opts) throw new Error('DeepseekBackend.start() must run before the agent is used')

    this.startPromise = (async () => {
      const runtime = await getDeepseekRuntime()
      const config = readConfig(opts.config)
      // The dsh session id doubles as our provider session id, so cold resume
      // finds the persisted JSONL log by the same identity.
      const providerSessionId = opts.providerSessionId ?? randomUUID()
      // Keyed on the SuperOne session id: that is the identity the tools act
      // on (session_rename, widget_show, …), not dsh's own session id.
      const superoneSessionId = opts.sessionId

      this.unregisterApproval = registerApprovalRouter(
        providerSessionId,
        (request) => this.askPermission(request),
      )

      const agent = await runtime.createAgent({
        sessionId: providerSessionId,
        cwd: opts.cwd,
        // Absent takes the roster default. Creation is the only moment this
        // matters: a resumed session recomposes from its own durable log, and a
        // blank live one switches through the roster.
        ...(config.agentPreset ? { agentPreset: config.agentPreset } : {}),
        // dsh's file/shell/search/todo rows are mounted for the whole tree (a
        // delegated child has to inherit them); each still resolves the calling
        // agent's own session cwd. What is per session is below.
        toolPlane: {
          // In-process, not over our own MCP server: dsh resolves tools per
          // agent scope, so SuperOne's tools are registered as native dsh
          // tools that call the same executor the MCP surface calls.
          superoneTools: {
            list: () => listSuperoneMcpTools(superoneSessionId),
            call: async (name, args, { signal }) => {
              // A tool that returns nothing (fire-and-forget host actions) still
              // owes the model a result block.
              const result = await executeSuperoneMcpTool(superoneSessionId, name, args, signal)
              return result ?? { content: [{ type: 'text', text: '(no output)' }] }
            },
            // Mini-app registration and the Computer Use toggle change the set
            // mid-session; re-register so the next request sees it.
            onChanged: (listener) => addToolsChangedListener((changed) => {
              if (changed === superoneSessionId) listener()
            }),
          },
          requestPermission: (request) => this.askPermission(request),
        },
        provider: config.provider ?? DEFAULT_PROVIDER,
        model: opts.model ?? config.model ?? DEFAULT_MODEL,
        ...(config.maxTokens !== undefined ? { maxTokens: config.maxTokens } : {}),
        resume: Boolean(opts.providerSessionId),
        mcpServers: readDshMcpServerSpecs(opts.cwd),
        onEvent: (event) => this.emit(event),
      })
      // Creation synced from a fresh read; the watch covers the other case —
      // a config edit that lands while this session is already running.
      trackDshMcpConfig(opts.cwd)

      this.agent = agent
      this.emit({ type: 'provider_session_id', providerSessionId })
      for (const callback of this.providerSessionListeners) callback(providerSessionId)
      return agent
    })()

    try {
      return await this.startPromise
    } catch (error) {
      this.startPromise = null
      this.unregisterApproval?.()
      this.unregisterApproval = null
      throw error
    } finally {
      this.startPromise = null
    }
  }

  private async teardownAgent(): Promise<void> {
    for (const requestId of [...this.pendingApprovals.keys()]) {
      this.respondToPermission(requestId, false)
    }
    this.unregisterApproval?.()
    this.unregisterApproval = null
    const agent = this.agent
    this.agent = null
    await agent?.dispose()
  }

  async send(request: SendMessageRequest): Promise<void> {
    const agent = await this.ensureAgent()
    // `/compact` is not a prompt: it drives `ctx.compaction.compactNow()` and
    // opens no turn. Intercepted here rather than mounting dsh's own
    // `command-compact` row, because SuperOne owns the slash surface.
    if (request.content.trim() === '/compact') {
      await this.compactNow(agent.sessionId)
      return
    }
    if (request.model) agent.setRoute({ model: request.model })
    // An effort DeepSeek does not implement is dropped rather than aliased: the
    // adapter rejects an unsupported id with `UNSUPPORTED_REASONING_EFFORT`
    // before any provider I/O, so a stale `medium` off another harness would
    // otherwise fail the whole turn.
    const reasoningEffort = dshEffortFromSuperone(request.effort)
    if (reasoningEffort) agent.setRoute({ reasoningEffort })
    // Images ride the same call as the text. `sendText` commits them to dsh's
    // durable attachment store before it queues anything, and rejects — having
    // stored nothing — when the store is absent or the routed model does not
    // accept image input, so a refusal leaves the session untouched.
    await agent.sendText(request.content, request.images)
  }

  /**
   * The whole compaction bracket lands on the session log, so `compacting`,
   * `compact_boundary` and the success indicator all come from the mapper. Only
   * a rejection needs handling here: `compactNow` rejects before appending
   * anything when it is busy or the span changed under it, which would
   * otherwise leave the UI with no answer at all.
   */
  private async compactNow(providerSessionId: string): Promise<void> {
    try {
      const runtime = await getDeepseekRuntime()
      await runtime.compactSession(providerSessionId)
    } catch (error) {
      this.emit({
        type: 'status_indicator',
        indicator: null,
        compactResult: 'failed',
        compactError: error instanceof Error ? error.message : String(error),
      })
    } finally {
      // No turn opened, so nothing else will take this session out of the
      // optimistic streaming state the send put it in.
      this.emit({ type: 'status_change', status: 'idle' })
    }
  }

  async interrupt(): Promise<void> {
    this.agent?.cancel()
  }

  async close(): Promise<void> {
    await this.teardownAgent()
    this.listeners.clear()
    this.providerSessionListeners.clear()
    this.permissionModeListeners.clear()
  }

  async setModel(model: string): Promise<void> {
    // In place: the runtime rewrites the route on the next request instead of
    // rebuilding the agent (AgentOptions is create-time and readonly).
    this.agent?.setRoute({ model })
    if (this.opts) this.opts.model = model
  }

  async setSessionMode(_modeId: string): Promise<void> {}

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    this.permissionMode = mode
    if (this.opts) this.opts.permissionMode = mode
    // The shared mode is the carrier; dsh's preset is the meaning. Switching it
    // writes a durable `sandbox/mode` + `approval/policy` pair onto the
    // session's own log, which is what makes the sandbox fence follow the mode
    // rather than only the popover doing so.
    const agent = this.agent
    if (agent) {
      const runtime = await getDeepseekRuntime()
      runtime.setPermissionPreset(agent.sessionId, dshPresetForMode(mode))
    }
    for (const callback of this.permissionModeListeners) callback(mode)
  }

  async setSandbox(_sandboxInfo: SandboxInfo): Promise<void> {}

  /**
   * Bridge one dsh approval question onto the SuperOne permission popover.
   * The returned promise settles the dsh `approval/request` waterfall, so the
   * tool stays parked until the user answers (or dsh withdraws the question).
   */
  private askPermission(request: {
    toolName: string
    /** Parsed tool arguments when the caller has them (the tool gate does). */
    input?: Record<string, unknown>
    callId?: string
    reason?: string
    signal?: AbortSignal
  }): Promise<'allowed-once' | 'rejected' | 'cancelled'> {
    if (this.permissionMode === 'bypassPermissions') return Promise.resolve('allowed-once')

    const requestId = randomUUID()
    return new Promise((resolve) => {
      const permissionRequest: PermissionRequest = {
        requestId,
        // Same canonical name the chat row shows, so the popover and the tool
        // block above it cannot disagree about what is being approved.
        toolName: displayToolName(request.toolName),
        ...(request.callId ? { toolUseId: request.callId } : {}),
        input: request.input ?? {},
        ...(request.reason ? { decisionReason: request.reason } : {}),
        // dsh answers are one-shot; a durable grant needs its preset plane.
        allowAlwaysAllow: false,
      }
      const event: AgentEvent = { type: 'permission_request', request: permissionRequest }
      const settle = (decision: 'allowed-once' | 'rejected' | 'cancelled'): void => {
        if (!this.pendingApprovals.delete(requestId)) return
        resolve(decision)
      }
      this.pendingApprovals.set(requestId, { request: permissionRequest, event, settle })
      request.signal?.addEventListener('abort', () => settle('cancelled'), { once: true })
      this.emit(event)
    })
  }

  respondToPermission(
    requestId: string,
    allow: boolean,
    _alwaysAllow?: boolean,
    _reason?: string,
    _selectedSuggestions?: number[],
    decision?: 'cancel',
  ): boolean {
    const pending = this.pendingApprovals.get(requestId)
    if (!pending) return false
    pending.settle(decision === 'cancel' ? 'cancelled' : allow ? 'allowed-once' : 'rejected')
    this.emit({ type: 'interaction_resolved', interactionType: 'permission', requestId, approved: allow })
    return true
  }

  respondToQuestion(_requestId: string, _answers: Record<string, string>, _annotations?: QuestionAnnotations): void {}

  dismissQuestion(_requestId: string): void {}

  respondToPlanApproval(_requestId: string, _approved: boolean, _feedback?: string): void {}

  async getContextUsage(): Promise<ContextUsageInfo | null> {
    return null
  }

  async getMcpServerStatus(): Promise<McpServerInfo[]> {
    return []
  }

  async rewindFiles(_userMessageId: string, _opts?: { dryRun?: boolean }): Promise<RewindFilesResult> {
    return { canRewind: false, error: 'DeepSeek harness does not support rewind yet' }
  }

  async reconnectMcp(_serverName: string): Promise<void> {}

  async toggleMcpServer(_serverName: string, _enabled: boolean): Promise<void> {}

  async reloadMcpServers(): Promise<void> {}

  async reloadPlugins(): Promise<boolean> {
    return false
  }

  dequeueMessage(_clientMessageId: string): boolean {
    return false
  }

  getPendingInteractions(): AgentEvent[] {
    return [...this.pendingApprovals.values()].map((pending) => pending.event)
  }

  onEvent(handler: (event: BackendEvent) => void): () => void {
    this.listeners.add(handler)
    return () => this.listeners.delete(handler)
  }

  onProviderSessionId(handler: (id: string) => void): () => void {
    this.providerSessionListeners.add(handler)
    return () => this.providerSessionListeners.delete(handler)
  }

  onPermissionModeApplied(handler: (mode: PermissionMode) => void): () => void {
    this.permissionModeListeners.add(handler)
    return () => this.permissionModeListeners.delete(handler)
  }

  private emit(event: BackendEvent): void {
    for (const listener of this.listeners) listener(event)
  }
}
