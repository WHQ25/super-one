import type { Query } from '@anthropic-ai/claude-agent-sdk'
import type { AccountInfo, AgentEvent, ChatMessage, McpServerInfo, ModelOption, PermissionMode, RewindFilesResult, SendMessageRequest, SlashCommandInfo } from '../../shared/agent-types'
import { createCanUseTool, rejectAllPending, respondToPermission, respondToQuestion, type PendingPermission, type PendingQuestion } from './claude-permissions'
import { refreshModelsFromQuery } from './claude-models'
import { MessageBridge } from './message-bridge'
import { createSessionQuery, buildUserMessage } from './claude-query'

export interface ClaudeAgentConfig {
  cwd: string
  model?: string
}

export class ClaudeAgent {
  private config: ClaudeAgentConfig | null = null
  private onEvent: ((event: AgentEvent) => void) | null = null

  // Session state (lives until resetSession or dispose)
  private bridge: MessageBridge | null = null
  private sessionQuery: Query | null = null
  private iterationDone: Promise<void> | null = null
  private sessionId = ''

  // Per-turn state
  private currentMessageId = ''
  private currentStartTime = 0
  private interrupted = false
  private turnResolve: (() => void) | null = null

  private ready = false
  private cachedModels: ModelOption[] = []
  private currentPermissionMode: PermissionMode = 'default'
  private pendingPermissions = new Map<string, PendingPermission>()
  private pendingQuestions = new Map<string, PendingQuestion>()

  async initialize(config: ClaudeAgentConfig, onEvent: (event: AgentEvent) => void): Promise<void> {
    this.config = config
    this.onEvent = onEvent
    this.ready = true

    // Eagerly create session — triggers system init, makes slash commands/models/MCP available
    this.createSession()
  }

  /** Create a new session (bridge + query). Safe to call if session already exists (no-op). */
  private createSession(resumeSessionId?: string): void {
    if (this.bridge) return

    this.bridge = new MessageBridge()
    const canUseTool = createCanUseTool(this.pendingPermissions, this.pendingQuestions, (e) => this.emit(e))

    const handle = createSessionQuery(
      this.bridge,
      {
        cwd: this.config!.cwd,
        model: this.config!.model,
        permissionMode: this.currentPermissionMode,
        canUseTool,
        resume: resumeSessionId,
      },
      (e) => this.emit(e),
      () => this.currentMessageId,
      () => this.currentStartTime,
      () => this.interrupted,
      (id) => { this.sessionId = id },
    )

    this.sessionQuery = handle.query
    this.iterationDone = handle.iterationDone

    // Fetch models from the live query (more accurate than CLI fallback)
    refreshModelsFromQuery(handle.query).then((models) => {
      if (models.length > 0) this.cachedModels = models
    })
  }

  async sendMessage(request: SendMessageRequest): Promise<void> {
    if (!this.config || !this.onEvent) {
      throw new Error('ClaudeAgent not initialized')
    }

    this.createSession()

    const messageId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    this.currentMessageId = messageId
    this.currentStartTime = Date.now()
    this.interrupted = false

    const message: ChatMessage = {
      id: messageId,
      role: 'assistant',
      status: 'streaming',
      content: [],
      createdAt: new Date().toISOString(),
      providerId: 'claude',
    }

    this.emit({ type: 'status_change', status: 'streaming' })
    this.emit({ type: 'message_start', message })

    // Switch model for this turn if requested
    if (request.model && this.sessionQuery) {
      await this.sessionQuery.setModel(request.model)
    }

    // Create a promise that resolves when this turn completes
    const turnDone = new Promise<void>((resolve) => {
      this.turnResolve = resolve
    })

    // Push the user message into the bridge
    const userMsg = buildUserMessage(request, this.sessionId)
    this.bridge!.push(userMsg)

    // Wait for this turn to complete (result/error/interrupt event)
    await turnDone
  }

