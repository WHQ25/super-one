import type {
  AgentEvent,
  ContextUsageInfo,
  McpServerInfo,
  PermissionMode,
  QuestionAnnotations,
  RewindFilesResult,
  SandboxInfo,
  SendMessageRequest,
} from '@superone/shared/agent-types'
import type { RequestPermissionRequest, RequestPermissionResponse } from '@agentclientprotocol/sdk'
import log from '../../logger'
import { extractModeConfig, extractModelConfig } from '../../acp/acp-config'
import { upsertAcpAgentConfig, upsertAcpAgentModels, upsertAcpAgentSlashCommands } from '../../acp/acp-model-cache'
import { createAcpRuntime, type AcpRuntime, type AcpRuntimeOptions } from '../../acp/acp-runtime'
import { mapPermissionDecision, mapPermissionRequest, type PendingPermissionOptions } from '../../acp/acp-permission-map'
import type { BackendStartOptions, HarnessId, SessionBackend } from '../types'

export interface AcpBackendConfig {
  agentId?: string
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
}

export type AcpRuntimeFactory = (opts: AcpRuntimeOptions) => Promise<AcpRuntime>

function readConfig(raw: unknown): AcpBackendConfig {
  if (raw && typeof raw === 'object') return raw as AcpBackendConfig
  return {}
}

let runtimeFactory: AcpRuntimeFactory = createAcpRuntime

export function setAcpRuntimeFactory(factory: AcpRuntimeFactory | null): void {
  runtimeFactory = factory ?? createAcpRuntime
}

export class AcpBackend implements SessionBackend {
  readonly kind: HarnessId = 'acp'

  private started = false
  private disposed = false
  private startOpts: BackendStartOptions | null = null
  private config: AcpBackendConfig = {}
  private runtime: AcpRuntime | null = null
  private activePrompt: Promise<void> | null = null
  private interrupted = false
  private currentMessageId: string | null = null

  private eventListeners = new Set<(e: AgentEvent) => void>()
  private providerSessionIdListeners = new Set<(id: string) => void>()
  private permissionModeAppliedListeners = new Set<(mode: PermissionMode) => void>()

  private pendingPermissions = new Map<string, {
    resolve: (response: RequestPermissionResponse) => void
    options: PendingPermissionOptions[]
    event: AgentEvent
  }>()

  private modelConfigId: string | null = null
  private modeConfigId: string | null = null
  private ensureRuntimePromise: Promise<AcpRuntime> | null = null
  private runtimeEpoch = 0
  private runtimeAgentKey: string | null = null

  private agentKey(cfg: AcpBackendConfig = this.config): string {
    return `${cfg.agentId ?? ''}\0${cfg.command ?? ''}`
  }

  private isLaunchChanged(next: AcpBackendConfig): boolean {
    return this.agentKey(next) !== this.agentKey(this.config)
  }

  async start(opts: BackendStartOptions): Promise<void> {
    if (this.disposed) throw new Error('AcpBackend already disposed')
    const next = readConfig(opts.config)
    const launchChanged = this.isLaunchChanged(next)
    this.startOpts = opts
    this.config = next
    if (launchChanged && (this.runtime || this.ensureRuntimePromise)) {
      await this.teardownRuntime()
    }
    this.started = true
    log.info('[AcpBackend] start sid=%s agentId=%s', opts.sessionId, this.config.agentId ?? '(none)')
    // Spawn early so available_commands_update can fill the / popup before the first send.
    void this.ensureRuntime().catch((err) => {
      log.warn('[AcpBackend] start ensureRuntime failed:', err instanceof Error ? err.message : String(err))
    })
  }

  async rebuild(opts: BackendStartOptions): Promise<void> {
    await this.teardownRuntime()
    this.startOpts = opts
    this.config = readConfig(opts.config)
    this.started = true
    this.disposed = false
  }

