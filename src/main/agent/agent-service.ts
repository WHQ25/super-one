import { randomUUID } from 'crypto'
import { execFile, execFileSync } from 'child_process'
import { statSync } from 'fs'
import log from '../logger'
import { resolve, join, basename, dirname, sep } from 'path'
import { ipcMain, type BrowserWindow } from 'electron'
import { readProjectAdditionalDirs, writeProjectAdditionalDirs } from './project-additional-dirs'
import { WarmupManager } from './warmup-manager'
import { fetchModels } from './claude-models'
import { resolveSdkClaudeBinary } from './claude-binary'
import { AgentIpcChannels, type AgentEvent, type CodexCollaborationMode, type CodexPermissionPreset, type CodexReasoningEffort, type ModelOption, type PermissionMode, type QuestionAnnotations, type RemoteCommand, type ResourceScope, type SandboxMode, type SendMessageRequest } from '../../shared/agent-types'
import type { RemoteControlService, RemoteResponder } from '../remote-control-service'
import { stripMessagesForRemote, stripEventForRemote } from '../remote-control-service'
import { trace } from './event-trace'
import { getRecentFolders, addRecentFolder } from '../recent-folders'
import { readdir, mkdir } from 'fs/promises'
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { getDb, getCachedResources, getActiveProviderRaw } from '../database'
import { buildRemoteActiveProvider } from '../../shared/provider-utils'
import { sanitizeGitRef } from '../path-security'
import { searchFiles, searchMentions, EXCLUDED_DIRS, type AgentEntry } from './fuzzy-file-search'
import { clearAllGates } from '../generative-ui/widget-gate'
import { clearAllPendingCalls as clearAllPendingMiniAppCalls } from '../mcp/superone-mcp-server'

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
import { listSessionsForFolder, createSession, createAutomationSession, renameSession as dbRenameSession, saveSessionState, loadSessionState, loadSessionMessagesPaginated, sessionBelongsToProject, deleteSession as dbDeleteSession, deleteSessionsOlderThan as dbDeleteSessionsOlderThan, pinSession as dbPinSession, hideSession as dbHideSession, listPinnedSessions } from '../db-sessions'
import { loadSessionMessages } from '../session-history'
import { listMcpConfigs, saveMcpConfig, deleteMcpConfig, toggleMcpConfig } from '../mcp-config-service'
import { checkMcpServers } from '../mcp-probe-service'
import { authorizeHttpMcpServer } from '../mcp-oauth'
import { listSkills, readSkillContent, readSkillFile, installSkill, deleteSkill, listCodexSkills, readCodexSkillContent, readCodexSkillFile, deleteCodexSkill } from '../skills-service'
import { readAppSettings } from '../app-settings-service'
import { listCodexMcpConfigs } from '../codex-config-service'
import { discoverAllAgents, discoverProjectCommands, readAgentFile } from './discover-resources'
import { listPlugins, readPluginContent, readPluginFile, deletePlugin, listMarketplacePlugins, installPlugin, updatePlugin, updateMarketplace } from '../plugins-service'
import { backupMcpServers, listLibrary, deleteLibraryEntry } from '../mcp-library-service'
import { getAllProviders, createProvider, updateProvider, deleteProvider, activateProvider, deactivateAllProviders } from '../database'
import type { CreateProviderRequest, UpdateProviderRequest } from '../../shared/agent-types'

export class AgentService {
  private mainWindow: BrowserWindow | null = null
  private sessionManager: import('../session/session-manager').SessionManagerImpl | null = null
  private eventSubscribers: Array<(event: AgentEvent) => void> = []
  private codexListModels?: (projectPath: string) => Promise<ModelOption[]>
  private codexGetAuthStatus?: (projectPath: string) => unknown
  private remoteControlService?: RemoteControlService
  private remoteSession: { projectPath: string; sessionId: string } | null = null
  private remoteOwnedSids = new Set<string>()
  private warmupManager = new WarmupManager()

  setCodexListModels(fn: (projectPath: string) => Promise<ModelOption[]>): void {
    this.codexListModels = fn
  }

  setCodexGetAuthStatus(fn: (projectPath: string) => unknown): void {
    this.codexGetAuthStatus = fn
  }

  setRemoteControlService(svc: RemoteControlService): void {
    this.remoteControlService = svc
  }

  private broadcastEventToRenderer(event: AgentEvent): void {
    trace('remote.debug', 'broadcastEventToRenderer', { type: event.type, projectPath: event.projectPath, sessionId: event.sessionId, messageId: 'messageId' in event ? event.messageId : undefined })
    if (event.type === 'permission_request') {
      const alive = !!this.mainWindow && !this.mainWindow.isDestroyed()
      log.info('[broadcast] permission_request requestId=%s toolName=%s sessionId=%s projectPath=%s windowAlive=%s',
        event.request.requestId, event.request.toolName, event.sessionId ?? '(none)', event.projectPath ?? '(none)', alive)
    }
    this.mainWindow && !this.mainWindow.isDestroyed() && this.mainWindow.webContents.send(AgentIpcChannels.EVENT, event)
  }

  private isRemoteLockedSession(projectPath: string): boolean {
    const activeSession = this.sessionManager?.getActiveSession(projectPath)
    const sub = this.remoteControlService?.getSubscribedSession()
    if (sub?.projectPath === projectPath && activeSession?.id === sub.sessionId) return true
    if (this.remoteSession?.projectPath === projectPath && activeSession?.id === this.remoteSession.sessionId) return true
    return false
  }

  private resolveRemoteProjectPath(commandPath: string | undefined, sessionId: string): string | null {
    if (commandPath) return commandPath
    const sub = this.remoteControlService?.getSubscribedSession()
    if (sub && sub.sessionId === sessionId) return sub.projectPath
    return null
  }

  private canAccessSession(projectPath: string, sessionId: string): boolean {
    const session = this.sessionManager?.getSession(sessionId)
    if (session && session.projectPath === projectPath) return true
    return sessionBelongsToProject(projectPath, sessionId)
  }

  private buildSessionAccessError(projectPath: string, sessionId: string): string {
    return `Session ${sessionId} does not belong to project ${projectPath}`
  }

  addEventSubscriber(cb: (event: AgentEvent) => void): () => void {
    this.eventSubscribers.push(cb)
    return () => {
      this.eventSubscribers = this.eventSubscribers.filter((s) => s !== cb)
    }
  }

  async runAutomationSession(projectPath: string, options: {
    content: string
    model?: string
    effort?: string
    permissionMode?: string
    automationId?: string
    automationName?: string
  }): Promise<{ sessionId: string }> {
    const mgr = this.requireSessionManager()
    const sessionId = randomUUID()
    if (options.automationId) {
      createAutomationSession(
        projectPath,
        sessionId,
        `[Auto] ${options.automationName ?? 'Automation'}`,
        options.automationId,
        'claude',
      )
    }
    const session = mgr.createSession({
      projectPath,
      providerId: 'claude-base',
      id: sessionId,
      model: options.model,
      effort: options.effort as SendMessageRequest['effort'] | undefined,
      permissionMode: options.permissionMode as PermissionMode | undefined,
    })
    await session.send({
      content: options.content,
      model: options.model,
      effort: options.effort as SendMessageRequest['effort'] | undefined,
      clientMessageId: `auto_${Date.now()}`,
    })
    return { sessionId }
  }

  async runCodexAutomationSession(projectPath: string, options: {
    content: string
    model?: string
    reasoningEffort?: string
    permissionPreset?: string
    automationId?: string
    automationName?: string
  }): Promise<{ sessionId: string }> {
    const sessionId = `codex-auto-${Date.now()}`
    const userMessageId = `user_${Date.now()}`
    const assistantMessageId = `auto-${Date.now()}`

    if (options.automationId) {
      try {
        createAutomationSession(projectPath, sessionId, `[Auto] ${options.automationName ?? 'Automation'}`, options.automationId, 'codex')
      } catch { /* ignore */ }
    }

    const mgr = this.requireSessionManager()
    const session = mgr.createSession({
      projectPath,
      providerId: 'codex-base',
      id: sessionId,
    })

    await session.send({
      content: options.content,
      clientMessageId: userMessageId,
      assistantMessageId,
      model: options.model,
      effort: options.reasoningEffort as SendMessageRequest['effort'] | undefined,
      codex: {
        permissionPreset: options.permissionPreset as CodexPermissionPreset | undefined,
        reasoningEffort: options.reasoningEffort as CodexReasoningEffort | undefined,
      },
    })

    return { sessionId }
  }

  notifyEventSubscribers(event: AgentEvent): void {
    this.eventSubscribers.forEach((cb) => cb(event))
  }

  private broadcastProviderChanged(harnessId: 'claude' | 'codex'): void {
    const provider = buildRemoteActiveProvider(getActiveProviderRaw(harnessId), harnessId)
    const event: AgentEvent = { type: 'provider_changed', harnessId, provider }
    this.notifyEventSubscribers(event)
    this.broadcastEventToRenderer(event)
  }

