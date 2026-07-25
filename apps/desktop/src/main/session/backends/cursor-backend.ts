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
import log from '../../logger'
import { mapPermissionToCursorLocal } from '../../cursor/cursor-auth'
import {
  getCursorRuntimeFactory,
  type CursorRuntime,
  setCursorRuntimeFactory,
} from '../../cursor/cursor-runtime'
import type { BackendStartOptions, HarnessId, SessionBackend } from '../types'

export { setCursorRuntimeFactory }

export class CursorBackend implements SessionBackend {
  readonly kind: HarnessId = 'cursor'

  private opts: BackendStartOptions | null = null
  private runtime: CursorRuntime | null = null
  private runtimePromise: Promise<CursorRuntime> | null = null
  private runtimeEpoch = 0
  private permissionMode: PermissionMode = 'default'
  private model: string | undefined
  private started = false
  private disposed = false
  private interrupted = false
  private currentMessageId: string | null = null
  private activeTurn: { messageId: string; resolve: () => void } | null = null
  private terminalMessageId: string | null = null
  private eventListeners = new Set<(event: AgentEvent) => void>()
  private providerSessionListeners = new Set<(id: string) => void>()
  private permissionModeListeners = new Set<(mode: PermissionMode) => void>()

  async start(opts: BackendStartOptions): Promise<void> {
    if (this.disposed) throw new Error('CursorBackend already disposed')
    this.opts = opts
    this.permissionMode = opts.permissionMode
    this.model = opts.model
    this.started = true
    try {
      await this.ensureRuntime()
    } catch (error) {
      this.started = false
      throw error
    }
  }

  async rebuild(opts: BackendStartOptions): Promise<void> {
    await this.closeRuntime()
    this.disposed = false
    this.started = false
    await this.start(opts)
  }

  prewarm(opts: BackendStartOptions): void {
    if (this.disposed) return
    this.opts = opts
    this.permissionMode = opts.permissionMode
    this.model = opts.model
    void this.ensureRuntime().catch((error) => log.debug('[CursorBackend] prewarm failed:', error))
  }

  private async ensureRuntime(): Promise<CursorRuntime> {
    if (this.runtime) return this.runtime
    if (this.runtimePromise) return this.runtimePromise
    if (!this.opts) throw new Error('CursorBackend not configured')
    const epoch = this.runtimeEpoch
    const opts = this.opts
    const factory = getCursorRuntimeFactory()
    const promise = factory({
      sessionId: opts.sessionId,
      cwd: opts.cwd,
      providerSessionId: opts.providerSessionId,
      permissionMode: this.permissionMode,
      model: this.model ?? opts.model,
      config: opts.config,
      onEvent: (event) => this.emit(event),
      onProviderSessionId: (id) => {
        opts.providerSessionId = id
        for (const cb of this.providerSessionListeners) cb(id)
      },
    }).then((runtime) => {
      if (this.disposed || epoch !== this.runtimeEpoch) {
        void runtime.close().catch(() => undefined)
        throw new Error('Cursor runtime initialization was superseded')
      }
      this.runtime = runtime
      return runtime
    }).finally(() => {
      if (this.runtimePromise === promise) this.runtimePromise = null
    })
    this.runtimePromise = promise
    return promise
  }