  prewarm(opts: BackendStartOptions): void {
    if (this.disposed) return
    const next = readConfig(opts.config)
    const launchChanged = this.isLaunchChanged(next)
    if (launchChanged && (this.runtime || this.ensureRuntimePromise)) {
      void this.teardownRuntime().then(() => {
        this.startOpts = opts
        this.config = next
        return this.ensureRuntime()
      }).catch((err) => {
        log.warn('[AcpBackend] prewarm rebuild failed:', err instanceof Error ? err.message : String(err))
      })
      return
    }
    this.startOpts = opts
    this.config = next
    void this.ensureRuntime().catch((err) => {
      log.warn('[AcpBackend] prewarm failed:', err instanceof Error ? err.message : String(err))
    })
  }

  private persistConfigCache(
    configOptions: import('@agentclientprotocol/sdk').SessionConfigOption[] | null | undefined,
    modelFallback: {
      models: import('@superone/shared/agent-types').ModelOption[]
      selectedModelId: string | null
      configId: string | null
    } | null,
    agentId: string | null,
  ): void {
    if (!agentId) return
    try {
      if (configOptions?.length) {
        upsertAcpAgentConfig(agentId, configOptions, modelFallback)
      } else if (modelFallback && modelFallback.models.length > 0) {
        upsertAcpAgentModels(agentId, modelFallback)
      }
    } catch (err) {
      log.debug('[AcpBackend] upsert config cache failed:', err)
    }
  }

  private emitModels(
    extracted: {
      models: import('@superone/shared/agent-types').ModelOption[]
      selectedModelId: string | null
      configId: string | null
    },
    agentId: string | null,
    epoch: number,
  ): void {
    if (epoch !== this.runtimeEpoch) return
    if (agentId !== (this.config.agentId ?? null)) return
    this.modelConfigId = extracted.configId
    this.emit({
      type: 'acp_models',
      models: extracted.models,
      selectedModelId: extracted.selectedModelId,
      configId: extracted.configId,
      status: 'ready',
      agentId,
    })
  }

  private emitModesFromConfigOptions(
    configOptions: import('@agentclientprotocol/sdk').SessionConfigOption[] | null | undefined,
    agentId: string | null,
    epoch: number,
  ): void {
    if (epoch !== this.runtimeEpoch) return
    const extracted = extractModeConfig(configOptions)
    if (!extracted || extracted.modes.length === 0) {
      this.modeConfigId = null
      this.emit({
        type: 'acp_modes',
        modes: [],
        selectedModeId: null,
        configId: null,
        status: 'ready',
        agentId,
      })
      return
    }
    this.modeConfigId = extracted.configId
    this.emit({
      type: 'acp_modes',
      modes: extracted.modes,
      selectedModeId: extracted.selectedModeId,
      configId: extracted.configId,
      status: 'ready',
      agentId,
    })
  }

  private emitConfigFromOptions(
    configOptions: import('@agentclientprotocol/sdk').SessionConfigOption[] | null | undefined,
    agentId: string | null,
    epoch: number,
    modelFallback?: {
      models: import('@superone/shared/agent-types').ModelOption[]
      selectedModelId: string | null
      configId: string | null
    } | null,
  ): void {
    if (epoch !== this.runtimeEpoch) return
    const models = extractModelConfig(configOptions)
      ?? (modelFallback && modelFallback.models.length > 0 ? modelFallback : null)
    this.persistConfigCache(configOptions, models, agentId)
    if (models && models.models.length > 0) {
      this.emitModels(models, agentId, epoch)
    } else {
      this.modelConfigId = null
      this.emit({
        type: 'acp_models',
        models: [],
        selectedModelId: null,
        configId: null,
        status: 'ready',
        agentId,
      })
    }
    this.emitModesFromConfigOptions(configOptions, agentId, epoch)
  }

  private emitConfigFromRuntime(runtime: AcpRuntime, agentId: string | null, epoch: number): void {
    if (epoch !== this.runtimeEpoch) return
    const options = runtime.getConfigOptions()
    const modelFallback = runtime.getModelConfig() ?? extractModelConfig(options)
    this.emitConfigFromOptions(options, agentId, epoch, modelFallback)
  }