  respondToPermission(requestId: string, allow: boolean, alwaysAllow?: boolean): void {
    respondToPermission(this.pendingPermissions, requestId, allow, alwaysAllow)
  }

  respondToQuestion(requestId: string, answers: Record<string, string>): void {
    respondToQuestion(this.pendingQuestions, requestId, answers)
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    this.currentPermissionMode = mode
    if (this.sessionQuery) {
      await this.sessionQuery.setPermissionMode(mode)
    }
    this.emit({ type: 'permission_mode_change', mode })
  }

  async interrupt(): Promise<void> {
    if (this.sessionQuery) {
      this.interrupted = true
      await this.sessionQuery.interrupt()
    }
  }

  getSessionId(): string {
    return this.sessionId
  }

  /** Resume a previous session by its ID. Resets current session first. */
  async resumeSession(sessionId: string): Promise<void> {
    if (!this.config || !this.onEvent) throw new Error('ClaudeAgent not initialized')
    await this.resetSession()
    this.createSession(sessionId)
  }

  /** Rewind files to the state before a given user message. */
  async rewindFiles(userMessageId: string): Promise<RewindFilesResult> {
    if (!this.sessionQuery) {
      return { canRewind: false, error: 'No active session' }
    }
    try {
      const result = await this.sessionQuery.rewindFiles(userMessageId)
      return {
        canRewind: result.canRewind,
        error: result.error,
        filesChanged: result.filesChanged,
        insertions: result.insertions,
        deletions: result.deletions,
      }
    } catch (err) {
      return { canRewind: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async getMcpServerStatus(): Promise<McpServerInfo[]> {
    if (!this.sessionQuery) return []
    try {
      const statuses = await this.sessionQuery.mcpServerStatus()
      return statuses.map((s) => ({
        name: s.name,
        status: s.status,
        error: s.error,
        scope: s.scope,
        toolCount: s.tools?.length,
      }))
    } catch {
      return []
    }
  }

  async getAccountInfo(): Promise<AccountInfo> {
    if (!this.sessionQuery) return {}
    try {
      const info = await this.sessionQuery.accountInfo()
      return {
        email: info.email,
        organization: info.organization,
        subscriptionType: info.subscriptionType,
      }
    } catch {
      return {}
    }
  }

  async getSlashCommands(): Promise<SlashCommandInfo[]> {
    if (!this.sessionQuery) return []
    try {
      // Use initializationResult() which waits for full init including user commands
      const init = await this.sessionQuery.initializationResult()
      return init.commands.map((c) => ({
        name: c.name,
        description: c.description,
        argumentHint: c.argumentHint,
      }))
    } catch {
      return []
    }
  }

  isReady(): boolean {
    return this.ready
  }

  /** Close the current session and reset state for a new one. */
  async resetSession(): Promise<void> {
    // Resolve any pending sendMessage awaiter
    this.turnResolve?.()
    this.turnResolve = null

    if (this.sessionQuery) {
      this.sessionQuery.close()
    }
    if (this.bridge) {
      this.bridge.close()
    }

    // Wait for the iteration loop to finish (it will exit after query closes)
    if (this.iterationDone) {
      await this.iterationDone.catch(() => {})
    }

    rejectAllPending(this.pendingPermissions, this.pendingQuestions)
    this.bridge = null
    this.sessionQuery = null
    this.iterationDone = null
    this.sessionId = ''
    this.currentMessageId = ''
  }

  async dispose(): Promise<void> {
    await this.resetSession()
    this.ready = false
    this.config = null
    this.onEvent = null
    this.cachedModels = []
  }

  async getAvailableModels(): Promise<ModelOption[]> {
    return this.cachedModels
  }

  private emit(event: AgentEvent): void {
    this.onEvent?.(event)

    // Detect turn completion to resolve the sendMessage awaiter
    if (
      event.type === 'message_complete' ||
      event.type === 'message_interrupted' ||
      event.type === 'message_error'
    ) {
      this.turnResolve?.()
      this.turnResolve = null
    }
  }
}
