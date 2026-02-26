import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import log from '../logger'
import { join, resolve } from 'path'
import { homedir } from 'os'
import { randomUUID } from 'crypto'
import type { Query, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { AgentEvent, AgentInfo, ChatMessage, ListDirEntry, McpServerInfo, PermissionMode, RewindFilesResult, SandboxInfo, SandboxMode, SendMessageRequest, SlashCommandInfo } from '../../shared/agent-types'
import { createCanUseTool, dismissQuestion, rejectAllPending, respondToPermission, respondToQuestion, respondToPlanApproval, type PendingPermission, type PendingQuestion, type PendingPlanApproval } from './claude-permissions'
import { MessageBridge } from './message-bridge'
import { createSessionQuery, buildUserMessage } from './claude-query'
import { discoverSkills, discoverProjectCommands, discoverProjectAgents } from './discover-resources'


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

const EXCLUDED_DIRS = new Set(['.', 'node_modules', 'dist', 'build', '__pycache__'])

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
  private turnResolve: (() => void) | null = null

  private ready = false
  private currentPermissionMode: PermissionMode = 'default'
  private currentSandboxInfo: SandboxInfo = DEFAULT_SANDBOX_INFO
  private additionalDirs: string[] = []
  private currentEffort: SendMessageRequest['effort'] = undefined
  private pendingPermissions = new Map<string, PendingPermission>()
  private pendingQuestions = new Map<string, PendingQuestion>()
  private pendingPlanApprovals = new Map<string, PendingPlanApproval>()

  async initialize(
    config: ClaudeAgentConfig,
    onEvent: (event: AgentEvent) => void,
    resumeSessionId?: string,
  ): Promise<void> {
    this.config = config
    this.onEvent = onEvent
    this.ready = true

    // Cache agents at init time
    // Eagerly create session — triggers system init, makes slash commands/models/MCP available
    this.createSession(resumeSessionId)
  }

  /** Create a new session (bridge + query). Safe to call if session already exists (no-op). */
  private createSession(resumeSessionId?: string, resumeSessionAt?: string, forkSession?: boolean, forkedSessionId?: string): void {
    resumeSessionId = resumeSessionId || this.sessionId || undefined

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
    this.sessionAbort = new AbortController()
    const { canUseTool, trackPlanFile } = createCanUseTool(this.pendingPermissions, this.pendingQuestions, this.pendingPlanApprovals, (e) => this.emit(e))

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
      },
      (e) => this.emit(e),
      () => this.currentMessageId,
      () => this.currentStartTime,
      () => this.interrupted,
      (id) => {
        const isNew = this.sessionId !== id
        this.sessionId = id
        if (isNew) this.emitSessionInit()
      },
    )

    this.sessionQuery = handle.query
    this.iterationDone = handle.iterationDone
    this.iterationAlive = true
    const gen = ++this.sessionGeneration
    log.debug(`[ClaudeAgent] createSession gen=${gen} resume=${resumeSessionId ?? 'none'}`)
    this.iterationDone.then(() => {
      log.debug(`[ClaudeAgent] iterationDone.then gen=${gen} currentGen=${this.sessionGeneration} sessionId=${this.sessionId} bridge=${!!this.bridge}`)
      if (gen === this.sessionGeneration) {
        this.iterationAlive = false
      } else {
        log.warn(`[ClaudeAgent] STALE iterationDone.then — skipping iterationAlive=false (gen=${gen} != ${this.sessionGeneration})`)
      }
    }).catch((err) => {
      log.debug(`[ClaudeAgent] iterationDone.catch gen=${gen} currentGen=${this.sessionGeneration} sessionId=${this.sessionId} err=${err instanceof Error ? err.message : String(err)}`)
      if (gen === this.sessionGeneration) {
        this.iterationAlive = false
      } else {
        log.warn(`[ClaudeAgent] STALE iterationDone.catch — skipping iterationAlive=false (gen=${gen} != ${this.sessionGeneration})`)
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
    })
  }

  async sendMessage(request: SendMessageRequest): Promise<void> {
    if (!this.config || !this.onEvent) {
      throw new Error('ClaudeAgent not initialized')
    }

    // If effort changed, refresh session to apply new effort level
    if (request.effort !== this.currentEffort && this.bridge) {
      const prevSessionId = this.sessionId
      await this.resetSession()
      this.currentEffort = request.effort
      this.createSession(prevSessionId || undefined)
    } else {
      this.currentEffort = request.effort
    }

    // If additionalDirs changed, refresh session to apply new directories
    if (request.additionalDirs) {
      const sorted = [...request.additionalDirs].sort()
      const current = [...this.additionalDirs].sort()
      if (JSON.stringify(sorted) !== JSON.stringify(current)) {
        const added = request.additionalDirs.filter(d => !this.additionalDirs.includes(d))
        const removed = this.additionalDirs.filter(d => !request.additionalDirs!.includes(d))
        const prevSessionId = this.sessionId
        await this.resetSession()
        this.additionalDirs = request.additionalDirs
        this.createSession(prevSessionId || undefined)

        const lines = [
          ...added.map(d => `Added ${d} as a working directory`),
          ...removed.map(d => `Removed ${d} from working directories`),
        ]
        if (lines.length > 0) {
          this.bridge!.push({
            type: 'user',
            message: { role: 'user', content: `<local-command-stdout>\n${lines.join('\n')}\n</local-command-stdout>` },
            parent_tool_use_id: null,
            session_id: this.sessionId!,
          } as SDKUserMessage)
        }
      }
    }

    log.debug(`[ClaudeAgent] sendMessage (sessionId=${this.sessionId}, bridge=${!!this.bridge}, iterationAlive=${this.iterationAlive}, gen=${this.sessionGeneration})`)
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

    if (request.model && this.sessionQuery) {
      try {
        await this.sessionQuery.setModel(request.model)
      } catch { /* transport may not be ready yet after fork */ }
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

  respondToPermission(requestId: string, allow: boolean, alwaysAllow?: boolean, reason?: string, selectedSuggestions?: number[]): void {
    respondToPermission(this.pendingPermissions, requestId, allow, alwaysAllow, reason, selectedSuggestions)
  }

  respondToQuestion(requestId: string, answers: Record<string, string>): void {
    respondToQuestion(this.pendingQuestions, requestId, answers)
  }

  dismissQuestion(requestId: string): void {
    dismissQuestion(this.pendingQuestions, requestId)
  }

  respondToPlanApproval(requestId: string, approved: boolean, feedback?: string): void {
    respondToPlanApproval(this.pendingPlanApprovals, requestId, approved, feedback)
  }

  setSandboxMode(mode: SandboxMode): SandboxInfo {
    this.currentSandboxInfo = {
      enabled: mode !== 'off',
      autoAllowBash: mode === 'auto',
    }
    return this.currentSandboxInfo
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    this.currentPermissionMode = mode
    if (this.sessionQuery) {
      await this.sessionQuery.setPermissionMode(mode)
    }
    this.emit({ type: 'permission_mode_change', mode })
  }

  async interrupt(): Promise<void> {
    log.debug(`[ClaudeAgent] interrupt (sessionId=${this.sessionId}, iterationAlive=${this.iterationAlive}, hasQuery=${!!this.sessionQuery}, pendingPerms=${this.pendingPermissions.size}, pendingQs=${this.pendingQuestions.size})`)
    this.interrupted = true
    rejectAllPending(this.pendingPermissions, this.pendingQuestions, this.pendingPlanApprovals)
    if (this.sessionQuery) {
      await this.sessionQuery.interrupt()
    } else {
      this.turnResolve?.()
      this.turnResolve = null
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

  /** Preview file rewind without modifying files (dry run). */
  async previewRewind(userMessageId: string): Promise<RewindFilesResult> {
    if (!this.sessionQuery) {
      return { canRewind: false, error: 'No active session' }
    }
    try {
      const result = await this.sessionQuery.rewindFiles(userMessageId, { dryRun: true })
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

  async rewindCodeAndChat(userMessageId: string, resumePointId: string): Promise<RewindFilesResult> {
    if (!this.sessionQuery) {
      return { canRewind: false, error: 'No active session' }
    }
    try {
      const result = await this.sessionQuery.rewindFiles(userMessageId)
      if (!result.canRewind) return result

      const prevSessionId = this.sessionId
      const forkedId = randomUUID()
      await this.resetSession()
      this.createSession(prevSessionId, resumePointId, true, forkedId)

      return {
        canRewind: result.canRewind,
        error: result.error,
        filesChanged: result.filesChanged,
        insertions: result.insertions,
        deletions: result.deletions,
        forkedSessionId: forkedId,
      }
    } catch (err) {
      return { canRewind: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async rewindConversation(_userMessageId: string, resumePointId: string): Promise<RewindFilesResult> {
    if (!this.sessionQuery) {
      return { canRewind: false, error: 'No active session' }
    }
    try {
      const prevSessionId = this.sessionId
      const forkedId = randomUUID()
      await this.resetSession()
      this.createSession(prevSessionId, resumePointId, true, forkedId)
      return { canRewind: true, forkedSessionId: forkedId }
    } catch (err) {
      return { canRewind: false, error: err instanceof Error ? err.message : String(err) }
    }
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
        // Skip hidden dirs/files and common build directories
        if (entry.name.startsWith('.') && entry.isDirectory()) continue
        if (entry.isDirectory() && EXCLUDED_DIRS.has(entry.name)) continue
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

  /** Close the current session and reset state for a new one. */
  async resetSession(): Promise<void> {
    this.turnResolve?.()
    this.turnResolve = null

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
    this.turnResolve?.()
    this.turnResolve = null
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

  /** Emit session_init once sessionId is available. */
  private emitSessionInit(): void {
    if (!this.sessionId) return
    this.emit({
      type: 'session_init',
      session: {
        sessionId: this.sessionId,
        model: '',
        tools: [],
        mcpServers: [],
        permissionMode: this.currentPermissionMode,
        slashCommands: [],
        skills: [],
        claudeCodeVersion: '',
        cwd: this.config!.cwd,
      },
    })
  }

  isStreaming(): boolean {
    return this.turnResolve !== null
  }

  /** Replace the event emitter (used when moving agent between project paths). */
  updateEventEmitter(onEvent: (event: AgentEvent) => void): void {
    this.onEvent = onEvent
  }

  private emit(event: AgentEvent): void {
    this.onEvent?.({ ...event, sessionId: this.sessionId || undefined })

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