  private emitModelsError(error: string, agentId: string | null, epoch: number): void {
    if (epoch !== this.runtimeEpoch) return
    this.modelConfigId = null
    this.modeConfigId = null
    this.emit({
      type: 'acp_models',
      models: [],
      selectedModelId: null,
      configId: null,
      status: 'error',
      error,
      agentId,
    })
    this.emit({
      type: 'acp_modes',
      modes: [],
      selectedModeId: null,
      configId: null,
      status: 'error',
      error,
      agentId,
    })
  }

  private async ensureRuntime(): Promise<AcpRuntime> {
    if (this.runtime && this.runtimeAgentKey === this.agentKey()) return this.runtime
    if (this.runtime && this.runtimeAgentKey !== this.agentKey()) {
      await this.teardownRuntime()
    }
    if (this.ensureRuntimePromise) return this.ensureRuntimePromise
    if (!this.startOpts) throw new Error('AcpBackend missing startOpts')
    if (!this.config.agentId && !this.config.command) {
      throw new Error('No ACP agent configured. Pick an agent under Others, then try again.')
    }
    const epoch = this.runtimeEpoch
    const agentId = this.config.agentId ?? null
    const launchKey = this.agentKey()
    const launch = {
      agentId: this.config.agentId,
      command: this.config.command,
      args: this.config.args,
      env: this.config.env,
      cwd: this.config.cwd,
      defaultCwd: this.startOpts.cwd || this.startOpts.projectPath,
    }
    this.emit({
      type: 'acp_models',
      models: [],
      selectedModelId: null,
      configId: null,
      status: 'loading',
      agentId,
    })
    this.emit({
      type: 'acp_modes',
      modes: [],
      selectedModeId: null,
      configId: null,
      status: 'loading',
      agentId,
    })
    const promise = (async () => {
      const runtime = await runtimeFactory({
        launch,
        permission: {
          request: (params) => this.handlePermissionRequest(params),
        },
        onModelConfig: (cfg) => {
          // Early model discovery (initialize) before session/new configOptions land.
          this.emitModels(cfg, agentId, epoch)
          this.persistConfigCache(null, cfg, agentId)
        },
        onSessionEvent: (event) => {
          if (epoch !== this.runtimeEpoch) return
          this.routeSessionEvent(event, agentId, epoch)
        },
      })
      if (epoch !== this.runtimeEpoch || this.agentKey() !== launchKey) {
        try { await runtime.close() } catch { /* ignore */ }
        throw new Error('ACP runtime superseded by agent switch')
      }
      this.runtime = runtime
      this.runtimeAgentKey = launchKey
      for (const cb of this.providerSessionIdListeners) {
        try { cb(runtime.sessionId) } catch (err) { log.warn('[AcpBackend] providerSessionId listener error:', err) }
      }
      this.emitConfigFromRuntime(runtime, agentId, epoch)
      return runtime
    })()
    this.ensureRuntimePromise = promise
    try {
      return await promise
    } catch (err) {
      if (epoch === this.runtimeEpoch) {
        const msg = err instanceof Error ? err.message : String(err)
        if (!msg.includes('superseded')) this.emitModelsError(msg, agentId, epoch)
      }
      throw err
    } finally {
      if (this.ensureRuntimePromise === promise) this.ensureRuntimePromise = null
    }
  }