  private async runCodexRemoteTurn(projectPath: string, sessionId: string, command: { content: string; model?: string; effort?: string; permissionPreset?: string; collaborationMode?: string; threadId?: string; images?: SendMessageRequest['images']; gitBranch?: string | null; worktreeBranch?: string | null }, isNewSession?: boolean): Promise<void> {
    const userMessageId = `user_${Date.now()}`
    const assistantMessageId = `remote-${Date.now()}`
    this.remoteSession = { projectPath, sessionId }
    this.remoteOwnedSids.add(sessionId)
    this.remoteControlService?.setRemoteSessionFilter(projectPath, sessionId)
    if (isNewSession) {
      this.remoteControlService?.broadcastAgentEvent({
        type: 'session_init', projectPath, sessionId,
        session: { sessionId, permissionMode: command.permissionPreset ?? 'default' },
      } as AgentEvent)
    }
    this.broadcastEventToRenderer({ type: 'remote_session_start', remoteProjectPath: projectPath, remoteSessionId: sessionId })
    try {
      const mgr = this.requireSessionManager()
      let session = mgr.getSession(sessionId)
      if (!session) {
        try { session = mgr.resumeSession(sessionId) } catch {
          session = mgr.createSession({
            projectPath,
            providerId: 'codex-base',
            id: sessionId,
          })
        }
      }
      if (session.snapshot.harnessId !== 'codex') {
        throw new Error(`Session ${sessionId} has harness=${session.snapshot.harnessId}, expected codex`)
      }
      await session.send({
        content: command.content,
        clientMessageId: userMessageId,
        assistantMessageId,
        images: command.images,
        model: command.model,
        effort: command.effort as SendMessageRequest['effort'] | undefined,
        codex: {
          permissionPreset: command.permissionPreset as CodexPermissionPreset | undefined,
          collaborationMode: command.collaborationMode as CodexCollaborationMode | undefined,
          threadId: command.threadId,
          reasoningEffort: command.effort as CodexReasoningEffort | undefined,
        },
      }, { providerOrigin: 'remote' })
    } finally {
      this.remoteControlService?.clearRemoteSessionFilter()
      if (this.remoteSession?.projectPath === projectPath && this.remoteSession.sessionId === sessionId) {
        this.remoteOwnedSids.delete(sessionId)
        this.remoteSession = null
      }
      this.broadcastEventToRenderer({ type: 'remote_session_end', remoteProjectPath: projectPath, remoteSessionId: sessionId })
    }
  }

