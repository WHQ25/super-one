import { execFileSync } from 'child_process'
import { resolve } from 'path'
import { ipcMain, type BrowserWindow } from 'electron'
import { ClaudeAgent, type ClaudeAgentConfig } from './claude-agent'
import { AgentIpcChannels, type AgentEvent, type PermissionMode, type ResourceScope, type SandboxMode, type SendMessageRequest } from '../../shared/agent-types'

/** Resolve a path to its git common directory (shared across worktrees). */
function getGitRoot(cwd: string): string {
  try {
    const raw = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd, encoding: 'utf-8' }).trim()
    // --git-common-dir returns relative or absolute; resolve relative to cwd
    return resolve(cwd, raw)
  } catch {
    return cwd // Fallback: not a git repo, use path itself
  }
}
import { listSessionsForFolder, createSession, renameSession as dbRenameSession, saveSessionState, loadSessionState, deleteSession as dbDeleteSession, pinSession as dbPinSession, listPinnedSessions } from '../db-sessions'
import { listMcpConfigs, saveMcpConfig, deleteMcpConfig, toggleMcpConfig } from '../mcp-config-service'
import { checkMcpServers } from '../mcp-probe-service'
import { authorizeHttpMcpServer } from '../mcp-oauth'
import { listSkills, readSkillContent, readSkillFile, installSkill, deleteSkill, listCodexSkills, readCodexSkillContent, readCodexSkillFile } from '../skills-service'
import { listCodexMcpConfigs } from '../codex-config-service'
import { discoverAllAgents, readAgentFile } from './discover-resources'
import { listPlugins, readPluginContent, readPluginFile, deletePlugin, listMarketplacePlugins, installPlugin, updatePlugin, updateMarketplace } from '../plugins-service'
import { backupMcpServers, listLibrary, deleteLibraryEntry } from '../mcp-library-service'

export class AgentService {
  private agents = new Map<string, ClaudeAgent>()
  private bgAgents = new Map<string, { agent: ClaudeAgent; projectPath: string; gitRoot: string }>()
  private mainWindow: BrowserWindow | null = null

  private getAgent(projectPath: string): ClaudeAgent {
    const agent = this.agents.get(projectPath)
    if (!agent) throw new Error(`No agent for project: ${projectPath}`)
    return agent
  }

  private createEventEmitter(projectPath: string): (event: AgentEvent) => void {
    return (event: AgentEvent) => {
      this.mainWindow?.webContents.send(AgentIpcChannels.EVENT, { ...event, projectPath })

      // Auto-dispose background agents when they go idle
      if (event.type === 'status_change' && event.status === 'idle' && event.sessionId) {
        const bg = this.bgAgents.get(event.sessionId)
        if (bg) {
          this.bgAgents.delete(event.sessionId)
          bg.agent.dispose().catch(() => {})
        }
      }
    }
  }

  /** Move the current active agent into background, keyed by its sessionId.
   *  Only parks streaming agents; idle agents are disposed immediately (Fix 4). */
  private async parkSession(projectPath: string): Promise<void> {
    const current = this.agents.get(projectPath)
    if (current) {
      const sid = current.getSessionId()
      if (sid && current.isStreaming()) {
        this.bgAgents.set(sid, { agent: current, projectPath, gitRoot: getGitRoot(projectPath) })
      } else {
        await current.dispose()
      }
    }
    this.agents.delete(projectPath)
  }

  /** Check if a session exists in the background for the same git project. */
  private hasBgSession(projectPath: string, sessionId: string): boolean {
    const bg = this.bgAgents.get(sessionId)
    return !!bg && bg.gitRoot === getGitRoot(projectPath)
  }

  /** Restore a background agent as the active agent for the project.
   *  Validates git root ownership to prevent cross-project session hijacking. */
  private async activateSession(projectPath: string, sessionId: string): Promise<void> {
    const bg = this.bgAgents.get(sessionId)
    if (!bg) throw new Error(`No background session: ${sessionId}`)
    if (bg.gitRoot !== getGitRoot(projectPath)) {
      throw new Error(`Session ${sessionId} belongs to project ${bg.projectPath}, not ${projectPath}`)
    }

    // Park the currently active agent first
    await this.parkSession(projectPath)

    // Rebind event emitter to the new projectPath so events route correctly
    if (bg.projectPath !== projectPath) {
      bg.agent.updateEventEmitter(this.createEventEmitter(projectPath))
    }

    // Promote the background agent to active
    this.agents.set(projectPath, bg.agent)
    this.bgAgents.delete(sessionId)
  }

