import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import log from '../logger'
import { join, resolve } from 'path'
import { homedir } from 'os'
import type { Query, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { AgentEvent, AgentInfo, ChatMessage, ContextUsageInfo, ListDirEntry, McpServerInfo, PermissionMode, QuestionAnnotations, RewindFilesResult, SandboxInfo, SandboxMode, SendMessageRequest, SlashCommandInfo } from '../../shared/agent-types'
import { createCanUseTool, dismissQuestion, rejectAllPending, respondToPermission, respondToQuestion, respondToPlanApproval, type PendingPermission, type PendingQuestion, type PendingPlanApproval } from './claude-permissions'
import { MessageBridge } from './message-bridge'
import { createSessionQuery, buildUserMessage } from './claude-query'
import { trace } from './event-trace'
import { discoverSkills, discoverProjectCommands, discoverProjectAgents } from './discover-resources'
import { getActiveProviderRaw } from '../database'
import { readUserPreferences } from '../claude-preferences-service'
import type { ApiProvider } from '../../shared/agent-types'

export function buildProviderEnv(provider: ApiProvider, agentType: string = 'claude'): Record<string, string> {
  const configs = JSON.parse(provider.agent_configs || '{}')
  const ac = configs[agentType]
  if (!ac) return {}
  const modelEnv = JSON.parse(ac.model_env || '{}')
  const extraEnv = JSON.parse(ac.extra_env || '{}')
  const env: Record<string, string> = { ...extraEnv, ...modelEnv }
  if (provider.api_key) {
    env.ANTHROPIC_API_KEY = provider.api_key
    if ('ANTHROPIC_AUTH_TOKEN' in extraEnv) {
      env.ANTHROPIC_AUTH_TOKEN = provider.api_key
    }
  }
  if (ac.base_url) env.ANTHROPIC_BASE_URL = ac.base_url
  return env
}


const DEFAULT_SANDBOX_INFO: SandboxInfo = { enabled: true, autoAllowBash: false }

/** Read additionalDirectories from {cwd}/.claude/settings.json */
export function readProjectAdditionalDirs(cwd: string): string[] {
  try {
    const settingsPath = join(cwd, '.claude', 'settings.json')
    if (!existsSync(settingsPath)) return []
    const data = JSON.parse(readFileSync(settingsPath, 'utf-8'))
    if (Array.isArray(data.additionalDirectories)) {
      return data.additionalDirectories.filter((d: unknown) => typeof d === 'string')
    }
    return []
  } catch {
    return []
  }
}

/** Write additionalDirectories to {cwd}/.claude/settings.json (merges with existing data) */
export function writeProjectAdditionalDirs(cwd: string, dirs: string[]): void {
  const settingsPath = join(cwd, '.claude', 'settings.json')
  let data: Record<string, unknown> = {}
  try {
    if (existsSync(settingsPath)) {
      data = JSON.parse(readFileSync(settingsPath, 'utf-8'))
    }
  } catch { /* start fresh */ }
  data.additionalDirectories = dirs

  mkdirSync(join(cwd, '.claude'), { recursive: true })
  writeFileSync(settingsPath, JSON.stringify(data, null, 2))
}

import { EXCLUDED_DIRS } from './fuzzy-file-search'

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
  private sessionAbort: AbortController | null = null
  private iterationDone: Promise<void> | null = null
  private iterationAlive = false
  private sessionGeneration = 0
  private sessionId = ''

  // Per-turn state
  private currentMessageId = ''
  private currentStartTime = 0
  private interrupted = false
  private turnResolves = new Map<string, () => void>()
  private pendingQueued: Array<{ msg: SDKUserMessage; clientMessageId: string }> = []

  private ready = false
  private currentPermissionMode: PermissionMode = 'default'
  private currentSandboxInfo: SandboxInfo = DEFAULT_SANDBOX_INFO
  private additionalDirs: string[] = []
  private currentEffort: SendMessageRequest['effort'] = undefined
  private needsSessionRebuild = false
  private pendingPermissions = new Map<string, PendingPermission>()
  private pendingQuestions = new Map<string, PendingQuestion>()
  private pendingPlanApprovals = new Map<string, PendingPlanApproval>()

  async initialize(
    config: ClaudeAgentConfig,
    onEvent: (event: AgentEvent) => void,
    resumeSessionId?: string,
    overrides?: { permissionMode?: PermissionMode },
  ): Promise<void> {
    this.config = config
    this.onEvent = onEvent
    this.ready = true

    if (resumeSessionId) this.sessionId = resumeSessionId

    if (!resumeSessionId) {
      this.applyPreferences()
    }

    if (overrides?.permissionMode) {
      this.currentPermissionMode = overrides.permissionMode
    }

    this.createSession(resumeSessionId)

    if (!resumeSessionId && this.currentPermissionMode !== 'default') {
      this.emit({ type: 'permission_mode_change', mode: this.currentPermissionMode })
    }
  }

  /** Create a new session (bridge + query). Safe to call if session already exists (no-op). */
  private createSession(resumeSessionId?: string, resumeSessionAt?: string, forkSession?: boolean, forkedSessionId?: string): void {
    resumeSessionId = resumeSessionId || (this.bridge ? (this.sessionId || undefined) : undefined)

    if (this.bridge) {
      if (this.iterationAlive) return
      log.debug(`[ClaudeAgent] dead session detected — iteration ended but bridge still exists, cleaning up (gen=${this.sessionGeneration}, sessionId=${this.sessionId})`)
      this.bridge.close()
      this.bridge = null
      this.sessionQuery = null
      this.sessionAbort = null
      this.iterationDone = null
    }

    if (this.additionalDirs.length === 0) {
      const projectDirs = readProjectAdditionalDirs(this.config!.cwd)
      if (projectDirs.length > 0) {
        this.additionalDirs = projectDirs
      }
    }

    if (forkedSessionId) {
      this.sessionId = forkedSessionId
    }

    this.bridge = new MessageBridge()
    this.bridge.onConsumed = (tag) => {
      this.emit({ type: 'queued_message_consumed', clientMessageId: tag })
    }
    this.sessionAbort = new AbortController()
    const { canUseTool, trackPlanFile } = createCanUseTool(this.pendingPermissions, this.pendingQuestions, this.pendingPlanApprovals, (e) => this.emit(e))

    let providerEnv: Record<string, string> | undefined
    try {
      const provider = getActiveProviderRaw()
      log.info('[ClaudeAgent] createSession provider lookup: %s', provider ? `name=${provider.name} type=${provider.provider_type} hasKey=${!!provider.api_key}` : 'none (using default)')
      if (provider) {
        providerEnv = buildProviderEnv(provider, 'claude')
        log.info('[ClaudeAgent] createSession providerEnv keys: %s', Object.keys(providerEnv).join(', '))
      }
    } catch (err) {
      log.warn('[claude-agent] failed to load active provider:', err)
    }

    const handle = createSessionQuery(
      this.bridge,
      {
        cwd: this.config!.cwd,
        model: this.config!.model,
        effort: this.currentEffort,
        permissionMode: this.currentPermissionMode,
        sandboxInfo: this.currentSandboxInfo,
        canUseTool,
        trackPlanFile,
        resume: resumeSessionId,
        resumeSessionAt,
        forkSession,
        sessionId: forkedSessionId,
        abortController: this.sessionAbort,
        additionalDirectories: this.additionalDirs.length > 0 ? this.additionalDirs : undefined,
        env: providerEnv,
      },
      (e) => this.emit(e),
      () => this.currentMessageId,
      () => this.currentStartTime,
      () => this.interrupted,
      (id) => {
        this.sessionId = id
      },
      (messageId) => {
        this.currentMessageId = messageId
        this.currentStartTime = Date.now()
        this.interrupted = false
        this.turnResolves.set(messageId, () => {})
      },
      () => this.flushPendingQueued(),
    )

    this.sessionQuery = handle.query
    this.iterationDone = handle.iterationDone
    this.iterationAlive = true
    const gen = ++this.sessionGeneration
    log.debug(`[ClaudeAgent] createSession gen=${gen} resume=${resumeSessionId ?? 'none'} cwd=${this.config!.cwd}`)
    this.iterationDone.then(() => {
      log.debug(`[ClaudeAgent] iterationDone.then gen=${gen} currentGen=${this.sessionGeneration} sessionId=${this.sessionId} bridge=${!!this.bridge}`)
      this.iterationAlive = false
      if (gen !== this.sessionGeneration) {
        log.warn(`[ClaudeAgent] STALE iterationDone.then (gen=${gen} != ${this.sessionGeneration})`)
      }
    }).catch((err) => {
      log.debug(`[ClaudeAgent] iterationDone.catch gen=${gen} currentGen=${this.sessionGeneration} sessionId=${this.sessionId} err=${err instanceof Error ? err.message : String(err)}`)
      this.iterationAlive = false
      if (gen !== this.sessionGeneration) {
        log.warn(`[ClaudeAgent] STALE iterationDone.catch (gen=${gen} != ${this.sessionGeneration})`)
      }
    })

    // Emit project-level init_ready immediately (all data comes from filesystem reads).
    // Models, account, and base slash commands are already global (from connecting page).
    // Only project-level data is needed: skills, projectCommands, cwd, sandboxInfo.
    const skills = discoverSkills(this.config!.cwd)
    const projectCommands = discoverProjectCommands(this.config!.cwd)
    const projectAgents = discoverProjectAgents(this.config!.cwd)
    this.emit({
      type: 'init_ready',
      skills,
      projectCommands,
      projectAgents,
      cwd: this.config!.cwd,
      homedir: homedir(),
      sandboxInfo: this.currentSandboxInfo,
      permissionMode: this.currentPermissionMode,
    })
  }

  setInitialEffort(effort: SendMessageRequest['effort']): void {
    this.currentEffort = effort
  }

  async sendMessage(request: SendMessageRequest): Promise<void> {
    if (!this.config || !this.onEvent) {
      throw new Error('ClaudeAgent not initialized')
    }

    const isQueued = request.priority === 'next'

    if (!isQueued) {
      const effortChanged = request.effort !== this.currentEffort && !!this.bridge
      let dirsChanged = false
      let dirNotifyLines: string[] = []
      if (request.additionalDirs) {
        const sorted = [...request.additionalDirs].sort()
        const current = [...this.additionalDirs].sort()
        dirsChanged = JSON.stringify(sorted) !== JSON.stringify(current)
        if (dirsChanged) {
          dirNotifyLines = [
            ...request.additionalDirs.filter(d => !this.additionalDirs.includes(d)).map(d => `Added ${d} as a working directory`),
            ...this.additionalDirs.filter(d => !request.additionalDirs!.includes(d)).map(d => `Removed ${d} from working directories`),
          ]
        }
      }

      if (effortChanged || dirsChanged || this.needsSessionRebuild) {
        log.info('[ClaudeAgent] session rebuild triggered (effortChanged=%s, dirsChanged=%s, needsRebuild=%s, sessionId=%s)', effortChanged, dirsChanged, this.needsSessionRebuild, this.sessionId)
        this.needsSessionRebuild = false
        const prevSessionId = this.sessionId
        await this.resetSession()
        this.currentEffort = request.effort
        if (dirsChanged) this.additionalDirs = request.additionalDirs!
        this.createSession(prevSessionId || undefined)
        this.emit({ type: 'permission_mode_change', mode: this.currentPermissionMode })
        if (dirNotifyLines.length > 0) {
          this.bridge!.push({
            type: 'user',
            message: { role: 'user', content: `<local-command-stdout>\n${dirNotifyLines.join('\n')}\n</local-command-stdout>` },
            parent_tool_use_id: null,
            session_id: this.sessionId!,
          } as SDKUserMessage)
        }
      } else {
        this.currentEffort = request.effort
      }
    }

    log.debug(`[ClaudeAgent] sendMessage (sessionId=${this.sessionId}, bridge=${!!this.bridge}, iterationAlive=${this.iterationAlive}, gen=${this.sessionGeneration}, queued=${isQueued})`)
    this.createSession()

    if (!this.bridge) {
      log.warn('[ClaudeAgent] sendMessage: no bridge after createSession')
      return
    }

    if (!isQueued) {
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

      const turnDone = new Promise<void>((resolve) => {
        this.turnResolves.set(messageId, resolve)
      })

      if (request.model && this.sessionQuery) {
        try {
          await this.sessionQuery.setModel(request.model)
        } catch (err) { log.debug('[claude-agent] setModel skipped (transport not ready):', err) }
      }

      const userMsg = buildUserMessage(request, this.sessionId)
      this.bridge.push(userMsg)

      await turnDone
    } else {
      const userMsg = buildUserMessage(request, this.sessionId)
      if (this.turnResolves.size > 0) {
        this.pendingQueued.push({ msg: userMsg, clientMessageId: request.clientMessageId! })
      } else {
        this.bridge.push(userMsg, request.clientMessageId)
      }
    }
  }

  respondToPermission(requestId: string, allow: boolean, alwaysAllow?: boolean, reason?: string, selectedSuggestions?: number[]): void {
    respondToPermission(this.pendingPermissions, requestId, allow, alwaysAllow, reason, selectedSuggestions)
  }

  respondToQuestion(requestId: string, answers: Record<string, string>, annotations?: QuestionAnnotations): void {
    respondToQuestion(this.pendingQuestions, requestId, answers, annotations)
  }

  dismissQuestion(requestId: string): void {
    dismissQuestion(this.pendingQuestions, requestId)
  }

  respondToPlanApproval(requestId: string, approved: boolean, feedback?: string): void {
    respondToPlanApproval(this.pendingPlanApprovals, requestId, approved, feedback)
  }

  markNeedsRebuild(): void {
    log.info('[ClaudeAgent] markNeedsRebuild (cwd=%s, sessionId=%s)', this.config?.cwd, this.sessionId)
    this.needsSessionRebuild = true
  }

  applyPreferences(): void {
    const prefs = readUserPreferences()
    this.currentPermissionMode = (prefs.defaultPermissionMode as PermissionMode) || 'default'
    if (prefs.defaultSandboxMode) {
      this.setSandboxMode(prefs.defaultSandboxMode as SandboxMode)
    } else {
      this.currentSandboxInfo = DEFAULT_SANDBOX_INFO
    }
  }

  getCurrentPermissionMode(): PermissionMode {
    return this.currentPermissionMode
  }

  getCurrentSandboxInfo(): SandboxInfo {
    return this.currentSandboxInfo
  }

  setSandboxMode(mode: SandboxMode): SandboxInfo {
    this.currentSandboxInfo = {
      enabled: mode !== 'off',
      autoAllowBash: mode === 'auto',
    }
    return this.currentSandboxInfo
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    const prev = this.currentPermissionMode
    this.currentPermissionMode = mode
    const bypassChanged = (prev === 'bypassPermissions') !== (mode === 'bypassPermissions')
    if (bypassChanged) {
      this.needsSessionRebuild = true
    } else if (this.sessionQuery) {
      try {
        await this.sessionQuery.setPermissionMode(mode)
      } catch (err) {
        log.debug('[claude-agent] setPermissionMode skipped (transport not ready):', err)
        this.needsSessionRebuild = true
      }
    }
    this.emit({ type: 'permission_mode_change', mode })
  }

  async interrupt(): Promise<void> {
    log.debug(`[ClaudeAgent] interrupt (sessionId=${this.sessionId}, iterationAlive=${this.iterationAlive}, hasQuery=${!!this.sessionQuery}, pendingPerms=${this.pendingPermissions.size}, pendingQs=${this.pendingQuestions.size})`)
    this.interrupted = true
    this.flushPendingQueued()
    rejectAllPending(this.pendingPermissions, this.pendingQuestions, this.pendingPlanApprovals)
    if (this.sessionQuery) {
      await this.sessionQuery.interrupt()
    } else {
      for (const resolve of this.turnResolves.values()) resolve()
      this.turnResolves.clear()
      this.emit({ type: 'status_change', status: 'idle' })
    }
  }

  getSessionId(): string {
    return this.sessionId
  }

  /** Resume a previous session by its ID. Resets current session first. */
  async resumeSession(sessionId: string): Promise<void> {
    if (!this.config || !this.onEvent) throw new Error('ClaudeAgent not initialized')
    log.debug(`[ClaudeAgent] resumeSession start (target=${sessionId}, current=${this.sessionId}, gen=${this.sessionGeneration})`)
    await this.resetSession()
    this.sessionId = sessionId
    this.createSession(sessionId)
    log.debug(`[ClaudeAgent] resumeSession done (gen=${this.sessionGeneration})`)
  }

  /** Rewind files to the state before a given user message. */
  async rewindFiles(userMessageId: string): Promise<RewindFilesResult> {
    this.createSession()
    log.info('[rewind] rewindFiles called: userMessageId=%s hasQuery=%s', userMessageId, !!this.sessionQuery)
    if (!this.sessionQuery) {
      return { canRewind: false, error: 'No active session' }
    }
    try {
      const result = await this.sessionQuery.rewindFiles(userMessageId)
      log.info('[rewind] rewindFiles result: %s', JSON.stringify(result))
      return {
        canRewind: result.canRewind,
        error: result.error,
        filesChanged: result.filesChanged,
        insertions: result.insertions,
        deletions: result.deletions,
      }
    } catch (err) {
      log.error('[rewind] rewindFiles error: %s', err instanceof Error ? err.message : String(err))
      return { canRewind: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  /** Preview file rewind without modifying files (dry run). */
  async previewRewind(userMessageId: string): Promise<RewindFilesResult> {
    this.createSession()
    log.info('[rewind] previewRewind called: userMessageId=%s hasQuery=%s', userMessageId, !!this.sessionQuery)
    if (!this.sessionQuery) {
      return { canRewind: false, error: 'No active session' }
    }
    try {
      const result = await this.sessionQuery.rewindFiles(userMessageId, { dryRun: true })
      log.info('[rewind] previewRewind result: %s', JSON.stringify(result))
      return {
        canRewind: result.canRewind,
        error: result.error,
        filesChanged: result.filesChanged,
        insertions: result.insertions,
        deletions: result.deletions,
      }
    } catch (err) {
      log.error('[rewind] previewRewind error: %s', err instanceof Error ? err.message : String(err))
      return { canRewind: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async rewindCodeAndChat(userMessageId: string): Promise<RewindFilesResult> {
    return this.rewindFiles(userMessageId)
  }

  async rewindConversation(): Promise<RewindFilesResult> {
    return { canRewind: true }
  }

  async reconnectMcpServer(serverName: string): Promise<void> {
    if (!this.sessionQuery) throw new Error('No active session')
    await this.sessionQuery.reconnectMcpServer(serverName)
  }

  async toggleMcpServer(serverName: string, enabled: boolean): Promise<void> {
    if (!this.sessionQuery) throw new Error('No active session')
    log.info(`[MCP] toggleMcpServer("${serverName}", ${enabled}) — calling SDK...`)
    try {
      const result = await this.sessionQuery.toggleMcpServer(serverName, enabled)
      log.info(`[MCP] toggleMcpServer result:`, JSON.stringify(result))
    } catch (err) {
      log.error(`[MCP] toggleMcpServer error:`, err)
      throw err
    }
  }

  /** Reset session and recreate with resume, preserving conversation history. */
  async refreshSession(): Promise<void> {
    const prevSessionId = this.sessionId
    log.info(`[MCP] refreshSession — resetting (sessionId=${prevSessionId})...`)
    await this.resetSession()
    this.createSession(prevSessionId || undefined)
    log.info(`[MCP] refreshSession — session recreated (resume=${prevSessionId || 'none'})`)
  }

  async getContextUsage(): Promise<ContextUsageInfo | null> {
    if (!this.sessionQuery) return null
    try {
      const usage = await this.sessionQuery.getContextUsage()
      return {
        categories: usage.categories.map((c) => ({ name: c.name, tokens: c.tokens, color: c.color })),
        totalTokens: usage.totalTokens,
        maxTokens: usage.maxTokens,
        percentage: usage.percentage,
        model: usage.model,
      }
    } catch {
      return null
    }
  }

  async reloadPlugins(): Promise<boolean> {
    if (!this.sessionQuery) return false
    try {
      await this.sessionQuery.reloadPlugins()
      return true
    } catch {
      return false
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
        tools: s.tools?.map((t: { name: string; description?: string }) => ({
          name: t.name,
          description: t.description,
        })),
      }))
    } catch {
      return []
    }
  }


  listDirectory(relativePath: string): ListDirEntry[] {
    if (!this.config) return []
    const cwd = this.config.cwd
    const target = resolve(cwd, relativePath)

    // Security: ensure target is within cwd
    if (!target.startsWith(cwd)) return []

    if (!existsSync(target)) return []

    try {
      const entries = readdirSync(target, { withFileTypes: true })
      const result: ListDirEntry[] = []
      for (const entry of entries) {
        if (EXCLUDED_DIRS.has(entry.name)) continue
        result.push({ name: entry.name, isDirectory: entry.isDirectory() })
      }
      // Sort: directories first, then alphabetically
      result.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
        return a.name.localeCompare(b.name)
      })
      return result
    } catch {
      return []
    }
  }

  /** Find the 1-based line number where `text` first appears in a file. */
  findLineNumber(filePath: string, text: string): number | null {
    try {
      const content = readFileSync(filePath, 'utf-8')
      const idx = content.indexOf(text)
      if (idx === -1) return null
      return content.substring(0, idx).split('\n').length
    } catch {
      return null
    }
  }

  getCwd(): string {
    return this.config?.cwd ?? ''
  }

  isReady(): boolean {
    return this.ready
  }

  async resetSession(): Promise<void> {
    this.pendingQueued = []
    for (const resolve of this.turnResolves.values()) resolve()
    this.turnResolves.clear()

    const savedOnEvent = this.onEvent
    this.onEvent = null

    this.sessionAbort?.abort()
    if (this.sessionQuery) {
      this.sessionQuery.close()
    }
    if (this.bridge) {
      this.bridge.close()
    }

    if (this.iterationDone) {
      await this.iterationDone.catch(() => {})
    }

    rejectAllPending(this.pendingPermissions, this.pendingQuestions, this.pendingPlanApprovals)
    this.bridge = null
    this.sessionQuery = null
    this.sessionAbort = null
    this.iterationDone = null
    this.iterationAlive = false
    this.sessionId = ''
    this.currentMessageId = ''
    this.interrupted = false

    this.onEvent = savedOnEvent
  }

  async dispose(): Promise<void> {
    this.pendingQueued = []
    for (const resolve of this.turnResolves.values()) resolve()
    this.turnResolves.clear()
    this.onEvent = null

    this.sessionAbort?.abort()
    if (this.bridge) {
      this.bridge.close()
    }
    rejectAllPending(this.pendingPermissions, this.pendingQuestions, this.pendingPlanApprovals)
    this.bridge = null
    this.sessionQuery = null
    this.sessionAbort = null
    this.iterationDone = null
    this.iterationAlive = false
    this.ready = false
    this.config = null
  }

  private flushPendingQueued(): void {
    if (!this.bridge || this.pendingQueued.length === 0) return
    for (const item of this.pendingQueued) {
      this.bridge.push(item.msg, item.clientMessageId)
    }
    this.pendingQueued = []
  }

  dequeueMessage(clientMessageId: string): boolean {
    const idx = this.pendingQueued.findIndex((p) => p.clientMessageId === clientMessageId)
    if (idx !== -1) {
      this.pendingQueued.splice(idx, 1)
      return true
    }
    return this.bridge?.dequeue(clientMessageId) ?? false
  }

  isStreaming(): boolean {
    return this.turnResolves.size > 0
  }

  /** Replace the event emitter (used when moving agent between project paths). */
  updateEventEmitter(onEvent: (event: AgentEvent) => void): void {
    this.onEvent = onEvent
  }

  private emit(event: AgentEvent): void {
    trace('agent.emit', event.type, event, (event as Record<string, unknown>).messageId as string ?? this.currentMessageId)
    this.onEvent?.({ ...event, sessionId: this.sessionId || undefined })

    if (
      event.type === 'message_complete' ||
      event.type === 'message_interrupted' ||
      event.type === 'message_error'
    ) {
      const mid = (event as { messageId?: string }).messageId ?? this.currentMessageId
      const resolve = this.turnResolves.get(mid)
      if (resolve) {
        resolve()
        this.turnResolves.delete(mid)
      }
    }
  }
}