  async handleRemoteCommand(command: RemoteCommand, respond?: RemoteResponder): Promise<void> {
    trace('remote.cmd', command.type, command)
    switch (command.type) {
      case 'send_message': {
        const projectPath = command.projectPath
        if (!projectPath) break

        if (command.provider === 'codex') {
          const sessionId = command.sessionId ?? `codex-remote-${Date.now()}`
          await this.runCodexRemoteTurn(projectPath, sessionId, command, !command.sessionId)
          break
        }

        const mgr = this.requireSessionManager()
        const targetSid = command.sessionId
        let session: import('../session/types').Session
        let sid: string

        if (targetSid) {
          if (!this.canAccessSession(projectPath, targetSid)) {
            log.warn('[AgentService] %s', this.buildSessionAccessError(projectPath, targetSid))
            break
          }
          const saved = loadSessionState(targetSid)
          if (saved?.provider === 'codex') {
            await this.runCodexRemoteTurn(projectPath, targetSid, command)
            break
          }
          const existing = mgr.getSession(targetSid)
          if (existing) {
            session = existing
          } else {
            try { session = mgr.resumeSession(targetSid) } catch {
              log.warn('[AgentService] remote send_message: session %s not found', targetSid)
              break
            }
          }
          sid = targetSid
        } else {
          let cwd = projectPath
          if (command.worktreeBranch) {
            const repoRoot = resolve(projectPath, await this.gitRun(projectPath, ['rev-parse', '--git-common-dir']))
            const mainDir = repoRoot.endsWith(`${sep}.git`) ? dirname(repoRoot) : repoRoot
            const repoName = basename(mainDir)
            const safeRef = sanitizeGitRef(command.worktreeBranch)
            const commitHash = (await this.gitRun(projectPath, ['rev-parse', safeRef])).trim()
            const shortHash = commitHash.slice(0, 7)
            const wtDir = join(homedir(), '.worktrees', repoName)
            const wtPath = join(wtDir, shortHash)
            if (!existsSync(wtPath)) {
              if (!existsSync(wtDir)) mkdirSync(wtDir, { recursive: true })
              await this.gitRun(projectPath, ['worktree', 'add', '--detach', wtPath, safeRef])
            }
            if (command.worktreeCarryLocalChanges) {
              const stashSha = (await this.gitRun(projectPath, ['stash', 'create'])).trim() || undefined
              if (stashSha) await this.gitRun(wtPath, ['stash', 'apply', stashSha])
            }
            cwd = wtPath
          } else if (command.gitBranch) {
            try {
              const currentBranch = (await this.gitRun(projectPath, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
              if (currentBranch !== command.gitBranch) {
                await this.gitRun(projectPath, ['checkout', sanitizeGitRef(command.gitBranch)])
              }
            } catch { /* branch may already be correct */ }
          }

          sid = randomUUID()
          session = mgr.createSession({
            projectPath,
            cwd,
            providerId: 'claude-base',
            id: sid,
            permissionMode: command.permissionMode as PermissionMode | undefined,
            effort: command.effort as SendMessageRequest['effort'] | undefined,
          })
        }

        this.remoteSession = { projectPath, sessionId: sid }
        this.remoteOwnedSids.add(sid)
        this.remoteControlService?.setRemoteSessionFilter(projectPath, sid)
        this.broadcastEventToRenderer({ type: 'remote_session_start', remoteProjectPath: projectPath, remoteSessionId: sid })

        trace('remote.debug', 'send_message:dispatch', { sid, targetSid, projectPath })
        await session.send({
          content: command.content,
          model: command.model,
          effort: command.effort as SendMessageRequest['effort'] | undefined,
          images: command.images,
          priority: command.priority,
          clientMessageId: command.clientMessageId,
        })
        break
      }
      case 'dequeue_message': {
        if (!command.projectPath) break
        const session = this.findSessionBySid(command.projectPath, command.sessionId)
        session?.dequeueMessage(command.clientMessageId)
        break
      }
      case 'interrupt': {
        const projectPath = command.projectPath
        if (!projectPath) break
        if (!this.canAccessSession(projectPath, command.sessionId)) {
          log.warn('[AgentService] %s', this.buildSessionAccessError(projectPath, command.sessionId))
          break
        }
        const agent = this.findSessionBySid(projectPath, command.sessionId)
        if (agent) { clearAllGates(); clearAllPendingMiniAppCalls(); await agent.interrupt() }
        break
      }
      case 'respond_permission': {
        const projectPath = this.resolveRemoteProjectPath(command.projectPath, command.sessionId)
        if (!projectPath) {
          log.warn('[AgentService] respond_permission: missing projectPath and no subscribed session for sid=%s requestId=%s', command.sessionId, command.requestId)
          break
        }
        if (!this.canAccessSession(projectPath, command.sessionId)) {
          log.warn('[AgentService] %s', this.buildSessionAccessError(projectPath, command.sessionId))
          break
        }
        const agent = this.findSessionBySid(projectPath, command.sessionId)
        if (agent) {
          const handled = agent.respondToPermission(command.requestId, command.decision, undefined, command.reason, command.selectedSuggestions)
          if (handled) {
            this.broadcastEventToRenderer({ type: 'interaction_resolved', interactionType: 'permission', requestId: command.requestId, projectPath, sessionId: command.sessionId })
          } else {
            log.warn('[AgentService] respond_permission: request %s not found for session %s', command.requestId, command.sessionId)
          }
        } else {
          log.warn('[AgentService] respond_permission: no agent for session %s', command.sessionId)
        }
        break
      }
      case 'answer_question': {
        const projectPath = this.resolveRemoteProjectPath(command.projectPath, command.sessionId)
        if (!projectPath) {
          log.warn('[AgentService] answer_question: missing projectPath and no subscribed session for sid=%s requestId=%s', command.sessionId, command.requestId)
          break
        }
        if (!this.canAccessSession(projectPath, command.sessionId)) {
          log.warn('[AgentService] %s', this.buildSessionAccessError(projectPath, command.sessionId))
          break
        }
        const agent = this.findSessionBySid(projectPath, command.sessionId)
        if (agent) {
          agent.respondToQuestion(command.requestId, command.answers, command.annotations)
          this.broadcastEventToRenderer({ type: 'interaction_resolved', interactionType: 'question', requestId: command.requestId, projectPath, sessionId: command.sessionId })
        } else {
          log.warn('[AgentService] answer_question: no agent for session %s', command.sessionId)
        }
        break
      }
      case 'dismiss_question': {
        const projectPath = this.resolveRemoteProjectPath(command.projectPath, command.sessionId)
        if (!projectPath) {
          log.warn('[AgentService] dismiss_question: missing projectPath and no subscribed session for sid=%s requestId=%s', command.sessionId, command.requestId)
          break
        }
        if (!this.canAccessSession(projectPath, command.sessionId)) {
          log.warn('[AgentService] %s', this.buildSessionAccessError(projectPath, command.sessionId))
          break
        }
        const agent = this.findSessionBySid(projectPath, command.sessionId)
        if (agent) {
          agent.dismissQuestion(command.requestId)
          this.broadcastEventToRenderer({ type: 'interaction_resolved', interactionType: 'question', requestId: command.requestId, projectPath, sessionId: command.sessionId })
        } else {
          log.warn('[AgentService] dismiss_question: no agent for session %s', command.sessionId)
        }
        break
      }
      case 'respond_plan_approval': {
        const projectPath = this.resolveRemoteProjectPath(command.projectPath, command.sessionId)
        if (!projectPath) {
          log.warn('[AgentService] respond_plan_approval: missing projectPath and no subscribed session for sid=%s requestId=%s', command.sessionId, command.requestId)
          break
        }
        if (!this.canAccessSession(projectPath, command.sessionId)) {
          log.warn('[AgentService] %s', this.buildSessionAccessError(projectPath, command.sessionId))
          break
        }
        const agent = this.findSessionBySid(projectPath, command.sessionId)
        if (agent) {
          agent.respondToPlanApproval(command.requestId, command.approved, command.feedback)
          this.broadcastEventToRenderer({ type: 'interaction_resolved', interactionType: 'plan_approval', requestId: command.requestId, projectPath, sessionId: command.sessionId })
        } else {
          log.warn('[AgentService] respond_plan_approval: no agent for session %s', command.sessionId)
        }
        break
      }
      case 'codex_plan_approval': {
        if (!command.sessionId) break
        const session = this.sessionManager?.getSession(command.sessionId)
        if (session && session.snapshot.harnessId === 'codex') {
          await session.dispatchBackendCommand({
            kind: 'codex.plan_approval',
            messageId: command.messageId,
            status: command.status,
            ...(command.feedback ? { feedback: command.feedback } : {}),
          })
        }
        break
      }
      case 'set_permission_mode': {
        const projectPath = command.projectPath
        if (!projectPath) break
        if (!this.canAccessSession(projectPath, command.sessionId)) {
          log.warn('[AgentService] %s', this.buildSessionAccessError(projectPath, command.sessionId))
          break
        }
        const agent = this.findSessionBySid(projectPath, command.sessionId)
        if (agent) {
          await agent.setPermissionMode(command.mode as PermissionMode)
        } else {
          log.warn('[AgentService] set_permission_mode: no agent for session %s', command.sessionId)
        }
        break
      }
      case 'subscribe_session': {
        if (!this.canAccessSession(command.projectPath, command.sessionId)) {
          log.warn('[AgentService] %s', this.buildSessionAccessError(command.projectPath, command.sessionId))
          break
        }
        this.remoteControlService?.subscribeSession(command.projectPath, command.sessionId, (e) => this.broadcastEventToRenderer(e))
        break
      }
      case 'unsubscribe_session': {
        this.remoteControlService?.unsubscribeSession((e) => this.broadcastEventToRenderer(e))
        break
      }
      case 'load_session_messages': {
        if (!this.canAccessSession(command.projectPath, command.sessionId)) {
          await respond?.(command.requestId, { error: this.buildSessionAccessError(command.projectPath, command.sessionId) })
          break
        }
        try {
          const result = loadSessionMessagesPaginated(command.sessionId, command.limit ?? 10, command.cursor)
          const stripped = stripMessagesForRemote(result.messages, command.projectPath)
          const sessionProvider = loadSessionState(command.sessionId)?.provider ?? 'claude'
          trace('remote.cmd', 'load_session_messages_result', { projectPath: command.projectPath, sessionId: command.sessionId, messageCount: stripped.length, hasMore: result.hasMore, cursor: result.cursor, provider: sessionProvider })
          await respond?.(command.requestId, { messages: stripped, hasMore: result.hasMore, cursor: result.cursor, provider: sessionProvider })
        } catch (err) {
          trace('remote.cmd', 'load_session_messages_error', { projectPath: command.projectPath, sessionId: command.sessionId, error: (err as Error).message })
          await respond?.(command.requestId, { error: (err as Error).message })
        }
        break
      }
      case 'list_directory': {
        try {
          const entries = await readdir(command.path, { withFileTypes: true })
          const items = entries
            .filter((e) => command.showHidden || !e.name.startsWith('.'))
            .map((e) => ({ name: e.name, isDirectory: e.isDirectory() }))
            .sort((a, b) => (a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : a.isDirectory ? -1 : 1))
          await respond?.(command.requestId, { items })
        } catch (err) {
          await respond?.(command.requestId, { error: (err as Error).message })
        }
        break
      }
      case 'search_mentions': {
        try {
          const cwd = this.sessionManager?.getActiveSession(command.projectPath)?.cwd ?? command.projectPath
          const agents = discoverAllAgents(command.projectPath).map((a) => ({ name: a.name, model: a.model ?? '' }))
          const items = searchMentions([cwd], command.query, agents, 20)
          await respond?.(command.requestId, { items })
        } catch (err) {
          await respond?.(command.requestId, { error: (err as Error).message })
        }
        break
      }
      case 'get_session_state': {
        if (!this.canAccessSession(command.projectPath, command.sessionId)) {
          await respond?.(command.requestId, { error: this.buildSessionAccessError(command.projectPath, command.sessionId) })
          break
        }
        try {
          const session = this.findSessionBySid(command.projectPath, command.sessionId)
          const inProgressMessages = session
            ? stripMessagesForRemote(
                session.snapshot.messages.filter((m) => m.status === 'streaming'),
                command.projectPath,
              )
            : []
          const pendingInteractions = session
            ? session.getPendingInteractions().map((e) => stripEventForRemote(e, command.projectPath))
            : []
          const status = session?.isStreaming() ? 'streaming' : 'idle'
          const permissionMode = session?.getCurrentPermissionMode()
          trace('remote.cmd', 'get_session_state', {
            projectPath: command.projectPath,
            sessionId: command.sessionId,
            inProgressCount: inProgressMessages.length,
            pendingCount: pendingInteractions.length,
            status,
          })
          await respond?.(command.requestId, {
            inProgressMessages,
            pendingInteractions,
            status,
            permissionMode,
          })
        } catch (err) {
          await respond?.(command.requestId, { error: (err as Error).message })
        }
        break
      }
      case 'create_directory': {
        try {
          if (command.name.includes('..') || command.name.includes('/') || command.name.includes('\\')) {
            throw new Error('Invalid directory name')
          }
          await mkdir(join(command.path, command.name))
          await respond?.(command.requestId, { success: true })
        } catch (err) {
          await respond?.(command.requestId, { error: (err as Error).message })
        }
        break
      }
      case 'add_project': {
        try {
          addRecentFolder(command.path)
          await this.openFolder(command.path)
          await respond?.(command.requestId, { success: true })
        } catch (err) {
          await respond?.(command.requestId, { error: (err as Error).message })
        }
        break
      }
      case 'list_projects': {
        const folders = getRecentFolders()
        await respond?.(command.requestId, {
          projects: folders.map((f) => ({ path: f.path, name: basename(f.path) })),
        })
        break
      }
      case 'list_sessions': {
        try {
          const db = getDb()
          const limit = command.limit ?? 10
          const offset = command.offset ?? 0
          const allSessions = listSessionsForFolder(command.projectPath)
          const visibleSessions = allSessions.filter((s) => !s.isHidden)
          const visible = visibleSessions.slice(offset, offset + limit)
          const totalCount = visibleSessions.length
          const countStmt = db.prepare('SELECT COUNT(*) as cnt FROM chat_messages WHERE session_id = ?')
          await respond?.(command.requestId, {
            totalCount,
            sessions: visible.map((s) => {
              const row = countStmt.get(s.sessionId) as { cnt: number } | undefined
              return {
                sessionId: s.sessionId,
                title: s.title,
                lastActiveAt: s.lastActiveAt,
                messageCount: row?.cnt ?? 0,
                provider: s.provider ?? 'claude',
                gitBranch: s.gitBranch ?? null,
                isWorktree: s.isWorktree ?? false,
                worktreePath: s.worktreePath ?? null,
              }
            }),
          })
        } catch (err) {
          await respond?.(command.requestId, { error: (err as Error).message })
        }
        break
      }
      case 'list_models': {
        try {
          const cached = getCachedResources()
          const cachedModels = cached?.models as ModelOption[] | undefined
          const models = cachedModels?.length ? cachedModels : await fetchModels(command.projectPath)
          await respond?.(command.requestId, { models })
        } catch (err) {
          await respond?.(command.requestId, { error: (err as Error).message })
        }
        break
      }
      case 'get_system_info': {
        try {
          const isClaude = command.provider !== 'codex'
          const cached = getCachedResources()
          const { agentPreference } = readAppSettings()
          log.info('[get_system_info] provider=%s hasCached=%s cachedModels=%d projectPath=%s', command.provider, !!cached, cached?.models?.length ?? 0, command.projectPath)
          if (isClaude) {
            const cachedModels = cached?.models as ModelOption[] | undefined
            const models = cachedModels?.length ? cachedModels : await fetchModels(command.projectPath)
            log.info('[get_system_info] resolvedModels=%d source=%s', models.length, cachedModels?.length ? 'cache' : 'fetch')
            const skills = listSkills(command.projectPath)
            const agents = discoverAllAgents(command.projectPath)
            const projectSlashCommands = discoverProjectCommands(command.projectPath)
            const activeProvider = buildRemoteActiveProvider(getActiveProviderRaw('claude'), 'claude')
            await respond?.(command.requestId, {
              models,
              skills: skills.map((s) => ({ name: s.name, description: s.description ?? '' })),
              agents: agents.map((a) => ({ name: a.name, description: a.description ?? '', model: a.model })),
              userSlashCommands: cached?.slashCommands ?? [],
              projectSlashCommands: projectSlashCommands.map((c) => ({ name: c.name, description: c.description ?? '', argumentHint: c.argumentHint ?? '' })),
              account: cached?.account ?? null,
              permissionModes: ['default', 'acceptEdits', 'auto', 'plan', 'bypassPermissions', 'dontAsk'],
              sandboxModes: ['off', 'on', 'auto'],
              activeProvider,
              defaults: {
                model: agentPreference.claude.defaultModel || null,
                effort: agentPreference.claude.defaultEffort || null,
                permissionMode: agentPreference.claude.defaultPermissionMode || null,
              },
            })
          } else {
            const models = this.codexListModels ? await this.codexListModels(command.projectPath) : []
            const skills = listCodexSkills(command.projectPath)
            const activeProvider = buildRemoteActiveProvider(getActiveProviderRaw('codex'), 'codex')
            await respond?.(command.requestId, {
              models,
              skills: skills.map((s) => ({ name: s.name, description: s.description ?? '' })),
              slashCommands: [
                { name: 'help', description: 'Show available commands' },
                { name: 'reset', description: 'Reset Codex thread' },
                { name: 'auth', description: 'Show auth status' },
                { name: 'review', description: 'Review code changes' },
                { name: 'compact', description: 'Compact thread context' },
              ],
              account: this.codexGetAuthStatus?.(command.projectPath) ?? null,
              permissionPresets: ['default', 'full-access'],
              activeProvider,
              defaults: {
                model: agentPreference.codex.defaultModel || null,
                reasoningEffort: agentPreference.codex.defaultReasoningEffort || null,
              },
            })
          }
        } catch (err) {
          log.error('[get_system_info] error: %s', err instanceof Error ? err.message : String(err))
          await respond?.(command.requestId, { error: (err as Error).message })
        }
        break
      }
      case 'get_project_resources': {
        try {
          const isClaude = command.provider !== 'codex'
          if (isClaude) {
            const skills = listSkills(command.projectPath)
            const agents = discoverAllAgents(command.projectPath)
            const projectSlashCommands = discoverProjectCommands(command.projectPath)
            await respond?.(command.requestId, {
              skills: skills.map((s) => ({ name: s.name, description: s.description ?? '' })),
              agents: agents.map((a) => ({ name: a.name, description: a.description ?? '', model: a.model })),
              projectSlashCommands: projectSlashCommands.map((c) => ({ name: c.name, description: c.description ?? '', argumentHint: c.argumentHint ?? '' })),
            })
          } else {
            const skills = listCodexSkills(command.projectPath)
            await respond?.(command.requestId, {
              skills: skills.map((s) => ({ name: s.name, description: s.description ?? '' })),
            })
          }
        } catch (err) {
          await respond?.(command.requestId, { error: (err as Error).message })
        }
        break
      }
      case 'get_git_info': {
        try {
          const branch = await this.gitRun(command.projectPath, ['rev-parse', '--abbrev-ref', 'HEAD'])
            .catch(() => this.gitRun(command.projectPath, ['symbolic-ref', 'HEAD']).then((r) => r.replace('refs/heads/', '')))
          const status = await this.gitRun(command.projectPath, ['status', '--porcelain'])
          const files = status ? status.split('\n').filter(Boolean).length : 0
          let insertions = 0
          let deletions = 0
          if (files > 0) {
            try {
              const shortstat = await this.gitRun(command.projectPath, ['diff', 'HEAD', '--shortstat'])
              const insMatch = shortstat.match(/(\d+) insertion/)
              const delMatch = shortstat.match(/(\d+) deletion/)
              if (insMatch) insertions = parseInt(insMatch[1])
              if (delMatch) deletions = parseInt(delMatch[1])
            } catch { /* no HEAD yet */ }
          }
          await respond?.(command.requestId, {
            branch,
            ...(files > 0 ? { dirty: { files, insertions, deletions } } : {}),
          })
        } catch {
          await respond?.(command.requestId, { branch: null })
        }
        break
      }
      case 'get_git_branches': {
        try {
          const raw = await this.gitRun(command.projectPath, ['branch', '--format=%(refname:short)'])
          await respond?.(command.requestId, { branches: raw.split('\n').filter(Boolean) })
        } catch {
          await respond?.(command.requestId, { branches: [] })
        }
        break
      }
      case 'switch_git_branch': {
        try {
          await this.gitRun(command.projectPath, ['checkout', sanitizeGitRef(command.branch)])
          await respond?.(command.requestId, { ok: true })
        } catch (err) {
          const stderr = (err as { stderr?: string })?.stderr?.trim()
          await respond?.(command.requestId, { ok: false, error: stderr || (err as Error)?.message || 'Unknown git error' })
        }
        break
      }
      case 'create_git_branch': {
        try {
          await this.gitRun(command.projectPath, ['rev-parse', '--verify', 'HEAD'])
        } catch {
          await respond?.(command.requestId, { ok: false, error: 'Cannot create branch before the first commit.' })
          break
        }
        try {
          await this.gitRun(command.projectPath, ['checkout', '-b', sanitizeGitRef(command.branch)])
          await respond?.(command.requestId, { ok: true })
        } catch (err) {
          const stderr = (err as { stderr?: string })?.stderr?.trim()
          await respond?.(command.requestId, { ok: false, error: stderr || (err as Error)?.message || 'Unknown git error' })
        }
        break
      }
      case 'get_worktree_info': {
        try {
          const raw = await this.gitRun(command.projectPath, ['worktree', 'list', '--porcelain'])
          const entries: { path: string; branch: string; head: string; isMain: boolean; isCurrent: boolean }[] = []
          let first = true
          for (const block of raw.split('\n\n').filter(Boolean)) {
            const lines = block.split('\n')
            const pathLine = lines.find((l) => l.startsWith('worktree '))
            const branchLine = lines.find((l) => l.startsWith('branch '))
            const headLine = lines.find((l) => l.startsWith('HEAD '))
            if (!pathLine) continue
            const wtPath = pathLine.slice('worktree '.length)
            const head = headLine ? headLine.slice('HEAD '.length) : ''
            const branch = branchLine ? branchLine.slice('branch refs/heads/'.length) : ''
            entries.push({ path: wtPath, branch, head, isMain: first, isCurrent: wtPath === command.projectPath })
            first = false
          }
          const mainEntry = entries.find((e) => e.isMain)
          const isWorktree = mainEntry ? mainEntry.path !== command.projectPath : false
          const current = entries.find((e) => e.isCurrent)
          const currentBranch = current?.branch || (current?.head ? current.head.slice(0, 7) : '')
          await respond?.(command.requestId, { isWorktree, currentBranch, entries })
        } catch {
          await respond?.(command.requestId, { isWorktree: false, currentBranch: '', entries: [] })
        }
        break
      }
      case 'activate_worktree': {
        try {
          if (command.baseBranch === null) {
            await this.switchCwd(command.projectPath, command.projectPath, null)
            await respond?.(command.requestId, { ok: true, path: command.projectPath })
            break
          }
          const repoRoot = resolve(command.projectPath, await this.gitRun(command.projectPath, ['rev-parse', '--git-common-dir']))
          const mainDir = repoRoot.endsWith(`${sep}.git`) ? dirname(repoRoot) : repoRoot
          const repoName = basename(mainDir)
          const safeRef = sanitizeGitRef(command.baseBranch)
          const commitHash = (await this.gitRun(command.projectPath, ['rev-parse', safeRef])).trim()
          const shortHash = commitHash.slice(0, 7)
          const wtDir = join(homedir(), '.worktrees', repoName)
          const wtPath = join(wtDir, shortHash)

          let stashSha: string | undefined
          if (command.carryLocalChanges) {
            stashSha = (await this.gitRun(command.projectPath, ['stash', 'create'])).trim() || undefined
          }

          if (!existsSync(wtPath)) {
            if (!existsSync(wtDir)) mkdirSync(wtDir, { recursive: true })
            await this.gitRun(command.projectPath, ['worktree', 'add', '--detach', wtPath, safeRef])
          }

          if (stashSha) {
            await this.gitRun(wtPath, ['stash', 'apply', stashSha])
          }

          await this.switchCwd(command.projectPath, wtPath, command.baseBranch)
          await respond?.(command.requestId, { ok: true, path: wtPath })
        } catch (err) {
          await respond?.(command.requestId, { ok: false, error: (err as Error).message })
        }
        break
      }
    }
  }

  private gitRun(cwd: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile('git', args, { cwd }, (err, stdout) => {
        if (err) reject(err)
        else resolve(stdout.trimEnd())
      })
    })
  }