  async send(request: SendMessageRequest): Promise<void> {
    if (!this.started || this.disposed) throw new Error('CursorBackend not started')
    if (this.activeTurn) throw new Error('CursorBackend already has an active turn')

    const messageId = request.assistantMessageId
      ?? `cursor_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    this.currentMessageId = messageId
    this.interrupted = false
    this.terminalMessageId = null

    this.emit({
      type: 'message_start',
      message: {
        id: messageId,
        role: 'assistant',
        status: 'streaming',
        content: [],
        createdAt: new Date().toISOString(),
        providerId: 'cursor',
      },
    })
    this.emit({ type: 'status_change', status: 'streaming' })

    try {
      const runtime = await this.ensureRuntime()
      if (request.model) {
        this.model = request.model
        runtime.setModel(request.model)
      }
      const turnComplete = new Promise<void>((resolve) => {
        this.activeTurn = { messageId, resolve }
      })

      const images = request.images
        ?.map((img) => ({ data: img.base64, mimeType: img.mimeType || 'image/png' }))
        .filter((img) => img.data) ?? []

      const force = Boolean(
        (request as { force?: boolean }).force
        || (request as { cursor?: { force?: boolean } }).cursor?.force,
      )
      await runtime.send(messageId, request.content, {
        images: images.length ? images : undefined,
        force: force || undefined,
      })

      if (this.interrupted) this.complete(messageId, true)
      else this.complete(messageId, false)
      await turnComplete
    } catch (error) {
      if (this.interrupted) this.complete(messageId, true)
      else this.fail(messageId, error instanceof Error ? error.message : String(error))
    } finally {
      // complete/fail already resolve activeTurn
      this.activeTurn = null
      this.currentMessageId = null
    }
  }

  async interrupt(): Promise<void> {
    this.interrupted = true
    await this.runtime?.cancel().catch((error) => log.debug('[CursorBackend] interrupt failed:', error))
    if (this.currentMessageId) this.complete(this.currentMessageId, true)
  }

  private async closeRuntime(): Promise<void> {
    this.runtimeEpoch += 1
    const pending = this.runtimePromise
    this.runtimePromise = null
    const runtime = this.runtime ?? await pending?.catch(() => null) ?? null
    this.runtime = null
    if (runtime) await runtime.close().catch((error) => log.debug('[CursorBackend] runtime close failed:', error))
  }

  async close(): Promise<void> {
    this.disposed = true
    this.started = false
    if (this.currentMessageId) this.complete(this.currentMessageId, true)
    await this.closeRuntime()
    this.eventListeners.clear()
    this.providerSessionListeners.clear()
    this.permissionModeListeners.clear()
  }

  async setModel(model: string): Promise<void> {
    this.model = model
    if (this.opts) this.opts.model = model
    this.runtime?.setModel(model)
  }

  async setSessionMode(modeId: string): Promise<void> {
    // plan | agent via permissionMode mapping
    if (modeId === 'plan') await this.setPermissionMode('plan')
    else if (modeId === 'agent') await this.setPermissionMode('default')
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    const prev = mapPermissionToCursorLocal(this.permissionMode)
    const next = mapPermissionToCursorLocal(mode)
    this.permissionMode = mode
    if (this.opts) this.opts.permissionMode = mode
    this.runtime?.setPermissionMode(mode)
    for (const listener of this.permissionModeListeners) listener(mode)
    // Create-time sandbox/autoReview → rebuild when mapping changes (D7)
    if (
      this.started
      && this.runtime
      && (prev.sandboxEnabled !== next.sandboxEnabled || prev.autoReview !== next.autoReview || prev.mode !== next.mode)
      && this.opts
    ) {
      void this.rebuild(this.opts).catch((error) => log.debug('[CursorBackend] rebuild after permission change failed:', error))
    }
  }

  async setSandbox(_sandboxInfo: SandboxInfo): Promise<void> {
    // Honored via permission mapping + rebuild
  }

  respondToPermission(): boolean {
    return false
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
    try {
      return await (await this.ensureRuntime()).getMcpServerStatus()
    } catch {
      return []
    }
  }

  async rewindFiles(_userMessageId: string, _opts?: { dryRun?: boolean }): Promise<RewindFilesResult> {
    return {
      canRewind: false,
      filesChanged: [],
      insertions: 0,
      deletions: 0,
      error: 'Cursor SDK does not expose host rewindFiles; use SuperOne transcript fork instead.',
    }
  }

  async reconnectMcp(_serverName: string): Promise<void> {
    await this.reloadMcpServers()
  }

  async toggleMcpServer(_serverName: string, _enabled: boolean): Promise<void> {
    // SuperOne config files own enable/disable; reload picks up disk state.
    await this.reloadMcpServers()
  }

  async reloadMcpServers(): Promise<void> {
    const runtime = await this.ensureRuntime()
    await runtime.reload()
  }

  async reloadPlugins(): Promise<boolean> {
    try {
      await (await this.ensureRuntime()).reload()
      return true
    } catch {
      return false
    }
  }

  /**
   * Expire a wedged local run (AgentBusyError recovery) by sending a no-op
   * follow-up with LocalSendOptions.force. Preferred path is automatic force
   * retry inside runtime.send; this is an explicit host recovery hook.
   */
  async forceRecover(message = 'Continue.'): Promise<void> {
    if (!this.started || this.disposed) throw new Error('CursorBackend not started')
    const messageId = `cursor_force_${Date.now()}`
    const runtime = await this.ensureRuntime()
    await runtime.send(messageId, message, { force: true })
  }

  dequeueMessage(_clientMessageId: string): boolean {
    return false
  }

  getPendingInteractions(): AgentEvent[] {
    return []
  }

  onEvent(handler: (event: AgentEvent) => void): () => void {
    this.eventListeners.add(handler)
    return () => { this.eventListeners.delete(handler) }
  }

  onProviderSessionId(handler: (id: string) => void): () => void {
    this.providerSessionListeners.add(handler)
    return () => { this.providerSessionListeners.delete(handler) }
  }

  onPermissionModeApplied(handler: (mode: PermissionMode) => void): () => void {
    this.permissionModeListeners.add(handler)
    return () => { this.permissionModeListeners.delete(handler) }
  }

  private emit(event: AgentEvent): void {
    for (const listener of this.eventListeners) listener(event)
  }

  private complete(messageId: string, interrupted = false): void {
    if (this.terminalMessageId === messageId) return
    this.terminalMessageId = messageId
    this.emit({ type: interrupted ? 'message_interrupted' : 'message_complete', messageId })
    this.emit({ type: 'status_change', status: 'idle' })
    if (this.activeTurn?.messageId === messageId) this.activeTurn.resolve()
  }

  private fail(messageId: string, error: string): void {
    if (this.terminalMessageId === messageId) return
    this.terminalMessageId = messageId
    this.emit({ type: 'message_error', messageId, error })
    this.emit({ type: 'status_change', status: 'error' })
    if (this.activeTurn?.messageId === messageId) this.activeTurn.resolve()
  }
}

