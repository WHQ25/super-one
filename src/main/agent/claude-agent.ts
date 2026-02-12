import { existsSync, readdirSync, readFileSync } from 'fs'
import { join, resolve } from 'path'
import { homedir } from 'os'
import type { Query } from '@anthropic-ai/claude-agent-sdk'
import type { AccountInfo, AgentEvent, AgentInfo, ChatMessage, ListDirEntry, McpServerInfo, ModelOption, PermissionMode, RewindFilesResult, SandboxInfo, SendMessageRequest, SlashCommandInfo } from '../../shared/agent-types'
import { createCanUseTool, dismissQuestion, rejectAllPending, respondToPermission, respondToQuestion, respondToPlanApproval, type PendingPermission, type PendingQuestion, type PendingPlanApproval } from './claude-permissions'
import { mapModelInfo } from './claude-models'
import { MessageBridge } from './message-bridge'
import { createSessionQuery, buildUserMessage } from './claude-query'

/** Scan skill directories and return a Set of skill names. */
function discoverSkillNames(cwd: string): Set<string> {
  const names = new Set<string>()

  // 1. User + project skills
  for (const dir of [join(homedir(), '.claude', 'skills'), join(cwd, '.claude', 'skills')]) {
    if (!existsSync(dir)) continue
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (existsSync(join(dir, entry.name, 'SKILL.md'))) {
        names.add(entry.name)
      }
    }
  }

  // 2. Plugin skills
  const pluginsFile = join(homedir(), '.claude', 'plugins', 'installed_plugins.json')
  if (existsSync(pluginsFile)) {
    try {
      const data = JSON.parse(readFileSync(pluginsFile, 'utf-8'))
      const plugins: Record<string, Array<{ scope?: string; installPath?: string; projectPath?: string }>> = data.plugins ?? {}
      for (const entries of Object.values(plugins)) {
        for (const entry of entries) {
          const { scope, installPath, projectPath } = entry
          if (!installPath) continue
          const include = scope === 'user' || ((scope === 'project' || scope === 'local') && projectPath === cwd)
          if (!include) continue
          const skillsDir = join(installPath, 'skills')
          if (!existsSync(skillsDir)) continue
          for (const s of readdirSync(skillsDir, { withFileTypes: true })) {
            if (existsSync(join(skillsDir, s.name, 'SKILL.md'))) {
              names.add(s.name)
            }
          }
        }
      }
    } catch {}
  }

  return names
}