  markAllNeedsRebuild(harnessId?: 'claude' | 'codex'): void {
    this.sessionManager?.markAllNeedsRebuild(harnessId)
  }


  private findSessionBySid(projectPath: string, sessionId: string): import('../session/types').Session | undefined {
    const session = this.sessionManager?.getSession(sessionId)
    if (!session) return undefined
    if (session.projectPath !== projectPath) return undefined
    return session
  }

  private resolveInteractionSession(projectPath: string, sessionId: string | undefined): import('../session/types').Session | null {
    if (sessionId) {
      const session = this.findSessionBySid(projectPath, sessionId)
      if (session) {
        trace('permission.flow', 'resolve_session', { match: 'by_sid', sid: session.id, projectPath })
        return session
      }
      log.warn('[AgentService] interaction target session not found: sid=%s projectPath=%s', sessionId, projectPath)
      trace('permission.flow', 'resolve_session', { match: 'sid_miss', wantSid: sessionId, projectPath })
      return null
    }
    const fallback = this.sessionManager?.getActiveSession(projectPath) ?? null
    trace('permission.flow', 'resolve_session', { match: fallback ? 'fallback_active' : 'none', sid: fallback?.id ?? null, projectPath })
    return fallback
  }

  setMainWindow(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow
  }

  setSessionManager(sessionManager: import('../session/session-manager').SessionManagerImpl): void {
    this.sessionManager = sessionManager
  }