  setMainWindow(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow
  }

  setup(): void {

    // --- Session-scoped handlers (projectPath as first arg) ---

    ipcMain.handle(AgentIpcChannels.SEND_MESSAGE, async (_event, projectPath: string, request: SendMessageRequest) => {
      const agent = this.getAgent(projectPath)
      if (!agent.isReady()) throw new Error('Agent not initialized')
      await agent.sendMessage(request)
    })

    ipcMain.handle(AgentIpcChannels.INTERRUPT, async (_event, projectPath: string) => {
      await this.getAgent(projectPath).interrupt()
    })

    ipcMain.handle(AgentIpcChannels.PERMISSION_RESPONSE, (_event, projectPath: string, requestId: string, allow: boolean, alwaysAllow?: boolean, reason?: string) => {
      this.getAgent(projectPath).respondToPermission(requestId, allow, alwaysAllow, reason)
    })

    ipcMain.handle(AgentIpcChannels.SET_PERMISSION_MODE, async (_event, projectPath: string, mode: PermissionMode) => {
      await this.getAgent(projectPath).setPermissionMode(mode)
    })

    ipcMain.handle(AgentIpcChannels.SET_SANDBOX_MODE, (_event, projectPath: string, mode: SandboxMode) => {
      return this.getAgent(projectPath).setSandboxMode(mode)
    })

    ipcMain.handle(AgentIpcChannels.ANSWER_QUESTION, (_event, projectPath: string, requestId: string, answers: Record<string, string>) => {
      this.getAgent(projectPath).respondToQuestion(requestId, answers)
    })

    ipcMain.handle(AgentIpcChannels.DISMISS_QUESTION, (_event, projectPath: string, requestId: string) => {
      this.getAgent(projectPath).dismissQuestion(requestId)
    })

    ipcMain.handle(AgentIpcChannels.RESPOND_PLAN_APPROVAL, (_event, projectPath: string, requestId: string, approved: boolean, feedback?: string) => {
      this.getAgent(projectPath).respondToPlanApproval(requestId, approved, feedback)
    })

    ipcMain.handle(AgentIpcChannels.RESET_SESSION, async (_event, projectPath: string) => {
      await this.getAgent(projectPath).resetSession()
    })

    ipcMain.handle(AgentIpcChannels.REWIND_FILES, async (_event, projectPath: string, userMessageId: string) => {
      return this.getAgent(projectPath).rewindFiles(userMessageId)
    })

    ipcMain.handle(AgentIpcChannels.GET_SESSION_ID, (_event, projectPath: string) => {
      return this.getAgent(projectPath).getSessionId()
    })

    ipcMain.handle(AgentIpcChannels.MCP_SERVER_STATUS, async (_event, projectPath: string) => {
      return this.getAgent(projectPath).getMcpServerStatus()
    })

    ipcMain.handle(AgentIpcChannels.LIST_DIRECTORY, async (_event, projectPath: string, relativePath: string) => {
      return this.getAgent(projectPath).listDirectory(relativePath)
    })

    ipcMain.handle(AgentIpcChannels.FIND_LINE_NUMBER, async (_event, projectPath: string, filePath: string, text: string) => {
      return this.getAgent(projectPath).findLineNumber(filePath, text)
    })

    // --- Plugins (session-scoped — need cwd) ---

    ipcMain.handle(AgentIpcChannels.PLUGINS_LIST, (_event, projectPath: string) => {
      return listPlugins(projectPath)
    })

    ipcMain.handle(AgentIpcChannels.PLUGINS_READ, (_event, projectPath: string, key: string) => {
      return readPluginContent(projectPath, key)
    })

    ipcMain.handle(AgentIpcChannels.PLUGINS_READ_FILE, (_event, projectPath: string, key: string, relativePath: string) => {
      return readPluginFile(projectPath, key, relativePath)
    })

    ipcMain.handle(AgentIpcChannels.PLUGINS_DELETE, (_event, projectPath: string, key: string, scope: ResourceScope) => {
      deletePlugin(key, scope, projectPath)
    })

    ipcMain.handle(AgentIpcChannels.PLUGINS_LIST_MARKETPLACE, (_event, projectPath: string) => {
      return listMarketplacePlugins(projectPath)
    })

    ipcMain.handle(AgentIpcChannels.PLUGINS_INSTALL, async (_event, projectPath: string, key: string, scope: ResourceScope) => {
      await installPlugin(key, scope, projectPath)
      try { await this.getAgent(projectPath).refreshSession() } catch { /* session may not be active */ }
    })

    ipcMain.handle(AgentIpcChannels.PLUGINS_UPDATE, async (_event, projectPath: string, updates: Array<{ key: string; scope: ResourceScope }>) => {
      for (const { key, scope } of updates) {
        updatePlugin(key, scope, projectPath)
      }
      try { await this.getAgent(projectPath).refreshSession() } catch { /* session may not be active */ }
    })

    ipcMain.handle(AgentIpcChannels.PLUGINS_UPDATE_MARKETPLACE, async (_event, name: string) => {
      await updateMarketplace(name)
    })

    // --- Skills (session-scoped) ---

    ipcMain.handle(AgentIpcChannels.SKILLS_LIST, (_event, projectPath: string) => {
      return listSkills(projectPath)
    })

    ipcMain.handle(AgentIpcChannels.SKILLS_READ, (_event, projectPath: string, name: string) => {
      return readSkillContent(projectPath, name)
    })

    ipcMain.handle(AgentIpcChannels.SKILLS_READ_FILE, (_event, projectPath: string, skillName: string, relativePath: string) => {
      return readSkillFile(projectPath, skillName, relativePath)
    })

    ipcMain.handle(AgentIpcChannels.SKILLS_INSTALL, (_event, sourcePath: string) => {
      return installSkill(sourcePath)
    })

    ipcMain.handle(AgentIpcChannels.SKILLS_DELETE, (_event, projectPath: string, name: string, scope: ResourceScope) => {
      deleteSkill(name, scope, projectPath)
    })

    // --- Codex Skills (read-only) ---

    ipcMain.handle(AgentIpcChannels.CODEX_SKILLS_LIST, (_event, projectPath: string) => {
      return listCodexSkills(projectPath)
    })

    ipcMain.handle(AgentIpcChannels.CODEX_SKILLS_READ, (_event, projectPath: string, name: string) => {
      return readCodexSkillContent(projectPath, name)
    })

    ipcMain.handle(AgentIpcChannels.CODEX_SKILLS_READ_FILE, (_event, projectPath: string, skillName: string, relativePath: string) => {
      return readCodexSkillFile(projectPath, skillName, relativePath)
    })

    // --- Codex MCP config (read-only) ---

    ipcMain.handle(AgentIpcChannels.CODEX_MCP_LIST_CONFIG, (_event, projectPath: string) => {
      return listCodexMcpConfigs(projectPath)
    })

    // --- Agents (read-only) ---

    ipcMain.handle(AgentIpcChannels.AGENTS_LIST, (_event, projectPath: string) => {
      return discoverAllAgents(projectPath)
    })

    ipcMain.handle(AgentIpcChannels.AGENTS_READ_FILE, (_event, projectPath: string, name: string) => {
      return readAgentFile(projectPath, name)
    })

    // --- MCP config (session-scoped) ---

    ipcMain.handle(AgentIpcChannels.MCP_LIST_CONFIG, (_event, projectPath: string) => {
      return listMcpConfigs(projectPath)
    })

    ipcMain.handle(AgentIpcChannels.MCP_SAVE_CONFIG, async (_event, projectPath: string, name: string, config: Record<string, unknown>, scope: ResourceScope) => {
      saveMcpConfig(name, config, scope, projectPath)
      try {
        await this.getAgent(projectPath).reconnectMcpServer(name)
        await this.getAgent(projectPath).refreshSession()
      } catch { /* session may not be active */ }
    })

    ipcMain.handle(AgentIpcChannels.MCP_DELETE_CONFIG, async (_event, projectPath: string, name: string, scope: ResourceScope) => {
      deleteMcpConfig(name, scope, projectPath)
      try {
        await this.getAgent(projectPath).toggleMcpServer(name, false)
        await this.getAgent(projectPath).refreshSession()
      } catch { /* session may not be active */ }
    })

    ipcMain.handle(AgentIpcChannels.MCP_TOGGLE_CONFIG, async (_event, projectPath: string, name: string, disabled: boolean, scope: ResourceScope) => {
      toggleMcpConfig(name, disabled, scope, projectPath)
      try {
        await this.getAgent(projectPath).toggleMcpServer(name, !disabled)
        await this.getAgent(projectPath).refreshSession()
      } catch { /* session may not be active */ }
    })

    ipcMain.handle(AgentIpcChannels.MCP_CHECK_SERVERS, async (_event, projectPath: string) => {
      const configs = listMcpConfigs(projectPath)
      const result = await checkMcpServers(configs)
      const connectedNames = new Set(result.status.filter((s) => s.status === 'connected').map((s) => s.name))
      const connectedMeta = Object.fromEntries(
        Object.entries(result.meta).filter(([name]) => connectedNames.has(name))
      )
      try { backupMcpServers(configs, connectedMeta) } catch { /* ignore */ }
      return result
    })

    ipcMain.handle(AgentIpcChannels.MCP_OAUTH_AUTHORIZE, async (_event, serverUrl: string, headers?: Record<string, string>, transport?: 'http' | 'sse') => {
      return authorizeHttpMcpServer(serverUrl, headers, transport)
    })

    // --- MCP library (global) ---

    ipcMain.handle(AgentIpcChannels.MCP_LIST_LIBRARY, () => {
      return listLibrary()
    })

    ipcMain.handle(AgentIpcChannels.MCP_DELETE_LIBRARY_ENTRY, (_event, name: string) => {
      deleteLibraryEntry(name)
    })

    // --- Session history (session-scoped) ---

    ipcMain.handle(AgentIpcChannels.SESSIONS_LIST, (_event, projectPath: string) => {
      return listSessionsForFolder(projectPath)
    })

    ipcMain.handle(AgentIpcChannels.SESSIONS_LIST_FOR_FOLDER, (_event, folderPath: string) => {
      return listSessionsForFolder(folderPath)
    })

    ipcMain.handle(AgentIpcChannels.SESSIONS_RESUME, async (_event, projectPath: string, sessionId: string, worktreeCwd?: string) => {
      const effectiveCwd = worktreeCwd ?? projectPath

      // Case 1: Target is in background (same git project) — activate it directly
      if (this.hasBgSession(projectPath, sessionId)) {
        await this.activateSession(projectPath, sessionId)
        return
      }

      const current = this.agents.get(projectPath)
      // Case 2: Current agent is streaming — park it, create new agent to resume target
      if (current && current.isStreaming()) {
        await this.parkSession(projectPath)
        const agent = new ClaudeAgent()
        await agent.initialize({ cwd: effectiveCwd }, this.createEventEmitter(projectPath), sessionId)
        this.agents.set(projectPath, agent)
        return
      }

      // Case 3: Current idle — resume on existing agent
      if (worktreeCwd) {
        // cwd change requires a new agent (can't change cwd of existing process)
        const existing = this.agents.get(projectPath)
        if (existing) await existing.dispose()
        const agent = new ClaudeAgent()
        await agent.initialize({ cwd: worktreeCwd }, this.createEventEmitter(projectPath), sessionId)
        this.agents.set(projectPath, agent)
      } else {
        await this.getAgent(projectPath).resumeSession(sessionId)
      }
    })

    ipcMain.handle(AgentIpcChannels.PARK_SESSION, async (_event, projectPath: string) => {
      await this.parkSession(projectPath)
      // Create a fresh agent for the project
      const agent = new ClaudeAgent()
      await agent.initialize({ cwd: projectPath }, this.createEventEmitter(projectPath))
      this.agents.set(projectPath, agent)
    })

    ipcMain.handle(AgentIpcChannels.ACTIVATE_SESSION, async (_event, projectPath: string, sessionId: string) => {
      await this.activateSession(projectPath, sessionId)
    })

    ipcMain.handle(AgentIpcChannels.SESSIONS_LOAD_MESSAGES, (_event, _projectPath: string, sessionId: string) => {
      return loadSessionState(sessionId)
    })

    ipcMain.handle(AgentIpcChannels.SESSIONS_RENAME, (_event, sessionId: string, title: string) => {
      dbRenameSession(sessionId, title)
    })

    ipcMain.handle(AgentIpcChannels.SESSIONS_CREATE, (_event, projectPath: string, claudeSessionId: string, isWorktree?: boolean, gitBranch?: string) => {
      try { createSession(projectPath, claudeSessionId, undefined, isWorktree, gitBranch) } catch { /* ignore duplicate */ }
    })

    ipcMain.handle(AgentIpcChannels.SESSIONS_SAVE_STATE, (_event, claudeSessionId: string, data: { messages: unknown[]; totalCostUsd: number; contextTokens: number; title?: string; provider?: string }) => {
      saveSessionState(claudeSessionId, data as Parameters<typeof saveSessionState>[1])
    })

    ipcMain.handle(AgentIpcChannels.SESSIONS_LOAD_STATE, (_event, claudeSessionId: string) => {
      return loadSessionState(claudeSessionId)
    })

    ipcMain.handle(AgentIpcChannels.SESSIONS_DELETE, (_event, claudeSessionId: string) => {
      dbDeleteSession(claudeSessionId)
    })

    ipcMain.handle(AgentIpcChannels.SESSIONS_PIN, (_event, claudeSessionId: string, pinned: boolean) => {
      dbPinSession(claudeSessionId, pinned)
    })

    ipcMain.handle(AgentIpcChannels.SESSIONS_LIST_PINNED, () => {
      return listPinnedSessions()
    })
  }