  private routeSessionEvent(event: AgentEvent, agentId: string | null, epoch: number): void {
    if (epoch !== this.runtimeEpoch) return
    if (event.type === 'acp_models' && event.configId) this.modelConfigId = event.configId
    if (event.type === 'acp_modes' && event.configId) this.modeConfigId = event.configId
    if (event.type === 'acp_commands') {
      if (agentId) {
        try {
          // Always persist (including empty) so cache mirrors agent-advertised set.
          upsertAcpAgentSlashCommands(agentId, event.commands)
        } catch (err) {
          log.debug('[AcpBackend] upsert slash commands cache failed:', err)
        }
      }
      log.info(
        '[AcpBackend] acp_commands agent=%s count=%d names=%s',
        agentId ?? '(none)',
        event.commands.length,
        event.commands.slice(0, 12).map((c) => c.name).join(','),
      )
    }
    if (
      (event.type === 'acp_models' || event.type === 'acp_modes' || event.type === 'acp_commands')
      && event.agentId === undefined
    ) {
      this.emit({ ...event, agentId })
      return
    }
    this.emit(event)
  }

  private handlePermissionRequest(params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    const { request, options } = mapPermissionRequest(params)
    const event: AgentEvent = { type: 'permission_request', request }
    return new Promise((resolve) => {
      this.pendingPermissions.set(request.requestId, { resolve, options, event })
      this.emit(event)
    })
  }