  private requireSessionManager(): import('../session/session-manager').SessionManagerImpl {
    if (!this.sessionManager) throw new Error('SessionManager not injected into AgentService')
    return this.sessionManager
  }

  private getOrCreateActiveSession(
    projectPath: string,
    requestedSid?: string,
    hint?: { worktreePath?: string | null; gitBranch?: string | null },
  ): import('../session/types').Session {
    const mgr = this.requireSessionManager()
    const activeCwd = mgr.getActiveSession(projectPath)?.cwd
    const cwd = hint?.worktreePath ?? activeCwd
    const gitBranch = hint?.gitBranch ?? null
    if (requestedSid) {
      const existing = mgr.getSession(requestedSid)
      if (existing) {
        mgr.setActiveSession(projectPath, requestedSid)
        return existing
      }
      try {
        return mgr.resumeSession(requestedSid)
      } catch {
        const { permissionMode, sandboxMode } = this.readDefaultSessionPrefs()
        return mgr.createSession({ projectPath, cwd, providerId: 'claude-base', id: requestedSid, gitBranch, permissionMode, sandboxMode })
      }
    }
    const active = mgr.getActiveSession(projectPath)
    if (active) return active
    const { permissionMode, sandboxMode } = this.readDefaultSessionPrefs()
    return mgr.createSession({ projectPath, cwd, providerId: 'claude-base', gitBranch, permissionMode, sandboxMode })
  }

  private readDefaultSessionPrefs(): { permissionMode: PermissionMode; sandboxMode: SandboxMode | undefined } {
    const { agentPreference } = readAppSettings()
    return {
      permissionMode: agentPreference.claude.defaultPermissionMode || 'default',
      sandboxMode: agentPreference.claude.defaultSandboxMode || undefined,
    }
  }