  /** Dispose the current agent for projectPath and recreate it with a new cwd.
   *  The agent is still keyed by projectPath, and events are tagged with projectPath. */
  async switchCwd(projectPath: string, newCwd: string): Promise<void> {
    const existing = this.agents.get(projectPath)
    if (existing) {
      await existing.dispose()
      this.agents.delete(projectPath)
    }
    const agent = new ClaudeAgent()
    await agent.initialize({ cwd: newCwd }, this.createEventEmitter(projectPath))
    this.agents.set(projectPath, agent)
  }

  async openFolder(cwd: string): Promise<void> {
    if (this.agents.has(cwd)) return // Already exists, just switch in renderer
    const agent = new ClaudeAgent()
    await agent.initialize({ cwd }, this.createEventEmitter(cwd))
    this.agents.set(cwd, agent)
  }

  async closeProject(cwd: string): Promise<void> {
    const agent = this.agents.get(cwd)
    if (agent) {
      await agent.dispose()
      this.agents.delete(cwd)
    }

    // Clean up any background agents belonging to this project
    for (const [sid, bg] of this.bgAgents) {
      if (bg.projectPath === cwd) {
        await bg.agent.dispose()
        this.bgAgents.delete(sid)
      }
    }
  }

  hasRunningSessions(): boolean {
    for (const [, agent] of this.agents) {
      if (agent.isStreaming()) return true
    }
    for (const [, bg] of this.bgAgents) {
      if (bg.agent.isStreaming()) return true
    }
    return false
  }