/** Read .md files from a directory and return AgentInfo entries. */
function scanAgentDir(dir: string, source: AgentInfo['source'], namePrefix = ''): AgentInfo[] {
  if (!existsSync(dir)) return []
  const agents: AgentInfo[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue
    const name = namePrefix + entry.name.replace(/\.md$/, '')
    let description = ''
    try {
      const first = readFileSync(join(dir, entry.name), 'utf-8').split('\n')[0]
      description = first.replace(/^#+\s*/, '').trim()
    } catch {}
    agents.push({ name, description, source })
  }
  return agents
}

/** Discover agents from user, project, and plugin sources. */
function discoverAgents(cwd: string): AgentInfo[] {
  const agents: AgentInfo[] = []

  // 1. User agents: ~/.claude/agents/*.md
  agents.push(...scanAgentDir(join(homedir(), '.claude', 'agents'), 'user'))

  // 2. Project agents: {cwd}/.claude/agents/*.md
  agents.push(...scanAgentDir(join(cwd, '.claude', 'agents'), 'project'))

  // 3. Plugin agents
  const pluginsFile = join(homedir(), '.claude', 'plugins', 'installed_plugins.json')
  if (existsSync(pluginsFile)) {
    try {
      const data = JSON.parse(readFileSync(pluginsFile, 'utf-8'))
      const plugins: Record<string, Array<{ scope?: string; installPath?: string; projectPath?: string }>> = data.plugins ?? {}
      for (const [pluginKey, entries] of Object.entries(plugins)) {
        // Extract the plugin name (part before @, e.g. "code-simplifier" from "code-simplifier@claude-plugins-official")
        const pluginName = pluginKey.split('@')[0]
        for (const entry of entries) {
          const { scope, installPath, projectPath } = entry
          if (!installPath) continue
          const include = scope === 'user' || ((scope === 'project' || scope === 'local') && projectPath === cwd)
          if (!include) continue
          agents.push(...scanAgentDir(join(installPath, 'agents'), 'plugin', `${pluginName}:`))
        }
      }
    } catch {}
  }

  return agents
}

/** Read sandbox settings from Claude Code settings files (local > project > user). */
function readSandboxInfo(cwd: string): SandboxInfo {
  const sources = [
    join(cwd, '.claude', 'settings.local.json'),
    join(cwd, '.claude', 'settings.json'),
    join(homedir(), '.claude', 'settings.json'),
  ]
  for (const path of sources) {
    try {
      const data = JSON.parse(readFileSync(path, 'utf-8'))
      if (data.sandbox && typeof data.sandbox === 'object') {
        return {
          enabled: data.sandbox.enabled === true,
          autoAllowBash: data.sandbox.autoAllowBashIfSandboxed === true,
        }
      }
    } catch { /* file doesn't exist or is invalid */ }
  }
  return { enabled: false, autoAllowBash: false }
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
  private sessionId = ''

  // Per-turn state
  private currentMessageId = ''
  private currentStartTime = 0
  private interrupted = false
  private turnResolve: (() => void) | null = null

  private ready = false
  private cachedModels: ModelOption[] = []
  private cachedSlashCommands: SlashCommandInfo[] | null = null
  private cachedAccount: AccountInfo | null = null
  private currentPermissionMode: PermissionMode = 'default'
  private cachedAgents: AgentInfo[] = []
  private initReady = false // true after initializationResult() resolves
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
    this.cachedAgents = discoverAgents(config.cwd)

    // Eagerly create session — triggers system init, makes slash commands/models/MCP available
    this.createSession(resumeSessionId)
  }

  /** Create a new session (bridge + query). Safe to call if session already exists (no-op). */
  private createSession(resumeSessionId?: string): void {
    if (this.bridge) return

    this.bridge = new MessageBridge()
    this.sessionAbort = new AbortController()
    const { canUseTool, trackPlanFile } = createCanUseTool(this.pendingPermissions, this.pendingQuestions, this.pendingPlanApprovals, (e) => this.emit(e))

    const handle = createSessionQuery(
      this.bridge,
      {
        cwd: this.config!.cwd,
        model: this.config!.model,
        permissionMode: this.currentPermissionMode,
        canUseTool,
        trackPlanFile,
        resume: resumeSessionId,
        abortController: this.sessionAbort,
      },
      (e) => this.emit(e),
      () => this.currentMessageId,
      () => this.currentStartTime,
      () => this.interrupted,
      (id) => {
        this.sessionId = id
        // If initializationResult() already resolved, emit session_init now
        if (this.initReady) this.emitSessionInit()
      },
    )

    this.sessionQuery = handle.query
    this.iterationDone = handle.iterationDone

    // Eagerly fetch init result via control channel and cache everything
    handle.query.initializationResult().then((init) => {
      const skillNames = discoverSkillNames(this.config!.cwd)

      this.cachedModels = init.models.map(mapModelInfo)
      this.cachedAccount = {
        email: init.account.email,
        organization: init.account.organization,
        subscriptionType: init.account.subscriptionType,
      }
      this.cachedSlashCommands = init.commands.map((c) => ({
        name: c.name,
        description: c.description,
        argumentHint: c.argumentHint,
        isSkill: skillNames.has(c.name),
      }))

      this.initReady = true

      // If sessionId already arrived via iterator, emit session_init now
      if (this.sessionId) this.emitSessionInit()

      this.emit({ type: 'init_ready', models: this.cachedModels, slashCommands: this.cachedSlashCommands, cwd: this.config!.cwd, homedir: homedir(), sandboxInfo: readSandboxInfo(this.config!.cwd) })
    }).catch(() => {})
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

  respondToPermission(requestId: string, allow: boolean, alwaysAllow?: boolean, reason?: string): void {
    respondToPermission(this.pendingPermissions, requestId, allow, alwaysAllow, reason)
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

  async reconnectMcpServer(serverName: string): Promise<void> {
    if (!this.sessionQuery) throw new Error('No active session')
    await this.sessionQuery.reconnectMcpServer(serverName)
  }

  async toggleMcpServer(serverName: string, enabled: boolean): Promise<void> {
    if (!this.sessionQuery) throw new Error('No active session')
    console.log(`[MCP] toggleMcpServer("${serverName}", ${enabled}) — calling SDK...`)
    try {
      const result = await this.sessionQuery.toggleMcpServer(serverName, enabled)
      console.log(`[MCP] toggleMcpServer result:`, JSON.stringify(result))
    } catch (err) {
      console.error(`[MCP] toggleMcpServer error:`, err)
      throw err
    }
  }

  /** Reset session and recreate with resume, preserving conversation history. */
  async refreshSession(): Promise<void> {
    const prevSessionId = this.sessionId
    console.log(`[MCP] refreshSession — resetting (sessionId=${prevSessionId})...`)
    await this.resetSession()
    this.createSession(prevSessionId || undefined)
    console.log(`[MCP] refreshSession — session recreated (resume=${prevSessionId || 'none'})`)
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

  async getAccountInfo(): Promise<AccountInfo> {
    return this.cachedAccount ?? {}
  }

  async getSlashCommands(): Promise<SlashCommandInfo[]> {
    return this.cachedSlashCommands ?? []
  }

  getAgents(): AgentInfo[] {
    return this.cachedAgents
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
    // Resolve any pending sendMessage awaiter
    this.turnResolve?.()
    this.turnResolve = null

    this.sessionAbort?.abort()
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

    rejectAllPending(this.pendingPermissions, this.pendingQuestions, this.pendingPlanApprovals)
    this.bridge = null
    this.sessionQuery = null
    this.sessionAbort = null
    this.iterationDone = null
    this.sessionId = ''
    this.initReady = false
    this.currentMessageId = ''
    this.cachedSlashCommands = null
    this.cachedAccount = null
  }

  async dispose(): Promise<void> {
    // Force-close without waiting for iteration loop (unlike resetSession which
    // awaits iterationDone to ensure clean state for a new session).
    this.turnResolve?.()
    this.turnResolve = null
    this.sessionAbort?.abort()
    if (this.bridge) {
      this.bridge.close()
    }
    rejectAllPending(this.pendingPermissions, this.pendingQuestions, this.pendingPlanApprovals)
    this.bridge = null
    this.sessionQuery = null
    this.sessionAbort = null
    this.iterationDone = null
    this.ready = false
    this.config = null
    this.onEvent = null
    this.cachedModels = []
  }

  async getAvailableModels(): Promise<ModelOption[]> {
    return this.cachedModels
  }

  /** Emit session_init once both sessionId and init data are available. */
  private emitSessionInit(): void {
    if (!this.sessionId || !this.cachedSlashCommands) return
    this.emit({
      type: 'session_init',
      session: {
        sessionId: this.sessionId,
        model: this.cachedModels[0]?.id ?? '',
        tools: [],
        mcpServers: [],
        permissionMode: this.currentPermissionMode,
        slashCommands: this.cachedSlashCommands.map((c) => c.name),
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