  setup(): void {

    // --- Session-scoped handlers (projectPath as first arg) ---

    ipcMain.handle(AgentIpcChannels.SEND_MESSAGE, async (_event, projectPath: string, request: SendMessageRequest) => {
      if (this.isRemoteLockedSession(projectPath)) throw new Error('Session is controlled remotely')
      const session = this.getOrCreateActiveSession(projectPath, request.sessionId, {
        worktreePath: request.worktreePath,
        gitBranch: request.gitBranch,
      })
      trace('session.lifecycle', 'ipc_sendMessage', {
        projectPath,
        sessionId: session.snapshot.id,
        providerSessionId: session.snapshot.providerSessionId ?? '(none)',
        status: session.snapshot.status,
      })
      await session.send(request)
    })

    ipcMain.handle(AgentIpcChannels.DEQUEUE_MESSAGE, (_event, projectPath: string, clientMessageId: string) => {
      const session = this.sessionManager?.getActiveSession(projectPath)
      if (!session) return false
      return session.dequeueMessage(clientMessageId)
    })

    ipcMain.handle(AgentIpcChannels.PREWARM, (_event, projectPath: string, hint?: { effort?: SendMessageRequest['effort']; model?: string; additionalDirs?: string[]; sessionId?: string }) => {
      if (!this.sessionManager) return
      if (this.isRemoteLockedSession(projectPath)) return
      const session = this.getOrCreateActiveSession(projectPath, hint?.sessionId)
      if (session.snapshot.harnessId !== 'claude') return
      log.debug('[agent-service] prewarm sid=%s harness=%s', session.id, session.snapshot.harnessId)
      try { session.prewarm(hint) } catch (err) { log.debug('[agent-service] prewarm failed: %s', err instanceof Error ? err.message : String(err)) }
    })

    ipcMain.handle(AgentIpcChannels.INTERRUPT, async (_event, projectPath: string) => {
      const session = this.sessionManager?.getActiveSession(projectPath)
      if (!session) return false
      clearAllGates()
      clearAllPendingMiniAppCalls()
      await session.interrupt()
      if (this.isRemoteLockedSession(projectPath)) {
        this.remoteControlService?.unsubscribeSession((e) => this.broadcastEventToRenderer(e))
      }
      return true
    })

    ipcMain.handle(AgentIpcChannels.PERMISSION_RESPONSE, (_event, projectPath: string, requestId: string, allow: boolean, alwaysAllow?: boolean, reason?: string, selectedSuggestions?: number[], sessionId?: string) => {
      if (this.isRemoteLockedSession(projectPath)) throw new Error('Session is controlled remotely')
      trace('agent.emit', 'permission_responded', { requestId, allow, reason, sessionId })
      trace('permission.flow', 'ipc_response', { projectPath, sessionId: sessionId ?? null, allow, alwaysAllow, reason }, requestId)
      const session = this.resolveInteractionSession(projectPath, sessionId)
      if (!session) return false
      return session.respondToPermission(requestId, allow, alwaysAllow, reason, selectedSuggestions)
    })

    ipcMain.handle(AgentIpcChannels.SET_PERMISSION_MODE, async (_event, projectPath: string, mode: PermissionMode) => {
      if (this.isRemoteLockedSession(projectPath)) throw new Error('Session is controlled remotely')
      const session = this.getOrCreateActiveSession(projectPath)
      trace('permission.flow', 'ipc_setMode', { projectPath, mode, sid: session.id, status: session.snapshot.status })
      await session.setPermissionMode(mode)
    })

    ipcMain.handle(AgentIpcChannels.SET_SANDBOX_MODE, async (_event, projectPath: string, mode: SandboxMode) => {
      if (this.isRemoteLockedSession(projectPath)) throw new Error('Session is controlled remotely')
      return this.getOrCreateActiveSession(projectPath).setSandboxMode(mode)
    })

    ipcMain.handle(AgentIpcChannels.SET_SESSION_SETTINGS, (_event, projectPath: string, settings: { model?: string | null; effort?: SendMessageRequest['effort'] | null }) => {
      if (this.isRemoteLockedSession(projectPath)) return
      const session = this.sessionManager?.getActiveSession(projectPath)
      if (!session) return
      session.setSelectedSettings(settings)
    })

    ipcMain.handle(AgentIpcChannels.ANSWER_QUESTION, (_event, projectPath: string, requestId: string, answers: Record<string, string>, annotations?: QuestionAnnotations, sessionId?: string) => {
      if (this.isRemoteLockedSession(projectPath)) throw new Error('Session is controlled remotely')
      trace('agent.emit', 'question_answered', { requestId, answers, sessionId })
      this.resolveInteractionSession(projectPath, sessionId)?.respondToQuestion(requestId, answers, annotations)
    })

    ipcMain.handle(AgentIpcChannels.DISMISS_QUESTION, (_event, projectPath: string, requestId: string, sessionId?: string) => {
      if (this.isRemoteLockedSession(projectPath)) throw new Error('Session is controlled remotely')
      trace('agent.emit', 'question_dismissed', { requestId, sessionId })
      this.resolveInteractionSession(projectPath, sessionId)?.dismissQuestion(requestId)
    })

    ipcMain.handle(AgentIpcChannels.RESPOND_PLAN_APPROVAL, (_event, projectPath: string, requestId: string, approved: boolean, feedback?: string, sessionId?: string) => {
      if (this.isRemoteLockedSession(projectPath)) throw new Error('Session is controlled remotely')
      trace('agent.emit', 'plan_approval_responded', { requestId, approved, feedback, sessionId })
      this.resolveInteractionSession(projectPath, sessionId)?.respondToPlanApproval(requestId, approved, feedback)
    })

    ipcMain.handle(AgentIpcChannels.CREATE_SESSION, async (_event, projectPath: string) => {
      const mgr = this.requireSessionManager()
      const { permissionMode, sandboxMode } = this.readDefaultSessionPrefs()
      const session = mgr.createSession({ projectPath, providerId: 'claude-base', permissionMode, sandboxMode })
      return session.snapshot.id
    })

    ipcMain.handle(AgentIpcChannels.RESET_SESSION, async (_event, projectPath: string, newSessionId?: string) => {
      const mgr = this.requireSessionManager()
      const existing = mgr.getActiveSession(projectPath)
      trace('session.lifecycle', 'ipc_resetSession', {
        projectPath,
        oldSessionId: existing?.snapshot.id || '(none)',
        newSessionId: newSessionId ?? '(auto)',
      })
      if (existing) await mgr.disposeSession(existing.snapshot.id)
      const { permissionMode, sandboxMode } = this.readDefaultSessionPrefs()
      const fresh = mgr.createSession({ projectPath, providerId: 'claude-base', permissionMode, sandboxMode, id: newSessionId })
      return { permissionMode: fresh.getCurrentPermissionMode(), sandboxInfo: fresh.getCurrentSandboxInfo() }
    })

    ipcMain.handle(AgentIpcChannels.TRUNCATE_AT_CHECKPOINT, (_event, projectPath: string, checkpointId: string) => {
      const session = this.sessionManager?.getActiveSession(projectPath)
      if (!session) return false
      session.truncateMessagesAt(checkpointId)
      return true
    })

    ipcMain.handle(AgentIpcChannels.REWIND_FILES, async (_event, projectPath: string, userMessageId: string) => {
      const session = this.sessionManager?.getActiveSession(projectPath)
      if (!session) return { canRewind: false, error: 'No active session' }
      return session.rewindFiles(userMessageId)
    })

    ipcMain.handle(AgentIpcChannels.REWIND_FILES_PREVIEW, async (_event, projectPath: string, userMessageId: string) => {
      const session = this.sessionManager?.getActiveSession(projectPath)
      if (!session) return { canRewind: false, error: 'No active session' }
      return session.rewindFiles(userMessageId, { dryRun: true })
    })

    ipcMain.handle(AgentIpcChannels.REWIND_CODE_AND_CHAT, async (_event, projectPath: string, userMessageId: string) => {
      const session = this.sessionManager?.getActiveSession(projectPath)
      if (!session) return { canRewind: false, error: 'No active session' }
      return session.rewindFiles(userMessageId)
    })

    ipcMain.handle(AgentIpcChannels.REWIND_CONVERSATION, async (_event, _projectPath: string) => {
      return { canRewind: true }
    })

    ipcMain.handle(AgentIpcChannels.GET_SESSION_ID, (_event, projectPath: string) => {
      return this.sessionManager?.getActiveSession(projectPath)?.snapshot.providerSessionId ?? null
    })

    ipcMain.handle(AgentIpcChannels.MCP_SERVER_STATUS, async (_event, projectPath: string) => {
      const session = this.sessionManager?.getActiveSession(projectPath)
      if (!session) return []
      return session.getMcpServerStatus()
    })

    ipcMain.handle(AgentIpcChannels.GET_CONTEXT_USAGE, async (_event, projectPath: string, sessionId?: string) => {
      const session = sessionId
        ? this.sessionManager?.getSession(sessionId)
        : this.sessionManager?.getActiveSession(projectPath)
      if (!session) return null
      if (sessionId && session.snapshot.projectPath !== projectPath) return null
      return session.getContextUsage()
    })

    ipcMain.handle(AgentIpcChannels.PLUGINS_RELOAD, async (_event, projectPath: string) => {
      const session = this.sessionManager?.getActiveSession(projectPath)
      if (!session) return false
      return session.reloadPlugins()
    })

    ipcMain.handle(AgentIpcChannels.LIST_DIRECTORY, async (_event, projectPath: string, relativePath: string) => {
      const cwd = this.sessionManager?.getActiveSession(projectPath)?.snapshot.cwd ?? projectPath
      const target = resolve(cwd, relativePath)
      if (!target.startsWith(cwd)) return []
      if (!existsSync(target)) return []
      try {
        const entries = readdirSync(target, { withFileTypes: true })
        const result: Array<{ name: string; isDirectory: boolean }> = []
        for (const entry of entries) {
          if (EXCLUDED_DIRS.has(entry.name)) continue
          result.push({ name: entry.name, isDirectory: entry.isDirectory() })
        }
        result.sort((a, b) => (a.isDirectory !== b.isDirectory ? (a.isDirectory ? -1 : 1) : a.name.localeCompare(b.name)))
        return result
      } catch {
        return []
      }
    })

    ipcMain.handle(AgentIpcChannels.FIND_LINE_NUMBER, async (_event, _projectPath: string, filePath: string, text: string) => {
      try {
        const content = readFileSync(filePath, 'utf-8')
        const idx = content.indexOf(text)
        if (idx === -1) return null
        return content.substring(0, idx).split('\n').length
      } catch {
        return null
      }
    })

    ipcMain.handle(AgentIpcChannels.SEARCH_FILES, async (_event, projectPath: string, query: string, additionalDirs?: string[]) => {
      const cwd = this.sessionManager?.getActiveSession(projectPath)?.snapshot.cwd ?? projectPath
      const roots = [cwd, ...(additionalDirs || [])]
      return searchFiles(roots, query, 20)
    })

    ipcMain.handle(AgentIpcChannels.SEARCH_MENTIONS, async (_event, projectPath: string, query: string, agents: AgentEntry[], additionalDirs?: string[], scopeDir?: string) => {
      const cwd = this.sessionManager?.getActiveSession(projectPath)?.snapshot.cwd ?? projectPath
      const roots = [cwd, ...(additionalDirs || [])]
      return searchMentions(roots, query, agents, 20, scopeDir)
    })

    ipcMain.handle(AgentIpcChannels.DISCONNECT_REMOTE_SESSION, async () => {
      const sub = this.remoteControlService?.getSubscribedSession()
      if (sub) {
        await this.remoteControlService?.sendEventToMobile({ type: 'session_disconnected', sessionId: sub.sessionId })
      }
      this.remoteControlService?.unsubscribeSession((e) => this.broadcastEventToRenderer(e))
      if (this.remoteSession) {
        const sid = this.remoteSession.sessionId
        if (!sub || sub.sessionId !== sid) {
          await this.remoteControlService?.sendEventToMobile({ type: 'session_disconnected', sessionId: sid })
        }
        this.broadcastEventToRenderer({ type: 'remote_session_end', remoteProjectPath: this.remoteSession.projectPath, remoteSessionId: sid })
        this.remoteOwnedSids.delete(sid)
        this.remoteSession = null
      }
      this.remoteControlService?.clearRemoteSessionFilter()
    })

    // --- Additional directories ---

    ipcMain.handle(AgentIpcChannels.READ_PROJECT_ADDITIONAL_DIRS, (_event, projectPath: string) => {
      return readProjectAdditionalDirs(projectPath)
    })

    ipcMain.handle(AgentIpcChannels.WRITE_PROJECT_ADDITIONAL_DIRS, (_event, projectPath: string, dirs: string[]) => {
      writeProjectAdditionalDirs(projectPath, dirs)
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
      try { await this.sessionManager?.getActiveSession(projectPath)?.reloadPlugins() } catch (err) { log.debug('[agent] reloadPlugins skipped:', err) }
    })

    ipcMain.handle(AgentIpcChannels.PLUGINS_UPDATE, async (_event, projectPath: string, updates: Array<{ key: string; scope: ResourceScope }>) => {
      for (const { key, scope } of updates) {
        updatePlugin(key, scope, projectPath)
      }
      try { await this.sessionManager?.getActiveSession(projectPath)?.reloadPlugins() } catch (err) { log.debug('[agent] reloadPlugins skipped:', err) }
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

    ipcMain.handle(AgentIpcChannels.CODEX_SKILLS_DELETE, (_event, projectPath: string, name: string, scope: ResourceScope) => {
      deleteCodexSkill(name, scope, projectPath)
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
      try { await this.sessionManager?.getActiveSession(projectPath)?.reconnectMcp(name) } catch (err) { log.debug('[agent] MCP save reconnect skipped:', err) }
    })

    ipcMain.handle(AgentIpcChannels.MCP_DELETE_CONFIG, async (_event, projectPath: string, name: string, scope: ResourceScope) => {
      deleteMcpConfig(name, scope, projectPath)
      try { await this.sessionManager?.getActiveSession(projectPath)?.toggleMcpServer(name, false) } catch (err) { log.debug('[agent] MCP delete toggle skipped:', err) }
    })

    ipcMain.handle(AgentIpcChannels.MCP_TOGGLE_CONFIG, async (_event, projectPath: string, name: string, disabled: boolean, scope: ResourceScope) => {
      if (scope !== 'claudeai') toggleMcpConfig(name, disabled, scope, projectPath)
      try { await this.sessionManager?.getActiveSession(projectPath)?.toggleMcpServer(name, !disabled) } catch (err) { log.debug('[agent] MCP toggle skipped:', err) }
    })

    ipcMain.handle(AgentIpcChannels.MCP_CHECK_SERVERS, async (_event, projectPath: string) => {
      const configs = listMcpConfigs(projectPath)
      const result = await checkMcpServers(configs)
      try {
        const sdkStatus = await this.sessionManager?.getActiveSession(projectPath)?.getMcpServerStatus() ?? []
        const claudeaiServers = sdkStatus.filter((s) => s.scope === 'claudeai')
        if (claudeaiServers.length > 0) {
          result.status.push(...claudeaiServers)
        }
      } catch (err) { log.debug('[agent] claudeai MCP status fetch skipped:', err) }
      const connectedNames = new Set(result.status.filter((s) => s.status === 'connected').map((s) => s.name))
      const connectedMeta = Object.fromEntries(
        Object.entries(result.meta).filter(([name]) => connectedNames.has(name))
      )
      try { backupMcpServers(configs, connectedMeta) } catch (err) { log.warn('[agent] MCP backup failed:', err) }
      return result
    })

    ipcMain.handle(AgentIpcChannels.MCP_OAUTH_AUTHORIZE, async (_event, serverUrl: string, headers?: Record<string, string>, transport?: 'http' | 'sse') => {
      return authorizeHttpMcpServer(serverUrl, headers, transport)
    })

    // --- Providers ---

    ipcMain.handle(AgentIpcChannels.PROVIDERS_LIST, () => {
      return getAllProviders()
    })

    ipcMain.handle(AgentIpcChannels.PROVIDERS_CREATE, (_event, data: CreateProviderRequest) => {
      return createProvider(data)
    })

    ipcMain.handle(AgentIpcChannels.PROVIDERS_UPDATE, (_event, id: string, data: UpdateProviderRequest) => {
      return updateProvider(id, data)
    })

    ipcMain.handle(AgentIpcChannels.PROVIDERS_DELETE, (_event, id: string) => {
      return deleteProvider(id)
    })

    ipcMain.handle(AgentIpcChannels.PROVIDERS_ACTIVATE, (_event, id: string, agentType: string) => {
      log.info('[providers] activate id=%s agentType=%s', id, agentType)
      const result = activateProvider(id, agentType)
      this.markAllNeedsRebuild()
      this.broadcastProviderChanged(agentType === 'codex' ? 'codex' : 'claude')
      return result
    })

    ipcMain.handle(AgentIpcChannels.PROVIDERS_DEACTIVATE_ALL, (_event, agentType: string) => {
      log.info('[providers] deactivate all, agentType=%s', agentType)
      deactivateAllProviders(agentType)
      this.markAllNeedsRebuild()
      this.broadcastProviderChanged(agentType === 'codex' ? 'codex' : 'claude')
    })

    ipcMain.handle(AgentIpcChannels.PROVIDERS_TEST, async (_event, data: { api_key: string; base_url: string; extra_env: string }) => {
      const env: Record<string, string> = {}
      if (data.api_key) env.ANTHROPIC_API_KEY = data.api_key
      if (data.base_url) env.ANTHROPIC_BASE_URL = data.base_url
      try {
        const parsed = JSON.parse(data.extra_env || '{}')
        Object.assign(env, parsed)
      } catch { /* ignore */ }
      if (data.api_key && env.ANTHROPIC_AUTH_TOKEN !== undefined) env.ANTHROPIC_AUTH_TOKEN = data.api_key
      try {
        const { query: testQuery } = await import('@anthropic-ai/claude-agent-sdk')
        const mergedEnv = { ...process.env, ...env }
        trace('providers.test', 'options', {
          cwd: process.cwd(),
          envKeys: Object.keys(mergedEnv),
        })
        const q = testQuery({
          prompt: 'Reply with "ok" only.',
          options: {
            env: mergedEnv,
            cwd: process.cwd(),
            pathToClaudeCodeExecutable: resolveSdkClaudeBinary(),
            maxTurns: 1,
            permissionMode: 'bypassPermissions',
            systemPrompt: 'Reply with a single word. Do not use any tools.',
            allowedTools: ['Noop'],
          },
        })
        let authError = ''
        for await (const msg of q) {
          const m = msg as any
          trace('providers.test', 'msg', { type: m.type, subtype: m.subtype, error: m.error })
          if (m.type === 'assistant' && m.error) {
            authError = m.error
            break
          }
          if (m.type === 'result') {
            if (m.is_error) authError = m.result ?? 'Unknown error'
            break
          }
          if (m.type === 'stream_event' && m.event?.type === 'content_block_start') {
            break
          }
        }
        q.close()
        const result = authError
          ? { success: false, models: 0, error: authError }
          : { success: true, models: 0 }
        trace('providers.test', 'result', result)
        return result
      } catch (err) {
        trace('providers.test', 'error', { message: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined })
        return { success: false, models: 0, error: err instanceof Error ? err.message : String(err) }
      }
    })

    // --- Session Providers (new session_providers table) ---

    ipcMain.handle(AgentIpcChannels.SESSION_PROVIDERS_LIST, async () => {
      const { listSessionProviders } = await import('../session/session-provider-repo')
      return listSessionProviders()
    })

    ipcMain.handle(AgentIpcChannels.SESSION_PROVIDERS_LIST_BY_HARNESS, async (_event, harnessId: 'claude' | 'codex') => {
      const { listByHarness } = await import('../session/session-provider-repo')
      return listByHarness(harnessId)
    })

    ipcMain.handle(AgentIpcChannels.SESSION_PROVIDERS_GET, async (_event, id: string) => {
      const { getSessionProvider } = await import('../session/session-provider-repo')
      return getSessionProvider(id)
    })

    ipcMain.handle(AgentIpcChannels.SESSION_PROVIDERS_GET_BASE, async (_event, harnessId: 'claude' | 'codex') => {
      const { getBaseProvider } = await import('../session/session-provider-repo')
      return getBaseProvider(harnessId)
    })

    ipcMain.handle(AgentIpcChannels.SESSION_PROVIDERS_CREATE, async (_event, input: { harnessId: 'claude' | 'codex'; name: string; config: unknown; id?: string }) => {
      const { createSessionProvider } = await import('../session/session-provider-repo')
      return createSessionProvider(input)
    })

    ipcMain.handle(AgentIpcChannels.SESSION_PROVIDERS_UPDATE, async (_event, id: string, patch: { name?: string; config?: unknown }) => {
      const { updateSessionProvider } = await import('../session/session-provider-repo')
      return updateSessionProvider(id, patch)
    })

    ipcMain.handle(AgentIpcChannels.SESSION_PROVIDERS_DELETE, async (_event, id: string) => {
      const { deleteSessionProvider } = await import('../session/session-provider-repo')
      return deleteSessionProvider(id)
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

    ipcMain.handle(AgentIpcChannels.SESSIONS_LIST_FOR_FOLDER_PAGE, (_event, folderPath: string, limit: number, offset: number) => {
      return listSessionsForFolder(folderPath, limit, offset)
    })

    ipcMain.handle(AgentIpcChannels.SESSIONS_RESUME, async (_event, projectPath: string, sessionId: string, _worktreeCwd?: string, permissionMode?: PermissionMode) => {
      const mgr = this.requireSessionManager()
      const defaults = this.readDefaultSessionPrefs()
      const effectiveMode = permissionMode ?? defaults.permissionMode
      let session = mgr.getSession(sessionId)
      if (!session) {
        try { session = mgr.resumeSession(sessionId, { permissionMode: effectiveMode, sandboxMode: defaults.sandboxMode }) } catch { return }
      } else if (permissionMode) {
        await session.setPermissionMode(permissionMode)
      }
      try { mgr.setActiveSession(projectPath, sessionId) } catch { /* session from another project, skip */ }
      return {
        permissionMode: session.getCurrentPermissionMode(),
        sandboxInfo: session.getCurrentSandboxInfo(),
      }
    })

    ipcMain.handle(AgentIpcChannels.PARK_SESSION, async (_event, projectPath: string) => {
      if (this.isRemoteLockedSession(projectPath)) throw new Error('Session is controlled remotely')
      const mgr = this.requireSessionManager()
      mgr.clearActiveSession(projectPath)
      const { permissionMode, sandboxMode } = this.readDefaultSessionPrefs()
      const sandboxInfo = sandboxMode !== undefined
        ? { enabled: sandboxMode !== 'off', autoAllowBash: sandboxMode === 'auto' }
        : { enabled: true, autoAllowBash: false }
      return { permissionMode, sandboxInfo }
    })

    ipcMain.handle(AgentIpcChannels.ACTIVATE_SESSION, async (_event, projectPath: string, sessionId: string) => {
      const mgr = this.requireSessionManager()
      let session = mgr.getSession(sessionId)
      if (!session) {
        try { session = mgr.resumeSession(sessionId) } catch { return }
      }
      try { mgr.setActiveSession(projectPath, sessionId) } catch { /* belongs to another project */ }
    })

    ipcMain.handle(AgentIpcChannels.GET_LIVE_SNAPSHOTS, () => {
      return this.requireSessionManager().listLiveSnapshots()
    })

    ipcMain.handle(AgentIpcChannels.SESSIONS_LOAD_MESSAGES, (_event, projectPath: string, sessionId: string, limit: number, cursor?: number) => {
      return loadSessionMessages(projectPath, sessionId, limit, cursor)
    })

    ipcMain.handle(AgentIpcChannels.SESSIONS_RENAME, (_event, sessionId: string, title: string) => {
      dbRenameSession(sessionId, title)
    })

    ipcMain.handle(AgentIpcChannels.SESSIONS_LOAD_STATE, (_event, sessionId: string) => {
      return loadSessionState(sessionId)
    })

    ipcMain.handle(AgentIpcChannels.SESSIONS_DELETE, (_event, sessionId: string) => {
      dbDeleteSession(sessionId)
      this.mainWindow && !this.mainWindow.isDestroyed() && this.mainWindow.webContents.send(AgentIpcChannels.SESSIONS_CHANGED)
    })

    ipcMain.handle(AgentIpcChannels.SESSIONS_DELETE_OLDER, (_event, folderPath: string, cutoffDate: string) => {
      const deleted = dbDeleteSessionsOlderThan(folderPath, cutoffDate)
      if (deleted.length > 0) {
        this.mainWindow && !this.mainWindow.isDestroyed() && this.mainWindow.webContents.send(AgentIpcChannels.SESSIONS_CHANGED)
      }
      return deleted
    })

    ipcMain.handle(AgentIpcChannels.SESSIONS_PIN, (_event, sessionId: string, pinned: boolean) => {
      dbPinSession(sessionId, pinned)
    })

    ipcMain.handle(AgentIpcChannels.SESSIONS_HIDE, (_event, sessionId: string, hidden: boolean) => {
      dbHideSession(sessionId, hidden)
    })

    ipcMain.handle(AgentIpcChannels.SESSIONS_LIST_PINNED, () => {
      return listPinnedSessions()
    })
  }

  async switchCwd(projectPath: string, newCwd: string, gitBranch?: string | null): Promise<void> {
    const mgr = this.sessionManager
    if (!mgr) return
    const session = mgr.getActiveSession(projectPath)
    if (!session) return
    await session.switchCwd(newCwd, gitBranch)
  }

  async openFolder(cwd: string): Promise<void> {
    this.sessionManager?.openProject(cwd)
  }

  async closeProject(cwd: string): Promise<void> {
    await this.sessionManager?.closeProject(cwd)

    if (this.remoteSession?.projectPath === cwd) {
      const sid = this.remoteSession.sessionId
      this.broadcastEventToRenderer({ type: 'remote_session_end', remoteProjectPath: cwd, remoteSessionId: sid })
      this.remoteOwnedSids.delete(sid)
      this.remoteSession = null
      this.remoteControlService?.clearRemoteSessionFilter()
    }
  }

  async transferRemoteToLocal(projectPath: string, sessionId: string): Promise<void> {
    if (!this.remoteSession || this.remoteSession.projectPath !== projectPath) return
    this.remoteSession = null
    this.remoteOwnedSids.delete(sessionId)
    this.remoteControlService?.clearRemoteSessionFilter()
    this.broadcastEventToRenderer({ type: 'remote_session_end', remoteProjectPath: projectPath, remoteSessionId: sessionId })
  }

  hasRunningSessions(): boolean {
    return this.sessionManager?.hasAnyStreaming() ?? false
  }

  async dispose(): Promise<void> {
    this.warmupManager.dispose()
    if (this.remoteSession) {
      const sid = this.remoteSession.sessionId
      this.broadcastEventToRenderer({ type: 'remote_session_end', remoteProjectPath: this.remoteSession.projectPath, remoteSessionId: sid })
      this.remoteOwnedSids.delete(sid)
      this.remoteSession = null
      this.remoteControlService?.clearRemoteSessionFilter()
    }

    ipcMain.removeHandler(AgentIpcChannels.SEND_MESSAGE)
    ipcMain.removeHandler(AgentIpcChannels.DEQUEUE_MESSAGE)
    ipcMain.removeHandler(AgentIpcChannels.PREWARM)
    ipcMain.removeHandler(AgentIpcChannels.INTERRUPT)
    ipcMain.removeHandler(AgentIpcChannels.PERMISSION_RESPONSE)
    ipcMain.removeHandler(AgentIpcChannels.SET_PERMISSION_MODE)
    ipcMain.removeHandler(AgentIpcChannels.SET_SESSION_SETTINGS)
    ipcMain.removeHandler(AgentIpcChannels.SET_SANDBOX_MODE)
    ipcMain.removeHandler(AgentIpcChannels.ANSWER_QUESTION)
    ipcMain.removeHandler(AgentIpcChannels.DISMISS_QUESTION)
    ipcMain.removeHandler(AgentIpcChannels.RESPOND_PLAN_APPROVAL)
    ipcMain.removeHandler(AgentIpcChannels.RESET_SESSION)
    ipcMain.removeHandler(AgentIpcChannels.CREATE_SESSION)
    ipcMain.removeHandler(AgentIpcChannels.TRUNCATE_AT_CHECKPOINT)
    ipcMain.removeHandler(AgentIpcChannels.REWIND_FILES)
    ipcMain.removeHandler(AgentIpcChannels.REWIND_FILES_PREVIEW)
    ipcMain.removeHandler(AgentIpcChannels.REWIND_CODE_AND_CHAT)
    ipcMain.removeHandler(AgentIpcChannels.REWIND_CONVERSATION)
    ipcMain.removeHandler(AgentIpcChannels.GET_SESSION_ID)
    ipcMain.removeHandler(AgentIpcChannels.MCP_SERVER_STATUS)
    ipcMain.removeHandler(AgentIpcChannels.GET_CONTEXT_USAGE)
    ipcMain.removeHandler(AgentIpcChannels.PLUGINS_RELOAD)
    ipcMain.removeHandler(AgentIpcChannels.LIST_DIRECTORY)
    ipcMain.removeHandler(AgentIpcChannels.FIND_LINE_NUMBER)
    ipcMain.removeHandler(AgentIpcChannels.SEARCH_FILES)
    ipcMain.removeHandler(AgentIpcChannels.SEARCH_MENTIONS)
    ipcMain.removeHandler(AgentIpcChannels.DISCONNECT_REMOTE_SESSION)
    ipcMain.removeHandler(AgentIpcChannels.READ_PROJECT_ADDITIONAL_DIRS)
    ipcMain.removeHandler(AgentIpcChannels.WRITE_PROJECT_ADDITIONAL_DIRS)
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
    ipcMain.removeHandler(AgentIpcChannels.CODEX_SKILLS_DELETE)
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
    ipcMain.removeHandler(AgentIpcChannels.SESSION_PROVIDERS_LIST)
    ipcMain.removeHandler(AgentIpcChannels.SESSION_PROVIDERS_LIST_BY_HARNESS)
    ipcMain.removeHandler(AgentIpcChannels.SESSION_PROVIDERS_GET)
    ipcMain.removeHandler(AgentIpcChannels.SESSION_PROVIDERS_GET_BASE)
    ipcMain.removeHandler(AgentIpcChannels.SESSION_PROVIDERS_CREATE)
    ipcMain.removeHandler(AgentIpcChannels.SESSION_PROVIDERS_UPDATE)
    ipcMain.removeHandler(AgentIpcChannels.SESSION_PROVIDERS_DELETE)
    ipcMain.removeHandler(AgentIpcChannels.PARK_SESSION)
    ipcMain.removeHandler(AgentIpcChannels.ACTIVATE_SESSION)
    ipcMain.removeHandler(AgentIpcChannels.GET_LIVE_SNAPSHOTS)
    ipcMain.removeHandler(AgentIpcChannels.SESSIONS_LIST)
    ipcMain.removeHandler(AgentIpcChannels.SESSIONS_LIST_FOR_FOLDER)
    ipcMain.removeHandler(AgentIpcChannels.SESSIONS_LIST_FOR_FOLDER_PAGE)
    ipcMain.removeHandler(AgentIpcChannels.SESSIONS_RESUME)
    ipcMain.removeHandler(AgentIpcChannels.SESSIONS_LOAD_MESSAGES)
    ipcMain.removeHandler(AgentIpcChannels.SESSIONS_RENAME)
    ipcMain.removeHandler(AgentIpcChannels.SESSIONS_LOAD_STATE)
    ipcMain.removeHandler(AgentIpcChannels.SESSIONS_DELETE)
    ipcMain.removeHandler(AgentIpcChannels.SESSIONS_DELETE_OLDER)
    ipcMain.removeHandler(AgentIpcChannels.SESSIONS_PIN)
    ipcMain.removeHandler(AgentIpcChannels.SESSIONS_HIDE)
    ipcMain.removeHandler(AgentIpcChannels.SESSIONS_LIST_PINNED)
  }
}