  async dispose(): Promise<void> {
    // Dispose all active agents
    for (const [, agent] of this.agents) {
      await agent.dispose()
    }
    this.agents.clear()

    // Dispose all background agents
    for (const [, bg] of this.bgAgents) {
      await bg.agent.dispose()
    }
    this.bgAgents.clear()

    ipcMain.removeHandler(AgentIpcChannels.SEND_MESSAGE)
    ipcMain.removeHandler(AgentIpcChannels.INTERRUPT)
    ipcMain.removeHandler(AgentIpcChannels.PERMISSION_RESPONSE)
    ipcMain.removeHandler(AgentIpcChannels.SET_PERMISSION_MODE)
    ipcMain.removeHandler(AgentIpcChannels.SET_SANDBOX_MODE)
    ipcMain.removeHandler(AgentIpcChannels.ANSWER_QUESTION)
    ipcMain.removeHandler(AgentIpcChannels.DISMISS_QUESTION)
    ipcMain.removeHandler(AgentIpcChannels.RESPOND_PLAN_APPROVAL)
    ipcMain.removeHandler(AgentIpcChannels.RESET_SESSION)
    ipcMain.removeHandler(AgentIpcChannels.REWIND_FILES)
    ipcMain.removeHandler(AgentIpcChannels.GET_SESSION_ID)
    ipcMain.removeHandler(AgentIpcChannels.MCP_SERVER_STATUS)
    ipcMain.removeHandler(AgentIpcChannels.LIST_DIRECTORY)
    ipcMain.removeHandler(AgentIpcChannels.FIND_LINE_NUMBER)
    ipcMain.removeHandler(AgentIpcChannels.PLUGINS_LIST)
    ipcMain.removeHandler(AgentIpcChannels.PLUGINS_READ)
    ipcMain.removeHandler(AgentIpcChannels.PLUGINS_READ_FILE)
    ipcMain.removeHandler(AgentIpcChannels.PLUGINS_DELETE)
    ipcMain.removeHandler(AgentIpcChannels.PLUGINS_LIST_MARKETPLACE)
    ipcMain.removeHandler(AgentIpcChannels.PLUGINS_INSTALL)
    ipcMain.removeHandler(AgentIpcChannels.PLUGINS_UPDATE)
    ipcMain.removeHandler(AgentIpcChannels.PLUGINS_UPDATE_MARKETPLACE)
    ipcMain.removeHandler(AgentIpcChannels.SKILLS_LIST)
    ipcMain.removeHandler(AgentIpcChannels.SKILLS_READ)
    ipcMain.removeHandler(AgentIpcChannels.SKILLS_READ_FILE)
    ipcMain.removeHandler(AgentIpcChannels.SKILLS_INSTALL)
    ipcMain.removeHandler(AgentIpcChannels.SKILLS_DELETE)
    ipcMain.removeHandler(AgentIpcChannels.CODEX_SKILLS_LIST)
    ipcMain.removeHandler(AgentIpcChannels.CODEX_SKILLS_READ)
    ipcMain.removeHandler(AgentIpcChannels.CODEX_SKILLS_READ_FILE)
    ipcMain.removeHandler(AgentIpcChannels.CODEX_MCP_LIST_CONFIG)
    ipcMain.removeHandler(AgentIpcChannels.AGENTS_LIST)
    ipcMain.removeHandler(AgentIpcChannels.AGENTS_READ_FILE)
    ipcMain.removeHandler(AgentIpcChannels.MCP_LIST_CONFIG)
    ipcMain.removeHandler(AgentIpcChannels.MCP_SAVE_CONFIG)
    ipcMain.removeHandler(AgentIpcChannels.MCP_DELETE_CONFIG)
    ipcMain.removeHandler(AgentIpcChannels.MCP_TOGGLE_CONFIG)
    ipcMain.removeHandler(AgentIpcChannels.MCP_CHECK_SERVERS)
    ipcMain.removeHandler(AgentIpcChannels.MCP_OAUTH_AUTHORIZE)
    ipcMain.removeHandler(AgentIpcChannels.MCP_LIST_LIBRARY)
    ipcMain.removeHandler(AgentIpcChannels.MCP_DELETE_LIBRARY_ENTRY)
    ipcMain.removeHandler(AgentIpcChannels.PARK_SESSION)
    ipcMain.removeHandler(AgentIpcChannels.ACTIVATE_SESSION)
    ipcMain.removeHandler(AgentIpcChannels.SESSIONS_LIST)
    ipcMain.removeHandler(AgentIpcChannels.SESSIONS_LIST_FOR_FOLDER)
    ipcMain.removeHandler(AgentIpcChannels.SESSIONS_RESUME)
    ipcMain.removeHandler(AgentIpcChannels.SESSIONS_LOAD_MESSAGES)
    ipcMain.removeHandler(AgentIpcChannels.SESSIONS_RENAME)
    ipcMain.removeHandler(AgentIpcChannels.SESSIONS_CREATE)
    ipcMain.removeHandler(AgentIpcChannels.SESSIONS_SAVE_STATE)
    ipcMain.removeHandler(AgentIpcChannels.SESSIONS_LOAD_STATE)
    ipcMain.removeHandler(AgentIpcChannels.SESSIONS_DELETE)
    ipcMain.removeHandler(AgentIpcChannels.SESSIONS_PIN)
    ipcMain.removeHandler(AgentIpcChannels.SESSIONS_LIST_PINNED)
  }
}