  async send(request: SendMessageRequest): Promise<void> {
    if (!this.started || this.disposed) throw new Error('AcpBackend not started')
    const messageId = request.assistantMessageId
      ?? `acp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    this.interrupted = false
    this.currentMessageId = messageId

    this.emit({
      type: 'message_start',
      message: {
        id: messageId,
        role: 'assistant',
        status: 'streaming',
        content: [],
        createdAt: new Date().toISOString(),
        providerId: 'acp',
      },
    })
    this.emit({ type: 'status_change', status: 'streaming' })

    let emittedTerminal = false
    const onEvent = (event: AgentEvent) => {
      if (
        event.type === 'message_complete'
        || event.type === 'message_interrupted'
        || event.type === 'message_error'
      ) {
        emittedTerminal = true
      }
      this.routeSessionEvent(event, this.config.agentId ?? null, this.runtimeEpoch)
    }

    try {
      const runtime = await this.ensureRuntime()
      if (request.model && this.modelConfigId) {
        try {
          const epoch = this.runtimeEpoch
          const agentId = this.config.agentId ?? null
          const next = await runtime.setConfigOption(this.modelConfigId, request.model)
          this.emitConfigFromOptions(next, agentId, epoch)
        } catch (err) {
          log.debug('[AcpBackend] set model before prompt failed:', err)
        }
      }
      const turn = runtime.prompt(request.content, messageId, onEvent, request.images)
      this.activePrompt = turn
      await turn
    } catch (err) {
      if (this.interrupted) {
        if (!emittedTerminal) {
          this.emit({ type: 'message_interrupted', messageId })
          this.emit({ type: 'status_change', status: 'idle' })
        }
        return
      }
      if (!emittedTerminal) {
        const error = err instanceof Error ? err.message : String(err)
        this.emit({ type: 'message_error', messageId, error })
        this.emit({ type: 'status_change', status: 'error' })
      }
    } finally {
      this.activePrompt = null
      this.currentMessageId = null
    }
  }

  async interrupt(): Promise<void> {
    this.interrupted = true
    for (const [id, pending] of this.pendingPermissions) {
      pending.resolve({ outcome: { outcome: 'cancelled' } })
      this.pendingPermissions.delete(id)
    }
    try {
      await this.runtime?.cancel()
    } catch (err) {
      log.debug('[AcpBackend] interrupt cancel error:', err)
    }
  }

  private async teardownRuntime(): Promise<void> {
    for (const [id, pending] of this.pendingPermissions) {
      pending.resolve({ outcome: { outcome: 'cancelled' } })
      this.pendingPermissions.delete(id)
    }
    this.runtimeEpoch += 1
    this.ensureRuntimePromise = null
    this.modelConfigId = null
    this.modeConfigId = null
    this.runtimeAgentKey = null
    const runtime = this.runtime
    this.runtime = null
    if (runtime) {
      try { await runtime.close() } catch (err) { log.debug('[AcpBackend] runtime close error:', err) }
    }
  }

  async close(): Promise<void> {
    this.disposed = true
    this.started = false
    await this.teardownRuntime()
    this.startOpts = null
    this.eventListeners.clear()
    this.providerSessionIdListeners.clear()
    this.permissionModeAppliedListeners.clear()
  }

  async setModel(model: string): Promise<void> {
    if (!this.runtime || !this.modelConfigId) return
    const epoch = this.runtimeEpoch
    const agentId = this.config.agentId ?? null
    try {
      const next = await this.runtime.setConfigOption(this.modelConfigId, model)
      const extracted = extractModelConfig(next) ?? this.runtime.getModelConfig()
      const fallback = extracted
        ? {
            models: extracted.models,
            selectedModelId: extracted.selectedModelId ?? model,
            configId: extracted.configId,
          }
        : null
      this.emitConfigFromOptions(next, agentId, epoch, fallback)
    } catch (err) {
      log.warn('[AcpBackend] setModel failed:', err)
    }
  }

  async setSessionMode(modeId: string): Promise<void> {
    if (!this.runtime || !this.modeConfigId) return
    const epoch = this.runtimeEpoch
    const agentId = this.config.agentId ?? null
    try {
      const next = await this.runtime.setConfigOption(this.modeConfigId, modeId)
      this.emitConfigFromOptions(next, agentId, epoch)
      const extracted = extractModeConfig(next)
      if (extracted && extracted.selectedModeId !== modeId) {
        this.modeConfigId = extracted.configId
        this.emit({
          type: 'acp_modes',
          modes: extracted.modes,
          selectedModeId: modeId,
          configId: extracted.configId,
          status: 'ready',
          agentId,
        })
      }
    } catch (err) {
      log.warn('[AcpBackend] setSessionMode failed:', err)
    }
  }

  async setPermissionMode(_mode: PermissionMode): Promise<void> {}

  async setSandbox(_sandboxInfo: SandboxInfo): Promise<void> {}

  respondToPermission(
    requestId: string,
    allow: boolean,
    alwaysAllow?: boolean,
    _reason?: string,
    _selectedSuggestions?: number[],
    decision?: 'cancel',
  ): boolean {
    const pending = this.pendingPermissions.get(requestId)
    if (!pending) return false
    this.pendingPermissions.delete(requestId)
    pending.resolve(mapPermissionDecision(pending.options, allow, alwaysAllow, decision))
    return true
  }

  respondToQuestion(
    _requestId: string,
    _answers: Record<string, string>,
    _annotations?: QuestionAnnotations,
  ): void {}

  dismissQuestion(_requestId: string): void {}

  respondToPlanApproval(_requestId: string, _approved: boolean, _feedback?: string): void {}

  async getContextUsage(): Promise<ContextUsageInfo | null> {
    return null
  }

  async getMcpServerStatus(): Promise<McpServerInfo[]> {
    return []
  }

  async rewindFiles(_userMessageId: string, _opts?: { dryRun?: boolean }): Promise<RewindFilesResult> {
    return { canRewind: false, error: 'ACP harness does not support rewind yet' }
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
    return Array.from(this.pendingPermissions.values()).map((p) => p.event)
  }

  onEvent(handler: (event: AgentEvent) => void): () => void {
    this.eventListeners.add(handler)
    return () => this.eventListeners.delete(handler)
  }

  onProviderSessionId(handler: (id: string) => void): () => void {
    this.providerSessionIdListeners.add(handler)
    return () => this.providerSessionIdListeners.delete(handler)
  }

  onPermissionModeApplied(handler: (mode: PermissionMode) => void): () => void {
    this.permissionModeAppliedListeners.add(handler)
    return () => this.permissionModeAppliedListeners.delete(handler)
  }

  private emit(event: AgentEvent): void {
    for (const cb of this.eventListeners) {
      try {
        cb(event)
      } catch (err) {
        log.warn('[AcpBackend] event listener error:', err)
      }
    }
  }
}
