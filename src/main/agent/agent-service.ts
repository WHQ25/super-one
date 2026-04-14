import { execFile, execFileSync } from 'child_process'
import { statSync } from 'fs'
import log from '../logger'
import { resolve, join, basename, dirname, sep } from 'path'
import { ipcMain, type BrowserWindow } from 'electron'
import { ClaudeAgent, readProjectAdditionalDirs, writeProjectAdditionalDirs, type ClaudeAgentConfig } from './claude-agent'
import { fetchModels } from './claude-models'
import { AgentIpcChannels, type AgentEvent, type ChatMessage, type CodexRunResult, type ModelOption, type PermissionMode, type QuestionAnnotations, type RemoteCommand, type ResourceScope, type SandboxMode, type SendMessageRequest } from '../../shared/agent-types'
import type { RemoteControlService, RemoteResponder } from '../remote-control-service'
import { stripMessagesForRemote } from '../remote-control-service'
import { trace } from './event-trace'
import { getRecentFolders, addRecentFolder } from '../recent-folders'
import { readdir, mkdir } from 'fs/promises'
import { existsSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { getDb, getCachedResources } from '../database'
import { sanitizeGitRef } from '../path-security'
import { searchFiles, searchMentions, type AgentEntry } from './fuzzy-file-search'
import { clearAllGates } from '../generative-ui/widget-gate'
import { resolveSdkCli, getNodeRuntime } from './resolve-cli'
import { applyClaudeEventToRuntime, buildClaudeUserMessage, createClaudeRuntime, extractClaudeTitle, hydrateClaudeRuntime, mergeClaudeRuntimes, patchAgentBlock, readOutputFileResultText, syncClaudeRuntimeLocation, type ClaudeSessionRuntime, type PersistedClaudeSessionState } from './claude-session-runtime'
import { applyCodexEventToRuntime, buildCodexAssistantMessage, buildCodexUserMessage, createCodexRuntime, extractCodexTitle, finalizeCodexAssistantMessage, hydrateCodexRuntime, mergeCodexRuntimes, removeCodexAssistantMessage, syncCodexRuntimeLocation, withCodexTurnMessages, type CodexSessionRuntime, type PersistedCodexSessionState } from './codex-session-runtime'

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
import { listCodexMcpConfigs } from '../codex-config-service'
import { discoverAllAgents, discoverProjectCommands, readAgentFile } from './discover-resources'
import { listPlugins, readPluginContent, readPluginFile, deletePlugin, listMarketplacePlugins, installPlugin, updatePlugin, updateMarketplace } from '../plugins-service'
import { backupMcpServers, listLibrary, deleteLibraryEntry } from '../mcp-library-service'
import { getAllProviders, createProvider, updateProvider, deleteProvider, activateProvider, deactivateAllProviders } from '../database'
import type { CreateProviderRequest, UpdateProviderRequest } from '../../shared/agent-types'

interface RemoteAgentRef {
  getSessionId(): string | undefined
  isReady(): boolean
  sendMessage(request: SendMessageRequest): Promise<void>
  interrupt(): Promise<void>
  respondToPermission(requestId: string, allow: boolean, alwaysAllow?: boolean, reason?: string, selectedSuggestions?: number[]): void
  respondToQuestion(requestId: string, answers: Record<string, string>): void
  dismissQuestion(requestId: string): void
  respondToPlanApproval(requestId: string, approved: boolean, feedback?: string): void
  setPermissionMode(mode: PermissionMode): Promise<void>
  dispose(): Promise<void>
}

function hasRemoteAgentCwd(agent: RemoteAgentRef): agent is RemoteAgentRef & { getCwd(): string } {
  return typeof (agent as { getCwd?: unknown }).getCwd === 'function'
}

export class AgentService {
  private agents = new Map<string, ClaudeAgent>()
  private bgAgents = new Map<string, { agent: ClaudeAgent; projectPath: string; gitRoot: string }>()
  private claudeRuntimes = new Map<string, ClaudeSessionRuntime>()
  private pendingClaudeRuntimes = new Map<string, ClaudeSessionRuntime>()
  private parkedPendingRuntimes = new Map<string, ClaudeSessionRuntime>()
  private pendingClaudeSessionRekeys = new Map<string, { fromSessionId: string; userMessageId: string }>()
  private notifiedClaudeSessions = new Set<string>()
  private codexRuntimes = new Map<string, CodexSessionRuntime>()
  private notifiedCodexSessions = new Set<string>()
  private mainWindow: BrowserWindow | null = null
  private pendingParkCounter = 0
  private eventSubscribers: Array<(event: AgentEvent) => void> = []
  private codexListModels?: (projectPath: string) => Promise<ModelOption[]>
  private codexGetAuthStatus?: (projectPath: string) => unknown
  private codexRun?: (sessionId: string, projectPath: string, opts: {
    prompt: string
    model?: string
    reasoningEffort?: string
    permissionPreset?: string
    collaborationMode?: string
    threadId?: string
    messageId?: string
    images?: unknown[]
    cwd?: string
  }) => Promise<CodexRunResult>
  private remoteControlService?: RemoteControlService
  private remoteSession: { projectPath: string; agent: RemoteAgentRef; bufferForRenderer?: (event: AgentEvent) => void } | null = null

  setCodexListModels(fn: (projectPath: string) => Promise<ModelOption[]>): void {
    this.codexListModels = fn
  }

  setCodexGetAuthStatus(fn: (projectPath: string) => unknown): void {
    this.codexGetAuthStatus = fn
  }

  setCodexRun(fn: typeof this.codexRun): void {
    this.codexRun = fn
  }

  setRemoteControlService(svc: RemoteControlService): void {
    this.remoteControlService = svc
  }

  private broadcastEventToRenderer(event: AgentEvent): void {
    trace('remote.debug', 'broadcastEventToRenderer', { type: event.type, projectPath: event.projectPath, sessionId: event.sessionId, messageId: 'messageId' in event ? event.messageId : undefined })
    this.mainWindow && !this.mainWindow.isDestroyed() && this.mainWindow.webContents.send(AgentIpcChannels.EVENT, event)
  }

  private isRemoteLockedSession(projectPath: string): boolean {
    if (!this.remoteSession || this.remoteSession.projectPath !== projectPath) return false
    const remoteSid = this.remoteSession.agent.getSessionId()
    const agent = this.agents.get(projectPath)
    return agent?.getSessionId() === remoteSid
  }

  private canAccessSession(projectPath: string, sessionId: string): boolean {
    if (this.remoteSession?.projectPath === projectPath && this.remoteSession.agent.getSessionId() === sessionId) {
      return true
    }
    const active = this.agents.get(projectPath)
    if (active?.getSessionId() === sessionId) return true
    const bg = this.bgAgents.get(sessionId)
    if (bg && bg.gitRoot === getGitRoot(projectPath)) return true
    return sessionBelongsToProject(projectPath, sessionId)
  }

  private buildSessionAccessError(projectPath: string, sessionId: string): string {
    return `Session ${sessionId} does not belong to project ${projectPath}`
  }

  private getClaudeRuntimeCwd(projectPath: string, sessionId?: string | null): string | undefined {
    if (sessionId) {
      if (this.remoteSession?.projectPath === projectPath && this.remoteSession.agent.getSessionId() === sessionId && hasRemoteAgentCwd(this.remoteSession.agent)) {
        return this.remoteSession.agent.getCwd()
      }
      const active = this.agents.get(projectPath)
      if (active?.getSessionId() === sessionId) return active.getCwd()
      const bg = this.bgAgents.get(sessionId)
      if (bg?.projectPath === projectPath) return bg.agent.getCwd()
    }

    if (this.remoteSession?.projectPath === projectPath && hasRemoteAgentCwd(this.remoteSession.agent)) {
      return this.remoteSession.agent.getCwd()
    }
    return this.agents.get(projectPath)?.getCwd()
  }

  private getClaudeRuntimeSnapshot(sessionId: string): PersistedClaudeSessionState | null {
    const runtime = this.claudeRuntimes.get(sessionId)
    if (!runtime) return null
    return {
      messages: runtime.messages,
      totalCostUsd: runtime.totalCostUsd,
      contextTokens: runtime.contextTokens,
      isWorktree: !!runtime.worktreePath,
      gitBranch: runtime.gitBranch,
      worktreePath: runtime.worktreePath,
      provider: 'claude',
    }
  }

  private loadOrCreateClaudeRuntime(
    projectPath: string,
    sessionId: string,
    options: {
      cwd?: string
      gitBranch?: string | null
      worktreePath?: string | null
    } = {},
  ): ClaudeSessionRuntime {
    const existing = this.claudeRuntimes.get(sessionId)
    if (existing) {
      const updated = syncClaudeRuntimeLocation(existing, projectPath, options.gitBranch, options.worktreePath, options.cwd)
      this.claudeRuntimes.set(sessionId, updated)
      return updated
    }

    const saved = loadSessionState(sessionId) as PersistedClaudeSessionState | null
    const runtime = syncClaudeRuntimeLocation(
      hydrateClaudeRuntime(projectPath, sessionId, saved, options.cwd),
      projectPath,
      options.gitBranch ?? saved?.gitBranch ?? null,
      options.worktreePath ?? saved?.worktreePath ?? null,
      options.cwd,
    )
    this.claudeRuntimes.set(sessionId, runtime)
    return runtime
  }

  private getOrCreatePendingClaudeRuntime(
    projectPath: string,
    options: {
      cwd?: string
      gitBranch?: string | null
      worktreePath?: string | null
    } = {},
    pendingKey: string = projectPath,
  ): ClaudeSessionRuntime {
    const existing = this.pendingClaudeRuntimes.get(pendingKey)
    if (existing) {
      const updated = syncClaudeRuntimeLocation(existing, projectPath, options.gitBranch, options.worktreePath, options.cwd)
      this.pendingClaudeRuntimes.set(pendingKey, updated)
      return updated
    }

    if (pendingKey !== projectPath) {
      const fallback = this.pendingClaudeRuntimes.get(projectPath)
      if (fallback) {
        const updated = syncClaudeRuntimeLocation(fallback, projectPath, options.gitBranch, options.worktreePath, options.cwd)
        this.pendingClaudeRuntimes.delete(projectPath)
        this.pendingClaudeRuntimes.set(pendingKey, updated)
        return updated
      }
    }

    const runtime = syncClaudeRuntimeLocation(
      createClaudeRuntime(projectPath, null),
      projectPath,
      options.gitBranch ?? null,
      options.worktreePath ?? null,
      options.cwd,
    )
    this.pendingClaudeRuntimes.set(pendingKey, runtime)
    return runtime
  }

  private persistClaudeRuntime(sessionId: string): void {
    const runtime = this.claudeRuntimes.get(sessionId)
    if (!runtime || runtime.messages.length === 0) return
    trace('persist.debug', 'persist_all', {
      sessionId,
      messages: runtime.messages.map((m) => ({ id: m.id, role: m.role, status: m.status, contentLen: JSON.stringify(m.content).length })),
    })
    const title = extractClaudeTitle(runtime.messages)
    createSession(
      runtime.projectPath,
      sessionId,
      title,
      !!runtime.worktreePath,
      runtime.gitBranch ?? undefined,
      runtime.worktreePath ?? undefined,
    )
    if (!this.notifiedClaudeSessions.has(sessionId)) {
      this.notifiedClaudeSessions.add(sessionId)
      this.mainWindow && !this.mainWindow.isDestroyed() && this.mainWindow.webContents.send(AgentIpcChannels.SESSIONS_CHANGED)
    }
    saveSessionState(sessionId, {
      messages: runtime.messages,
      totalCostUsd: runtime.totalCostUsd,
      contextTokens: runtime.contextTokens,
      title,
      provider: 'claude',
    })
  }

  private scheduleOutputFileRead(sessionId: string, toolUseId: string, outputFile: string, attempt = 0): void {
    const MAX_ATTEMPTS = 5
    let prevSize = -1
    try { prevSize = statSync(outputFile).size } catch { return }
    setTimeout(() => {
      let currentSize: number
      try { currentSize = statSync(outputFile).size } catch { return }
      if (currentSize !== prevSize && attempt < MAX_ATTEMPTS) {
        this.scheduleOutputFileRead(sessionId, toolUseId, outputFile, attempt + 1)
        return
      }
      const resultText = readOutputFileResultText(outputFile)
      if (!resultText) return
      const rt = this.claudeRuntimes.get(sessionId)
      if (!rt) return
      this.claudeRuntimes.set(sessionId, {
        ...rt,
        messages: patchAgentBlock(rt.messages, toolUseId, { taskResultText: resultText }),
      })
      this.persistClaudeRuntime(sessionId)
    }, 2000)
  }

  private appendClaudeUserMessage(
    projectPath: string,
    request: SendMessageRequest,
    providerId: 'local' | 'remote',
    sessionId?: string,
  ): ChatMessage {
    const cwd = request.worktreePath ?? this.getClaudeRuntimeCwd(projectPath, sessionId)
    const runtime = sessionId
      ? this.loadOrCreateClaudeRuntime(projectPath, sessionId, {
          cwd,
          gitBranch: request.gitBranch ?? null,
          worktreePath: request.worktreePath ?? null,
        })
      : this.getOrCreatePendingClaudeRuntime(projectPath, {
          cwd,
          gitBranch: request.gitBranch ?? null,
          worktreePath: request.worktreePath ?? null,
        })
    const userMessage = buildClaudeUserMessage(request, providerId)
    const updated = {
      ...runtime,
      messages: runtime.messages.some((message) => message.id === userMessage.id)
        ? runtime.messages
        : [...runtime.messages, userMessage],
    }
    if (updated.sessionId) {
      this.claudeRuntimes.set(updated.sessionId, updated)
      this.persistClaudeRuntime(updated.sessionId)
    } else {
      this.pendingClaudeRuntimes.set(projectPath, updated)
    }
    return userMessage
  }

  private trackClaudeSessionRekey(projectPath: string, sessionId: string | undefined, userMessageId: string): void {
    if (!sessionId) return
    this.pendingClaudeSessionRekeys.set(projectPath, { fromSessionId: sessionId, userMessageId })
  }

  private clearClaudeSessionRekey(projectPath: string, sessionId?: string): void {
    const tracked = this.pendingClaudeSessionRekeys.get(projectPath)
    if (!tracked) return
    if (!sessionId || tracked.fromSessionId === sessionId) {
      this.pendingClaudeSessionRekeys.delete(projectPath)
    }
  }

  private rollbackTrackedClaudeUserMessage(projectPath: string, sessionId: string): void {
    const tracked = this.pendingClaudeSessionRekeys.get(projectPath)
    if (!tracked || tracked.fromSessionId !== sessionId) return
    const runtime = this.claudeRuntimes.get(sessionId)
    if (!runtime) {
      this.pendingClaudeSessionRekeys.delete(projectPath)
      return
    }
    if (!runtime.messages.some((message) => message.id === tracked.userMessageId)) {
      this.pendingClaudeSessionRekeys.delete(projectPath)
      return
    }
    const reverted = {
      ...runtime,
      messages: runtime.messages.filter((message) => message.id !== tracked.userMessageId),
    }
    this.claudeRuntimes.set(sessionId, reverted)
    if (reverted.messages.length > 0) {
      this.persistClaudeRuntime(sessionId)
    }
    this.pendingClaudeSessionRekeys.delete(projectPath)
  }

  private recordClaudeEvent(event: AgentEvent): void {
    const projectPath = event.projectPath
    if (!projectPath) return
    const pendingKey = event.draftSessionId ?? projectPath

    if (event.type === 'session_init' && event.session?.sessionId) {
      const realSid = event.session.sessionId
      const pending = event.draftSessionId
        ? this.pendingClaudeRuntimes.get(event.draftSessionId)
        : this.pendingClaudeRuntimes.get(projectPath)
      const trackedRekey = this.pendingClaudeSessionRekeys.get(projectPath)
      const trackedRuntime = trackedRekey && trackedRekey.fromSessionId !== realSid
        ? this.claudeRuntimes.get(trackedRekey.fromSessionId)
        : null
      const shouldMergeTrackedRuntime = !!(
        trackedRekey
        && trackedRuntime
        && trackedRuntime.messages.some((message) => message.id === trackedRekey.userMessageId)
      )
      const parkedPending = event.draftSessionId
        ? this.parkedPendingRuntimes.get(event.draftSessionId)
        : null
      let runtime = this.loadOrCreateClaudeRuntime(projectPath, realSid, { cwd: event.session.cwd })
      if (shouldMergeTrackedRuntime && trackedRuntime) {
        runtime = mergeClaudeRuntimes(runtime, { ...trackedRuntime, sessionId: realSid, session: event.session })
      }
      if (parkedPending) {
        runtime = mergeClaudeRuntimes(runtime, { ...parkedPending, sessionId: realSid, session: event.session })
        this.parkedPendingRuntimes.delete(event.draftSessionId!)
      }
      if (pending) {
        runtime = mergeClaudeRuntimes(runtime, { ...pending, sessionId: realSid, session: event.session })
      }
      const existingRuntime = this.claudeRuntimes.get(realSid)
      const msgSnapshot = (msgs: ChatMessage[]) => msgs.map((m) => ({ id: m.id, role: m.role, status: m.status, contentLen: JSON.stringify(m.content).length }))
      trace('session.lifecycle', 'session_init_merge', {
        realSid,
        draftSessionId: event.draftSessionId,
        pendingKey,
        existingRuntimeMsgCount: existingRuntime?.messages.length ?? 0,
        shouldMergeTrackedRuntime,
        hasPending: !!pending,
        hasParkedPending: !!parkedPending,
        trackedFromSid: trackedRekey?.fromSessionId,
        runtimeMsgs: msgSnapshot(runtime.messages),
        pendingMsgs: pending ? msgSnapshot(pending.messages) : null,
        trackedMsgs: trackedRuntime ? msgSnapshot(trackedRuntime.messages) : null,
      })
      const updated = applyClaudeEventToRuntime(
        syncClaudeRuntimeLocation(runtime, projectPath, runtime.gitBranch, runtime.worktreePath, event.session.cwd),
        event,
      )
      if (pending) {
        this.pendingClaudeRuntimes.delete(pendingKey)
      }
      this.claudeRuntimes.set(realSid, updated)
      if (shouldMergeTrackedRuntime && trackedRekey) {
        this.rollbackTrackedClaudeUserMessage(projectPath, trackedRekey.fromSessionId)
      } else {
        this.clearClaudeSessionRekey(projectPath, realSid)
      }
      this.persistClaudeRuntime(realSid)
      return
    }

    if (event.sessionId) {
      const runtime = applyClaudeEventToRuntime(
        this.loadOrCreateClaudeRuntime(projectPath, event.sessionId, {
          cwd: this.getClaudeRuntimeCwd(projectPath, event.sessionId),
        }),
        event,
      )
      this.claudeRuntimes.set(event.sessionId, runtime)
      if (event.type === 'task_notification' && event.outputFile && event.toolUseId) {
        this.scheduleOutputFileRead(event.sessionId, event.toolUseId, event.outputFile)
      }
      if (event.type === 'message_complete' || event.type === 'message_interrupted' || event.type === 'message_error') {
        this.clearClaudeSessionRekey(projectPath, event.sessionId)
        this.persistClaudeRuntime(event.sessionId)
      }
      return
    }

    if (
      event.type === 'message_start'
      || event.type === 'content_delta'
      || event.type === 'message_complete'
      || event.type === 'message_interrupted'
      || event.type === 'message_error'
      || event.type === 'checkpoint_captured'
    ) {
      const runtime = applyClaudeEventToRuntime(
        this.getOrCreatePendingClaudeRuntime(
          projectPath,
          { cwd: this.getClaudeRuntimeCwd(projectPath) },
          pendingKey,
        ),
        event,
      )
      this.pendingClaudeRuntimes.set(pendingKey, runtime)
    }
  }

  private getCodexRuntimeSnapshot(sessionId: string): PersistedCodexSessionState | null {
    const runtime = this.codexRuntimes.get(sessionId)
    if (!runtime) return null
    return {
      messages: runtime.messages,
      totalCostUsd: runtime.totalCostUsd,
      contextTokens: runtime.contextTokens,
      isWorktree: !!runtime.worktreePath,
      gitBranch: runtime.gitBranch,
      worktreePath: runtime.worktreePath,
      provider: 'codex',
    }
  }

  private loadOrCreateCodexRuntime(
    projectPath: string,
    sessionId: string,
    options: {
      cwd?: string
      gitBranch?: string | null
      worktreePath?: string | null
    } = {},
  ): CodexSessionRuntime {
    const existing = this.codexRuntimes.get(sessionId)
    if (existing) {
      const updated = syncCodexRuntimeLocation(existing, projectPath, options.gitBranch, options.worktreePath, options.cwd)
      this.codexRuntimes.set(sessionId, updated)
      return updated
    }

    const saved = loadSessionState(sessionId) as PersistedCodexSessionState | null
    const runtime = syncCodexRuntimeLocation(
      hydrateCodexRuntime(projectPath, sessionId, saved, options.cwd),
      projectPath,
      options.gitBranch ?? saved?.gitBranch ?? null,
      options.worktreePath ?? saved?.worktreePath ?? null,
      options.cwd,
    )
    this.codexRuntimes.set(sessionId, runtime)
    return runtime
  }

  updateCodexPlanApproval(
    sessionId: string,
    messageId: string,
    planApproval: { status: 'approved' | 'rejected'; feedback?: string },
  ): void {
    const runtime = this.codexRuntimes.get(sessionId)
    if (!runtime) return
    const msg = runtime.messages.find((m) => m.id === messageId)
    if (!msg?.metadata?.codex) return
    msg.metadata.codex.planApproval = planApproval
    this.persistCodexRuntime(sessionId)
  }

  private persistCodexRuntime(sessionId: string): void {
    const runtime = this.codexRuntimes.get(sessionId)
    if (!runtime || runtime.messages.length === 0) return
    const title = extractCodexTitle(runtime.messages)
    createSession(
      runtime.projectPath,
      sessionId,
      title,
      !!runtime.worktreePath,
      runtime.gitBranch ?? undefined,
      runtime.worktreePath ?? undefined,
    )
    if (!this.notifiedCodexSessions.has(sessionId)) {
      this.notifiedCodexSessions.add(sessionId)
      this.mainWindow && !this.mainWindow.isDestroyed() && this.mainWindow.webContents.send(AgentIpcChannels.SESSIONS_CHANGED)
    }
    saveSessionState(sessionId, {
      messages: runtime.messages,
      totalCostUsd: runtime.totalCostUsd,
      contextTokens: runtime.contextTokens,
      title,
      provider: 'codex',
    })
  }

  beginCodexTurn(
    projectPath: string,
    sessionId: string,
    options: {
      userMessageId: string
      userText: string
      assistantMessageId: string
      providerId: 'local' | 'remote'
      images?: SendMessageRequest['images']
      gitBranch?: string | null
      worktreePath?: string | null
      cwd?: string
    },
  ): { userMessage: ChatMessage; assistantMessage: ChatMessage } {
    const runtime = this.loadOrCreateCodexRuntime(projectPath, sessionId, {
      cwd: options.cwd ?? options.worktreePath ?? undefined,
      gitBranch: options.gitBranch ?? null,
      worktreePath: options.worktreePath ?? null,
    })
    const userMessage = buildCodexUserMessage({
      content: options.userText,
      images: options.images,
      clientMessageId: options.userMessageId,
    }, options.providerId)
    const assistantMessage = buildCodexAssistantMessage(options.assistantMessageId)
    const updated = withCodexTurnMessages(runtime, userMessage, assistantMessage)
    this.codexRuntimes.set(sessionId, updated)
    this.persistCodexRuntime(sessionId)
    return { userMessage, assistantMessage }
  }

  rollbackCodexAssistantMessage(sessionId: string, messageId: string): void {
    const runtime = this.codexRuntimes.get(sessionId)
    if (!runtime) return
    const updated = removeCodexAssistantMessage(runtime, messageId)
    this.codexRuntimes.set(sessionId, updated)
    this.persistCodexRuntime(sessionId)
  }

  recordCodexEvent(event: AgentEvent): void {
    const projectPath = event.projectPath
    if (!projectPath || !event.sessionId) return
    if (
      event.type !== 'message_usage'
      && event.type !== 'codex_thread_started'
      && event.type !== 'codex_item_delta'
      && event.type !== 'checkpoint_captured'
    ) {
      return
    }
    const runtime = applyCodexEventToRuntime(
      this.loadOrCreateCodexRuntime(projectPath, event.sessionId),
      event,
    )
    this.codexRuntimes.set(event.sessionId, runtime)
  }

  completeCodexTurn(
    sessionId: string,
    options: {
      messageId: string
      result: CodexRunResult
      durationMs: number
      fallbackText: string
    },
  ): void {
    const runtime = this.codexRuntimes.get(sessionId)
    if (!runtime) return
    const text = options.result.finalResponse?.trim() || options.fallbackText
    const updated = finalizeCodexAssistantMessage(runtime, {
      messageId: options.messageId,
      status: 'complete',
      text,
      result: options.result,
      durationMs: options.durationMs,
    })
    this.codexRuntimes.set(sessionId, updated)
    this.persistCodexRuntime(sessionId)
  }

  failCodexTurn(
    sessionId: string,
    options: {
      messageId: string
      status: 'interrupted' | 'error'
      text: string
    },
  ): void {
    const runtime = this.codexRuntimes.get(sessionId)
    if (!runtime) return
    const updated = finalizeCodexAssistantMessage(runtime, {
      messageId: options.messageId,
      status: options.status,
      text: options.text,
    })
    this.codexRuntimes.set(sessionId, updated)
    this.persistCodexRuntime(sessionId)
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
    let sessionId: string | undefined
    const buffer: AgentEvent[] = []
    const emit = (event: AgentEvent): void => {
      const eventWithPath = { ...event, projectPath }
      if (!sessionId && event.type === 'session_init' && event.session?.sessionId) {
        sessionId = event.session.sessionId
        if (options.automationId) {
          createAutomationSession(
            projectPath,
            sessionId,
            `[Auto] ${options.automationName ?? 'Automation'}`,
            options.automationId,
            'claude',
          )
        }
      }
      this.recordClaudeEvent(eventWithPath)
      this.eventSubscribers.forEach((cb) => cb(eventWithPath))
      if (event.type === 'session_init' && sessionId) {
        for (const e of buffer) {
          this.broadcastEventToRenderer({ ...e, sessionId })
        }
        buffer.length = 0
      }
      if (sessionId) {
        this.broadcastEventToRenderer(eventWithPath)
      } else {
        buffer.push(eventWithPath)
      }
    }

    const agent = new ClaudeAgent()
    await agent.initialize(
      { cwd: projectPath, model: options.model },
      emit,
      undefined,
      options.permissionMode ? { permissionMode: options.permissionMode as PermissionMode } : undefined,
    )

    if (options.effort) agent.setInitialEffort(options.effort as never)

    const userMessage = this.appendClaudeUserMessage(projectPath, {
      content: options.content,
      clientMessageId: `auto_${Date.now()}`,
    }, 'local', sessionId)
    this.trackClaudeSessionRekey(projectPath, sessionId, userMessage.id)
    buffer.push({ type: 'message_start', message: userMessage, projectPath } as AgentEvent)

    await agent.sendMessage({
      content: options.content,
      model: options.model,
      effort: options.effort as SendMessageRequest['effort'],
    })

    return { sessionId: sessionId ?? '' }
  }

  async runCodexAutomationSession(projectPath: string, options: {
    content: string
    model?: string
    reasoningEffort?: string
    permissionPreset?: string
    automationId?: string
    automationName?: string
  }): Promise<{ sessionId: string }> {
    if (!this.codexRun) throw new Error('Codex runtime not configured')

    const sessionId = `codex-auto-${Date.now()}`
    const userMessageId = `user_${Date.now()}`
    const assistantMessageId = `auto-${Date.now()}`

    if (options.automationId) {
      try {
        createAutomationSession(projectPath, sessionId, `[Auto] ${options.automationName ?? 'Automation'}`, options.automationId, 'codex')
      } catch { /* ignore */ }
    }

    const { userMessage, assistantMessage } = this.beginCodexTurn(projectPath, sessionId, {
      userMessageId,
      userText: options.content,
      assistantMessageId,
      providerId: 'local',
    })

    this.broadcastEventToRenderer({ type: 'message_start', message: userMessage, projectPath, sessionId })
    this.broadcastEventToRenderer({ type: 'message_start', message: assistantMessage, projectPath, sessionId })
    this.broadcastEventToRenderer({ type: 'status_change', status: 'streaming', projectPath, sessionId })

    const runStart = Date.now()
    try {
      const result = await this.codexRun(sessionId, projectPath, {
        prompt: options.content,
        model: options.model,
        reasoningEffort: options.reasoningEffort,
        permissionPreset: options.permissionPreset,
      })
      if (result) {
        this.completeCodexTurn(sessionId, {
          messageId: assistantMessageId,
          result,
          durationMs: Date.now() - runStart,
          fallbackText: 'Codex completed without returning text.',
        })
      }
      this.broadcastEventToRenderer({ type: 'message_complete', messageId: assistantMessageId, projectPath, sessionId })
      this.broadcastEventToRenderer({ type: 'status_change', status: 'idle', projectPath, sessionId })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.failCodexTurn(sessionId, {
        messageId: assistantMessageId,
        status: /interrupt|abort/i.test(message) ? 'interrupted' : 'error',
        text: /interrupt|abort/i.test(message) ? 'Codex run interrupted.' : `Codex run failed: ${message}`,
      })
      this.broadcastEventToRenderer({ type: 'status_change', status: 'idle', projectPath, sessionId })
      throw error
    }

    return { sessionId }
  }

  notifyEventSubscribers(event: AgentEvent): void {
    this.eventSubscribers.forEach((cb) => cb(event))
  }

  private async runCodexRemoteTurn(projectPath: string, sessionId: string, command: { content: string; model?: string; effort?: string; permissionPreset?: string; collaborationMode?: string; threadId?: string; images?: SendMessageRequest['images']; gitBranch?: string | null; worktreeBranch?: string | null }, isNewSession?: boolean): Promise<void> {
    const userMessageId = `user_${Date.now()}`
    const assistantMessageId = `remote-${Date.now()}`
    const codexAgent: RemoteAgentRef = {
      getSessionId: () => sessionId,
      isReady: () => true,
      sendMessage: async () => {},
      interrupt: async () => {},
      respondToPermission: () => {},
      respondToQuestion: () => {},
      dismissQuestion: () => {},
      respondToPlanApproval: () => {},
      setPermissionMode: async () => {},
      dispose: async () => {},
    }
    if (this.remoteSession) await this.remoteSession.agent.dispose()
    this.remoteSession = { projectPath, agent: codexAgent }
    this.remoteControlService?.setRemoteSessionFilter(projectPath, sessionId)
    if (isNewSession) {
      this.remoteControlService?.broadcastAgentEvent({
        type: 'session_init', projectPath, sessionId,
        session: { sessionId, permissionMode: command.permissionPreset ?? 'default' },
      } as AgentEvent)
    }
    this.broadcastEventToRenderer({ type: 'remote_session_start', remoteProjectPath: projectPath, remoteSessionId: sessionId })
    const { userMessage, assistantMessage } = this.beginCodexTurn(projectPath, sessionId, {
      userMessageId,
      userText: command.content,
      assistantMessageId,
      providerId: 'remote',
      images: command.images,
      gitBranch: command.gitBranch ?? command.worktreeBranch ?? null,
    })
    this.remoteControlService?.broadcastAgentEvent({ type: 'message_start', message: userMessage, projectPath, sessionId } as AgentEvent)
    this.remoteControlService?.broadcastAgentEvent({ type: 'message_start', message: assistantMessage, projectPath, sessionId } as AgentEvent)
    this.remoteControlService?.broadcastAgentEvent({ type: 'status_change', status: 'streaming', projectPath, sessionId } as AgentEvent)
    this.broadcastEventToRenderer({ type: 'message_start', message: userMessage, projectPath, sessionId })
    this.broadcastEventToRenderer({ type: 'message_start', message: assistantMessage, projectPath, sessionId })
    this.broadcastEventToRenderer({ type: 'status_change', status: 'streaming', projectPath, sessionId })
    const runStart = Date.now()
    try {
      const result = await this.codexRun?.(sessionId, projectPath, {
        prompt: command.content,
        model: command.model,
        reasoningEffort: command.effort as string | undefined,
        permissionPreset: command.permissionPreset,
        collaborationMode: command.collaborationMode,
        threadId: command.threadId,
        messageId: assistantMessageId,
        images: command.images,
      })
      if (result) {
        this.completeCodexTurn(sessionId, {
          messageId: assistantMessageId,
          result,
          durationMs: Date.now() - runStart,
          fallbackText: 'Codex completed without returning text.',
        })
      }
      this.remoteControlService?.broadcastAgentEvent({ type: 'message_complete', messageId: assistantMessageId, metadata: { durationMs: Date.now() - runStart }, projectPath, sessionId } as AgentEvent)
      this.remoteControlService?.broadcastAgentEvent({ type: 'status_change', status: 'idle', projectPath, sessionId } as AgentEvent)
      this.broadcastEventToRenderer({ type: 'message_complete', messageId: assistantMessageId, projectPath, sessionId })
      this.broadcastEventToRenderer({ type: 'status_change', status: 'idle', projectPath, sessionId })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.failCodexTurn(sessionId, {
        messageId: assistantMessageId,
        status: /interrupt|abort/i.test(message) ? 'interrupted' : 'error',
        text: /interrupt|abort/i.test(message) ? 'Codex run interrupted.' : `Codex run failed: ${message}`,
      })
      this.remoteControlService?.broadcastAgentEvent({ type: /interrupt|abort/i.test(message) ? 'message_interrupted' : 'message_error', messageId: assistantMessageId, projectPath, sessionId } as AgentEvent)
      this.remoteControlService?.broadcastAgentEvent({ type: 'status_change', status: 'idle', projectPath, sessionId } as AgentEvent)
      this.broadcastEventToRenderer({ type: 'status_change', status: 'idle', projectPath, sessionId })
      throw error
    } finally {
      this.remoteControlService?.clearRemoteSessionFilter()
      this.broadcastEventToRenderer({ type: 'remote_session_end', remoteProjectPath: projectPath, remoteSessionId: sessionId })
    }
  }

  async handleRemoteCommand(command: RemoteCommand, respond?: RemoteResponder): Promise<void> {
    trace('remote.cmd', command.type, command)
    switch (command.type) {
      case 'send_message': {
        const projectPath = command.projectPath || this.agents.keys().next().value
        if (!projectPath) break

        const persistUserMessage = (remoteAgent?: RemoteAgentRef): void => {
          const sessionId = (remoteAgent ? remoteAgent.getSessionId() : this.agents.get(projectPath)?.getSessionId()) || undefined
          const userMessage = this.appendClaudeUserMessage(projectPath, {
            content: command.content,
            images: command.images,
            clientMessageId: command.clientMessageId ?? `user_${Date.now()}`,
            gitBranch: command.gitBranch,
          }, 'remote', sessionId)
          this.trackClaudeSessionRekey(projectPath, sessionId, userMessage.id)
          trace('remote.debug', 'persistUserMessage', { projectPath, sessionId, messageId: userMessage.id, isRemote: !!remoteAgent, queued: command.priority === 'next' })
          if (remoteAgent) {
            this.remoteSession?.bufferForRenderer?.({ type: 'message_start', message: userMessage, projectPath, sessionId })
          } else {
            this.broadcastEventToRenderer({ type: 'message_start', message: userMessage, projectPath, sessionId })
          }
        }

        if (command.provider === 'codex') {
          const sessionId = command.sessionId ?? `codex-remote-${Date.now()}`
          await this.runCodexRemoteTurn(projectPath, sessionId, command, !command.sessionId)
        } else {
          let agent: RemoteAgentRef | ClaudeAgent | undefined
          const targetSid = command.sessionId
          if (targetSid) {
            if (!this.canAccessSession(projectPath, targetSid)) {
              log.warn('[AgentService] %s', this.buildSessionAccessError(projectPath, targetSid))
              break
            }
            const remoteSessionSid = this.remoteSession?.agent.getSessionId()
            trace('remote.debug', 'send_message:follow_up', { targetSid, remoteSessionSid, hasRemoteSession: !!this.remoteSession, desktopAgentSid: this.agents.get(projectPath)?.getSessionId() })
            if (remoteSessionSid === targetSid) {
              if (this.remoteSession?.projectPath !== projectPath) {
                log.warn('[AgentService] %s', this.buildSessionAccessError(projectPath, targetSid))
                break
              }
              agent = this.remoteSession!.agent
            } else {
              const current = this.agents.get(projectPath)
              if (current?.isReady() && current.getSessionId() === targetSid) {
                agent = current
              } else {
                if (this.remoteSession) {
                  await this.remoteSession.agent.dispose()
                  this.remoteSession = null
                }
                this.remoteControlService?.clearRemoteSessionFilter()
                const saved = loadSessionState(targetSid)
                if (saved?.provider === 'codex') {
                  await this.runCodexRemoteTurn(projectPath, targetSid, command)
                  break
                }
                const cwd = saved?.worktreePath ?? projectPath
                const remoteAgent = new ClaudeAgent()
                const { emit, bufferForRenderer } = this.createRemoteEventEmitter(projectPath)
                await remoteAgent.initialize({ cwd }, emit, targetSid)
                this.remoteSession = { projectPath, agent: remoteAgent, bufferForRenderer }
                this.remoteControlService?.setRemoteSessionFilter(projectPath, targetSid)
                agent = remoteAgent
              }
            }
          } else {
            if (this.remoteSession) {
              await this.remoteSession.agent.dispose()
              this.remoteSession = null
            }
            this.remoteControlService?.clearRemoteSessionFilter()

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

            const remoteAgent = new ClaudeAgent()
            const { emit, bufferForRenderer } = this.createRemoteEventEmitter(projectPath)
            await remoteAgent.initialize(
              { cwd }, emit, undefined,
              command.permissionMode ? { permissionMode: command.permissionMode as PermissionMode } : undefined,
            )
            this.remoteSession = { projectPath, agent: remoteAgent, bufferForRenderer }

            if (command.effort) remoteAgent.setInitialEffort(command.effort as never)

            const unsub = this.addEventSubscriber((event) => {
              if (event.type === 'session_init' && event.projectPath === projectPath) {
                unsub()
                const sid = (event as { session?: { sessionId?: string } }).session?.sessionId
                if (sid) this.remoteControlService?.setRemoteSessionFilter(projectPath, sid)
              }
            })

            agent = remoteAgent
          }

          if (agent && ('isReady' in agent) && agent.isReady()) {
            const isRemote = this.remoteSession?.agent === agent
            trace('remote.debug', 'send_message:dispatch', { isRemote, agentSid: agent.getSessionId?.() ?? 'unknown', targetSid: command.sessionId })
            persistUserMessage(isRemote ? agent : undefined)
            await agent.sendMessage({ content: command.content, model: command.model, effort: command.effort as never, images: command.images, priority: command.priority, clientMessageId: command.clientMessageId })
          }
        }
        break
      }
      case 'dequeue_message': {
        const projectPath = command.projectPath || this.agents.keys().next().value
        if (!projectPath) break
        const agent = this.findAgentBySessionId(projectPath, command.sessionId)
        if (agent && 'dequeueMessage' in agent) agent.dequeueMessage(command.clientMessageId)
        break
      }
      case 'interrupt': {
        const projectPath = command.projectPath || this.agents.keys().next().value
        if (!projectPath) break
        if (!this.canAccessSession(projectPath, command.sessionId)) {
          log.warn('[AgentService] %s', this.buildSessionAccessError(projectPath, command.sessionId))
          break
        }
        const agent = this.findAgentBySessionId(projectPath, command.sessionId)
        if (agent) { clearAllGates(); await agent.interrupt() }
        break
      }
      case 'respond_permission': {
        const projectPath = command.projectPath || this.agents.keys().next().value
        if (!projectPath) break
        if (!this.canAccessSession(projectPath, command.sessionId)) {
          log.warn('[AgentService] %s', this.buildSessionAccessError(projectPath, command.sessionId))
          break
        }
        const agent = this.findAgentBySessionId(projectPath, command.sessionId)
        if (agent) {
          agent.respondToPermission(command.requestId, command.decision, undefined, command.reason, command.selectedSuggestions)
          this.broadcastEventToRenderer({ type: 'interaction_resolved', interactionType: 'permission', requestId: command.requestId, projectPath, sessionId: command.sessionId })
        } else {
          log.warn('[AgentService] respond_permission: no agent for session %s', command.sessionId)
        }
        break
      }
      case 'answer_question': {
        const projectPath = command.projectPath || this.agents.keys().next().value
        if (!projectPath) break
        if (!this.canAccessSession(projectPath, command.sessionId)) {
          log.warn('[AgentService] %s', this.buildSessionAccessError(projectPath, command.sessionId))
          break
        }
        const agent = this.findAgentBySessionId(projectPath, command.sessionId)
        if (agent) {
          agent.respondToQuestion(command.requestId, command.answers, command.annotations)
          this.broadcastEventToRenderer({ type: 'interaction_resolved', interactionType: 'question', requestId: command.requestId, projectPath, sessionId: command.sessionId })
        } else {
          log.warn('[AgentService] answer_question: no agent for session %s', command.sessionId)
        }
        break
      }
      case 'dismiss_question': {
        const projectPath = command.projectPath || this.agents.keys().next().value
        if (!projectPath) break
        if (!this.canAccessSession(projectPath, command.sessionId)) {
          log.warn('[AgentService] %s', this.buildSessionAccessError(projectPath, command.sessionId))
          break
        }
        const agent = this.findAgentBySessionId(projectPath, command.sessionId)
        if (agent) {
          agent.dismissQuestion(command.requestId)
          this.broadcastEventToRenderer({ type: 'interaction_resolved', interactionType: 'question', requestId: command.requestId, projectPath, sessionId: command.sessionId })
        } else {
          log.warn('[AgentService] dismiss_question: no agent for session %s', command.sessionId)
        }
        break
      }
      case 'respond_plan_approval': {
        const projectPath = command.projectPath || this.agents.keys().next().value
        if (!projectPath) break
        if (!this.canAccessSession(projectPath, command.sessionId)) {
          log.warn('[AgentService] %s', this.buildSessionAccessError(projectPath, command.sessionId))
          break
        }
        const agent = this.findAgentBySessionId(projectPath, command.sessionId)
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
        this.updateCodexPlanApproval(command.sessionId, command.messageId, {
          status: command.status,
          ...(command.feedback ? { feedback: command.feedback } : {}),
        })
        break
      }
      case 'set_permission_mode': {
        const projectPath = command.projectPath || this.agents.keys().next().value
        if (!projectPath) break
        if (!this.canAccessSession(projectPath, command.sessionId)) {
          log.warn('[AgentService] %s', this.buildSessionAccessError(projectPath, command.sessionId))
          break
        }
        const agent = this.findAgentBySessionId(projectPath, command.sessionId)
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
          const agent = this.agents.get(command.projectPath)
          const cwd = agent?.getCwd() ?? command.projectPath
          const agents = discoverAllAgents(command.projectPath).map((a) => ({ name: a.name, model: a.model ?? '' }))
          const items = searchMentions([cwd], command.query, agents, 20)
          await respond?.(command.requestId, { items })
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
          const countStmt = db.prepare('SELECT COUNT(*) as cnt FROM chat_messages WHERE claude_session_id = ?')
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
          log.info('[get_system_info] provider=%s hasCached=%s cachedModels=%d projectPath=%s', command.provider, !!cached, cached?.models?.length ?? 0, command.projectPath)
          if (isClaude) {
            const cachedModels = cached?.models as ModelOption[] | undefined
            const models = cachedModels?.length ? cachedModels : await fetchModels(command.projectPath)
            log.info('[get_system_info] resolvedModels=%d source=%s', models.length, cachedModels?.length ? 'cache' : 'fetch')
            const skills = listSkills(command.projectPath)
            const agents = discoverAllAgents(command.projectPath)
            const projectSlashCommands = discoverProjectCommands(command.projectPath)
            await respond?.(command.requestId, {
              models,
              skills: skills.map((s) => ({ name: s.name, description: s.description ?? '' })),
              agents: agents.map((a) => ({ name: a.name, description: a.description ?? '', model: a.model })),
              userSlashCommands: cached?.slashCommands ?? [],
              projectSlashCommands: projectSlashCommands.map((c) => ({ name: c.name, description: c.description ?? '', argumentHint: c.argumentHint ?? '' })),
              account: cached?.account ?? null,
              permissionModes: ['default', 'acceptEdits', 'plan', 'bypassPermissions'],
              sandboxModes: ['off', 'on', 'auto'],
            })
          } else {
            const models = this.codexListModels ? await this.codexListModels(command.projectPath) : []
            const skills = listCodexSkills(command.projectPath)
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
            await this.switchCwd(command.projectPath, command.projectPath)
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

          await this.switchCwd(command.projectPath, wtPath)
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

  markAllNeedsRebuild(): void {
    for (const agent of this.agents.values()) {
      agent.markNeedsRebuild()
    }
  }

  private getAgent(projectPath: string): ClaudeAgent {
    const agent = this.agents.get(projectPath)
    if (!agent) throw new Error(`No agent for project: ${projectPath}`)
    return agent
  }

  private createEventEmitter(projectPath: string, draftSessionId?: string): (event: AgentEvent) => void {
    let currentDraftId = draftSessionId
    return (event: AgentEvent) => {
      const eventWithPath = { ...event, projectPath, ...(currentDraftId ? { draftSessionId: currentDraftId } : {}) }
      this.recordClaudeEvent(eventWithPath)
      trace('remote.debug', 'desktopEventEmitter', { type: event.type, projectPath, sessionId: event.sessionId })
      this.mainWindow && !this.mainWindow.isDestroyed() && this.mainWindow.webContents.send(AgentIpcChannels.EVENT, eventWithPath)
      this.eventSubscribers.forEach((cb) => cb(eventWithPath))

      // Re-key pending background agents when session_init provides the real session ID
      if (event.type === 'session_init' && event.session?.sessionId) {
        currentDraftId = undefined
        const realSid = event.session.sessionId
        for (const [key, bg] of this.bgAgents.entries()) {
          if (key.startsWith('__pending_') && bg.agent.getSessionId() === realSid) {
            this.bgAgents.delete(key)
            this.bgAgents.set(realSid, bg)
            break
          }
        }
      }

      // Auto-dispose background agents when they go idle
      if (event.type === 'status_change' && event.status === 'idle') {
        const sid = event.sessionId
        if (sid) {
          const bg = this.bgAgents.get(sid)
          if (bg) {
            this.bgAgents.delete(sid)
            bg.agent.dispose().catch(() => {})
          }
        } else {
          for (const [key, bg] of this.bgAgents.entries()) {
            if (key.startsWith('__pending_') && bg.projectPath === projectPath) {
              this.bgAgents.delete(key)
              bg.agent.dispose().catch(() => {})
              break
            }
          }
        }
      }
    }
  }

  private createRemoteEventEmitter(projectPath: string): {
    emit: (event: AgentEvent) => void
    bufferForRenderer: (event: AgentEvent) => void
  } {
    let remoteSessionId: string | null = null
    const buffer: AgentEvent[] = []
    const addToBuffer = (event: AgentEvent): void => {
      if (remoteSessionId) {
        this.broadcastEventToRenderer(event)
      } else {
        buffer.push(event)
      }
    }
    return {
      emit: (event: AgentEvent) => {
        const eventWithPath = { ...event, projectPath }
        this.recordClaudeEvent(eventWithPath)
        trace('remote.debug', 'remoteEventEmitter', { type: event.type, projectPath, sessionId: event.sessionId, subscriberCount: this.eventSubscribers.length })
        this.eventSubscribers.forEach((cb) => cb(eventWithPath))
        addToBuffer(eventWithPath)
        if (!remoteSessionId && event.type === 'session_init' && event.session?.sessionId) {
          remoteSessionId = event.session.sessionId
          this.broadcastEventToRenderer({ type: 'remote_session_start', remoteProjectPath: projectPath, remoteSessionId })
          for (const e of buffer) {
            this.broadcastEventToRenderer({ ...e, sessionId: remoteSessionId })
          }
          buffer.length = 0
        }
      },
      bufferForRenderer: (event: AgentEvent) => {
        addToBuffer({ ...event, projectPath })
      },
    }
  }

  private async parkSession(projectPath: string): Promise<void> {
    const current = this.agents.get(projectPath)
    if (current) {
      if (current.isStreaming()) {
        const key = current.getSessionId() || `__pending_${++this.pendingParkCounter}`
        this.bgAgents.set(key, { agent: current, projectPath, gitRoot: getGitRoot(projectPath) })
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

  private findAgentBySessionId(projectPath: string, sessionId: string): ClaudeAgent | RemoteAgentRef | undefined {
    if (this.remoteSession && this.remoteSession.projectPath === projectPath && this.remoteSession.agent.getSessionId() === sessionId) {
      return this.remoteSession.agent
    }
    const active = this.agents.get(projectPath)
    if (active && active.getSessionId() === sessionId) return active
    const bg = this.bgAgents.get(sessionId)
    if (bg && bg.gitRoot === getGitRoot(projectPath)) return bg.agent
    return undefined
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

  private async replaceAgent(projectPath: string, cwd: string, sessionId?: string, permissionMode?: PermissionMode): Promise<void> {
    const existing = this.agents.get(projectPath)
    if (existing) {
      await existing.dispose()
      this.agents.delete(projectPath)
    }
    const agent = new ClaudeAgent()
    await agent.initialize({ cwd }, this.createEventEmitter(projectPath), sessionId, permissionMode ? { permissionMode } : undefined)
    this.agents.set(projectPath, agent)
  }

  async resumeSession(projectPath: string, sessionId: string, worktreeCwd?: string, permissionMode?: PermissionMode): Promise<void> {
    const effectiveCwd = worktreeCwd ?? projectPath

    if (this.hasBgSession(projectPath, sessionId)) {
      await this.activateSession(projectPath, sessionId)
      return
    }

    const current = this.agents.get(projectPath)
    if (current && current.getSessionId() === sessionId && current.getCwd() === effectiveCwd) {
      return
    }
    if (current && current.isStreaming()) {
      await this.parkSession(projectPath)
      await this.replaceAgent(projectPath, effectiveCwd, sessionId, permissionMode)
      return
    }

    if (!current || current.getCwd() !== effectiveCwd) {
      await this.replaceAgent(projectPath, effectiveCwd, sessionId, permissionMode)
      return
    }

    await current.resumeSession(sessionId, permissionMode)
  }

  setup(): void {

    // --- Session-scoped handlers (projectPath as first arg) ---

    ipcMain.handle(AgentIpcChannels.SEND_MESSAGE, async (_event, projectPath: string, request: SendMessageRequest) => {
      if (this.isRemoteLockedSession(projectPath)) throw new Error('Session is controlled remotely')
      const agent = this.getAgent(projectPath)
      if (!agent.isReady()) throw new Error('Agent not initialized')
      const sessionId = agent.getSessionId() || undefined
      trace('session.lifecycle', 'ipc_sendMessage', {
        projectPath,
        agentSessionId: sessionId ?? '(none)',
        hasBridge: !!(agent as any).bridge,
        isStreaming: agent.isStreaming(),
        pendingRuntimeKeys: [...this.pendingClaudeRuntimes.keys()],
        runtimeKeys: [...this.claudeRuntimes.keys()].slice(0, 10),
      })
      const userMessage = this.appendClaudeUserMessage(projectPath, request, 'local', sessionId)
      this.trackClaudeSessionRekey(projectPath, sessionId, userMessage.id)
      await agent.sendMessage(request)
    })

    ipcMain.handle(AgentIpcChannels.DEQUEUE_MESSAGE, (_event, projectPath: string, clientMessageId: string) => {
      const agent = this.agents.get(projectPath)
      if (!agent) return false
      return agent.dequeueMessage(clientMessageId)
    })

    ipcMain.handle(AgentIpcChannels.INTERRUPT, async (_event, projectPath: string) => {
      const agent = this.agents.get(projectPath)
      if (!agent) return false
      clearAllGates()
      await agent.interrupt()
      if (this.isRemoteLockedSession(projectPath)) {
        this.remoteControlService?.unsubscribeSession((e) => this.broadcastEventToRenderer(e))
      }
      return true
    })

    ipcMain.handle(AgentIpcChannels.PERMISSION_RESPONSE, (_event, projectPath: string, requestId: string, allow: boolean, alwaysAllow?: boolean, reason?: string, selectedSuggestions?: number[]) => {
      if (this.isRemoteLockedSession(projectPath)) throw new Error('Session is controlled remotely')
      trace('agent.emit', 'permission_responded', { requestId, allow, reason })
      this.getAgent(projectPath).respondToPermission(requestId, allow, alwaysAllow, reason, selectedSuggestions)
    })

    ipcMain.handle(AgentIpcChannels.SET_PERMISSION_MODE, async (_event, projectPath: string, mode: PermissionMode) => {
      if (this.isRemoteLockedSession(projectPath)) throw new Error('Session is controlled remotely')
      await this.getAgent(projectPath).setPermissionMode(mode)
    })

    ipcMain.handle(AgentIpcChannels.SET_SANDBOX_MODE, (_event, projectPath: string, mode: SandboxMode) => {
      if (this.isRemoteLockedSession(projectPath)) throw new Error('Session is controlled remotely')
      return this.getAgent(projectPath).setSandboxMode(mode)
    })

    ipcMain.handle(AgentIpcChannels.ANSWER_QUESTION, (_event, projectPath: string, requestId: string, answers: Record<string, string>, annotations?: QuestionAnnotations) => {
      if (this.isRemoteLockedSession(projectPath)) throw new Error('Session is controlled remotely')
      trace('agent.emit', 'question_answered', { requestId, answers })
      this.getAgent(projectPath).respondToQuestion(requestId, answers, annotations)
    })

    ipcMain.handle(AgentIpcChannels.DISMISS_QUESTION, (_event, projectPath: string, requestId: string) => {
      if (this.isRemoteLockedSession(projectPath)) throw new Error('Session is controlled remotely')
      trace('agent.emit', 'question_dismissed', { requestId })
      this.getAgent(projectPath).dismissQuestion(requestId)
    })

    ipcMain.handle(AgentIpcChannels.RESPOND_PLAN_APPROVAL, (_event, projectPath: string, requestId: string, approved: boolean, feedback?: string) => {
      if (this.isRemoteLockedSession(projectPath)) throw new Error('Session is controlled remotely')
      trace('agent.emit', 'plan_approval_responded', { requestId, approved, feedback })
      this.getAgent(projectPath).respondToPlanApproval(requestId, approved, feedback)
    })

    ipcMain.handle(AgentIpcChannels.RESET_SESSION, async (_event, projectPath: string, newDraftSessionId?: string) => {
      const agent = this.getAgent(projectPath)
      const oldSessionId = agent.getSessionId()
      trace('session.lifecycle', 'ipc_resetSession', {
        projectPath,
        oldSessionId: oldSessionId || '(none)',
        newDraftSessionId: newDraftSessionId || '(none)',
        runtimeKeys: [...this.claudeRuntimes.keys()].slice(0, 10),
        pendingRuntimeKeys: [...this.pendingClaudeRuntimes.keys()],
      })
      await agent.resetSession()
      if (newDraftSessionId) {
        agent.updateEventEmitter(this.createEventEmitter(projectPath, newDraftSessionId))
      }
      agent.applyPreferences()
      return { permissionMode: agent.getCurrentPermissionMode(), sandboxInfo: agent.getCurrentSandboxInfo() }
    })

    ipcMain.handle(AgentIpcChannels.REWIND_FILES, async (_event, projectPath: string, userMessageId: string) => {
      return this.getAgent(projectPath).rewindFiles(userMessageId)
    })

    ipcMain.handle(AgentIpcChannels.REWIND_FILES_PREVIEW, async (_event, projectPath: string, userMessageId: string) => {
      return this.getAgent(projectPath).previewRewind(userMessageId)
    })

    ipcMain.handle(AgentIpcChannels.REWIND_CODE_AND_CHAT, async (_event, projectPath: string, userMessageId: string) => {
      return this.getAgent(projectPath).rewindCodeAndChat(userMessageId)
    })

    ipcMain.handle(AgentIpcChannels.REWIND_CONVERSATION, async (_event, projectPath: string) => {
      return this.getAgent(projectPath).rewindConversation()
    })

    ipcMain.handle(AgentIpcChannels.GET_SESSION_ID, (_event, projectPath: string) => {
      return this.getAgent(projectPath).getSessionId()
    })

    ipcMain.handle(AgentIpcChannels.MCP_SERVER_STATUS, async (_event, projectPath: string) => {
      return this.getAgent(projectPath).getMcpServerStatus()
    })

    ipcMain.handle(AgentIpcChannels.GET_CONTEXT_USAGE, async (_event, projectPath: string) => {
      return this.getAgent(projectPath).getContextUsage()
    })

    ipcMain.handle(AgentIpcChannels.PLUGINS_RELOAD, async (_event, projectPath: string) => {
      return this.getAgent(projectPath).reloadPlugins()
    })

    ipcMain.handle(AgentIpcChannels.LIST_DIRECTORY, async (_event, projectPath: string, relativePath: string) => {
      return this.getAgent(projectPath).listDirectory(relativePath)
    })

    ipcMain.handle(AgentIpcChannels.FIND_LINE_NUMBER, async (_event, projectPath: string, filePath: string, text: string) => {
      return this.getAgent(projectPath).findLineNumber(filePath, text)
    })

    ipcMain.handle(AgentIpcChannels.SEARCH_FILES, async (_event, projectPath: string, query: string, additionalDirs?: string[]) => {
      const agent = this.agents.get(projectPath)
      const cwd = agent?.getCwd() ?? projectPath
      const roots = [cwd, ...(additionalDirs || [])]
      return searchFiles(roots, query, 20)
    })

    ipcMain.handle(AgentIpcChannels.SEARCH_MENTIONS, async (_event, projectPath: string, query: string, agents: AgentEntry[], additionalDirs?: string[], scopeDir?: string) => {
      const agent = this.agents.get(projectPath)
      const cwd = agent?.getCwd() ?? projectPath
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
        const sid = this.remoteSession.agent.getSessionId()
        if (sid) {
          if (!sub || sub.sessionId !== sid) {
            await this.remoteControlService?.sendEventToMobile({ type: 'session_disconnected', sessionId: sid })
          }
          this.broadcastEventToRenderer({ type: 'remote_session_end', remoteProjectPath: this.remoteSession.projectPath, remoteSessionId: sid })
        }
        await this.remoteSession.agent.dispose()
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
      try { await this.getAgent(projectPath).refreshSession() } catch (err) { log.debug('[agent] refreshSession skipped:', err) }
    })

    ipcMain.handle(AgentIpcChannels.PLUGINS_UPDATE, async (_event, projectPath: string, updates: Array<{ key: string; scope: ResourceScope }>) => {
      for (const { key, scope } of updates) {
        updatePlugin(key, scope, projectPath)
      }
      try { await this.getAgent(projectPath).refreshSession() } catch (err) { log.debug('[agent] refreshSession skipped:', err) }
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
      try {
        await this.getAgent(projectPath).reconnectMcpServer(name)
        await this.getAgent(projectPath).refreshSession()
      } catch (err) { log.debug('[agent] MCP save refreshSession skipped:', err) }
    })

    ipcMain.handle(AgentIpcChannels.MCP_DELETE_CONFIG, async (_event, projectPath: string, name: string, scope: ResourceScope) => {
      deleteMcpConfig(name, scope, projectPath)
      try {
        await this.getAgent(projectPath).toggleMcpServer(name, false)
        await this.getAgent(projectPath).refreshSession()
      } catch (err) { log.debug('[agent] MCP delete refreshSession skipped:', err) }
    })

    ipcMain.handle(AgentIpcChannels.MCP_TOGGLE_CONFIG, async (_event, projectPath: string, name: string, disabled: boolean, scope: ResourceScope) => {
      if (scope !== 'claudeai') toggleMcpConfig(name, disabled, scope, projectPath)
      try {
        await this.getAgent(projectPath).toggleMcpServer(name, !disabled)
        await this.getAgent(projectPath).refreshSession()
      } catch (err) { log.debug('[agent] MCP toggle refreshSession skipped:', err) }
    })

    ipcMain.handle(AgentIpcChannels.MCP_CHECK_SERVERS, async (_event, projectPath: string) => {
      const configs = listMcpConfigs(projectPath)
      const result = await checkMcpServers(configs)
      try {
        const sdkStatus = await this.getAgent(projectPath).getMcpServerStatus()
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
      log.info('[providers] activate id=%s agentType=%s agents=%d', id, agentType, this.agents.size)
      const result = activateProvider(id, agentType)
      this.markAllNeedsRebuild()
      log.info('[providers] activate done, all agents marked for rebuild')
      return result
    })

    ipcMain.handle(AgentIpcChannels.PROVIDERS_DEACTIVATE_ALL, (_event, agentType: string) => {
      log.info('[providers] deactivate all, agentType=%s agents=%d', agentType, this.agents.size)
      deactivateAllProviders(agentType)
      this.markAllNeedsRebuild()
      log.info('[providers] deactivate done, all agents marked for rebuild')
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
        const cliPath = resolveSdkCli()
        const runtime = getNodeRuntime()
        const mergedEnv = { ...process.env, ...runtime.env, ...env }
        trace('providers.test', 'options', {
          cliPath: cliPath ?? 'none',
          cliExists: cliPath ? existsSync(cliPath) : false,
          executable: runtime.executable ?? 'none',
          cwd: process.cwd(),
          envKeys: Object.keys(mergedEnv),
        })
        const q = testQuery({
          prompt: 'Reply with "ok" only.',
          options: {
            pathToClaudeCodeExecutable: cliPath,
            executable: runtime.executable as any,
            env: mergedEnv,
            cwd: process.cwd(),
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

    ipcMain.handle(AgentIpcChannels.SESSIONS_RESUME, async (_event, projectPath: string, sessionId: string, worktreeCwd?: string, permissionMode?: PermissionMode) => {
      await this.resumeSession(projectPath, sessionId, worktreeCwd, permissionMode)
    })

    ipcMain.handle(AgentIpcChannels.PARK_SESSION, async (_event, projectPath: string, draftSessionId?: string, newDraftSessionId?: string) => {
      if (this.isRemoteLockedSession(projectPath)) throw new Error('Session is controlled remotely')
      const current = this.agents.get(projectPath)
      if (current && draftSessionId) {
        current.updateEventEmitter(this.createEventEmitter(projectPath, draftSessionId))
      }
      const pendingRuntimeKey = draftSessionId && this.pendingClaudeRuntimes.has(draftSessionId)
        ? draftSessionId
        : this.pendingClaudeRuntimes.has(projectPath)
          ? projectPath
          : null
      const pendingRuntime = pendingRuntimeKey ? this.pendingClaudeRuntimes.get(pendingRuntimeKey) : null
      if (pendingRuntime && current) {
        const sid = current.getSessionId()
        if (sid) {
          const runtime = this.loadOrCreateClaudeRuntime(projectPath, sid)
          this.claudeRuntimes.set(sid, mergeClaudeRuntimes(runtime, { ...pendingRuntime, sessionId: sid }))
        } else if (draftSessionId) {
          this.parkedPendingRuntimes.set(draftSessionId, pendingRuntime)
        }
        this.pendingClaudeRuntimes.delete(pendingRuntimeKey!)
      }
      await this.parkSession(projectPath)
      const agent = new ClaudeAgent()
      await agent.initialize({ cwd: projectPath }, this.createEventEmitter(projectPath, newDraftSessionId))
      this.agents.set(projectPath, agent)
      return { permissionMode: agent.getCurrentPermissionMode(), sandboxInfo: agent.getCurrentSandboxInfo() }
    })

    ipcMain.handle(AgentIpcChannels.ACTIVATE_SESSION, async (_event, projectPath: string, sessionId: string) => {
      await this.activateSession(projectPath, sessionId)
    })

    ipcMain.handle(AgentIpcChannels.SESSIONS_LOAD_MESSAGES, (_event, projectPath: string, sessionId: string, limit: number, cursor?: number) => {
      return loadSessionMessages(projectPath, sessionId, limit, cursor)
    })

    ipcMain.handle(AgentIpcChannels.SESSIONS_RENAME, (_event, sessionId: string, title: string) => {
      dbRenameSession(sessionId, title)
    })

    ipcMain.handle(AgentIpcChannels.SESSIONS_CREATE, (_event, projectPath: string, claudeSessionId: string, isWorktree?: boolean, gitBranch?: string, worktreePath?: string, title?: string) => {
      try {
        createSession(projectPath, claudeSessionId, title, isWorktree, gitBranch, worktreePath)
        this.mainWindow && !this.mainWindow.isDestroyed() && this.mainWindow.webContents.send(AgentIpcChannels.SESSIONS_CHANGED)
      } catch { /* ignore duplicate */ }
    })

    ipcMain.handle(AgentIpcChannels.SESSIONS_SAVE_STATE, (_event, claudeSessionId: string, data: { messages: unknown[]; totalCostUsd: number; contextTokens: number; title?: string; provider?: string }) => {
      saveSessionState(claudeSessionId, data as Parameters<typeof saveSessionState>[1])
    })

    ipcMain.handle(AgentIpcChannels.SESSIONS_LOAD_STATE, (_event, claudeSessionId: string) => {
      return this.getClaudeRuntimeSnapshot(claudeSessionId) ?? this.getCodexRuntimeSnapshot(claudeSessionId) ?? loadSessionState(claudeSessionId)
    })

    ipcMain.handle(AgentIpcChannels.SESSIONS_DELETE, (_event, claudeSessionId: string) => {
      this.claudeRuntimes.delete(claudeSessionId)
      this.notifiedClaudeSessions.delete(claudeSessionId)
      this.codexRuntimes.delete(claudeSessionId)
      this.notifiedCodexSessions.delete(claudeSessionId)
      dbDeleteSession(claudeSessionId)
      this.mainWindow && !this.mainWindow.isDestroyed() && this.mainWindow.webContents.send(AgentIpcChannels.SESSIONS_CHANGED)
    })

    ipcMain.handle(AgentIpcChannels.SESSIONS_DELETE_OLDER, (_event, folderPath: string, cutoffDate: string) => {
      const deleted = dbDeleteSessionsOlderThan(folderPath, cutoffDate)
      if (deleted.length > 0) {
        this.mainWindow && !this.mainWindow.isDestroyed() && this.mainWindow.webContents.send(AgentIpcChannels.SESSIONS_CHANGED)
      }
      return deleted
    })

    ipcMain.handle(AgentIpcChannels.SESSIONS_PIN, (_event, claudeSessionId: string, pinned: boolean) => {
      dbPinSession(claudeSessionId, pinned)
    })

    ipcMain.handle(AgentIpcChannels.SESSIONS_HIDE, (_event, claudeSessionId: string, hidden: boolean) => {
      dbHideSession(claudeSessionId, hidden)
    })

    ipcMain.handle(AgentIpcChannels.SESSIONS_LIST_PINNED, () => {
      return listPinnedSessions()
    })
  }

  /** Dispose the current agent for projectPath and recreate it with a new cwd.
   *  The agent is still keyed by projectPath, and events are tagged with projectPath. */
  async switchCwd(projectPath: string, newCwd: string): Promise<void> {
    await this.replaceAgent(projectPath, newCwd)
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

    if (this.remoteSession?.projectPath === cwd) {
      const sid = this.remoteSession.agent.getSessionId()
      if (sid) this.broadcastEventToRenderer({ type: 'remote_session_end', remoteProjectPath: cwd, remoteSessionId: sid })
      await this.remoteSession.agent.dispose()
      this.remoteSession = null
      this.remoteControlService?.clearRemoteSessionFilter()
    }
  }

  async transferRemoteToLocal(projectPath: string, sessionId: string): Promise<void> {
    if (!this.remoteSession || this.remoteSession.projectPath !== projectPath) return
    const agent = this.remoteSession.agent
    this.remoteSession = null
    this.remoteControlService?.clearRemoteSessionFilter()
    this.broadcastEventToRenderer({ type: 'remote_session_end', remoteProjectPath: projectPath, remoteSessionId: sessionId })
    if (agent instanceof ClaudeAgent) {
      const existing = this.agents.get(projectPath)
      if (existing) {
        if (existing.isStreaming()) await this.parkSession(projectPath)
        else { await existing.dispose(); this.agents.delete(projectPath) }
      }
      agent.updateEventEmitter(this.createEventEmitter(projectPath))
      this.agents.set(projectPath, agent)
    } else {
      await agent.dispose()
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

    if (this.remoteSession) {
      const sid = this.remoteSession.agent.getSessionId()
      if (sid) this.broadcastEventToRenderer({ type: 'remote_session_end', remoteProjectPath: this.remoteSession.projectPath, remoteSessionId: sid })
      await this.remoteSession.agent.dispose()
      this.remoteSession = null
      this.remoteControlService?.clearRemoteSessionFilter()
    }

    ipcMain.removeHandler(AgentIpcChannels.SEND_MESSAGE)
    ipcMain.removeHandler(AgentIpcChannels.DEQUEUE_MESSAGE)
    ipcMain.removeHandler(AgentIpcChannels.INTERRUPT)
    ipcMain.removeHandler(AgentIpcChannels.PERMISSION_RESPONSE)
    ipcMain.removeHandler(AgentIpcChannels.SET_PERMISSION_MODE)
    ipcMain.removeHandler(AgentIpcChannels.SET_SANDBOX_MODE)
    ipcMain.removeHandler(AgentIpcChannels.ANSWER_QUESTION)
    ipcMain.removeHandler(AgentIpcChannels.DISMISS_QUESTION)
    ipcMain.removeHandler(AgentIpcChannels.RESPOND_PLAN_APPROVAL)
    ipcMain.removeHandler(AgentIpcChannels.RESET_SESSION)
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
    ipcMain.removeHandler(AgentIpcChannels.PARK_SESSION)
    ipcMain.removeHandler(AgentIpcChannels.ACTIVATE_SESSION)
    ipcMain.removeHandler(AgentIpcChannels.SESSIONS_LIST)
    ipcMain.removeHandler(AgentIpcChannels.SESSIONS_LIST_FOR_FOLDER)
    ipcMain.removeHandler(AgentIpcChannels.SESSIONS_LIST_FOR_FOLDER_PAGE)
    ipcMain.removeHandler(AgentIpcChannels.SESSIONS_RESUME)
    ipcMain.removeHandler(AgentIpcChannels.SESSIONS_LOAD_MESSAGES)
    ipcMain.removeHandler(AgentIpcChannels.SESSIONS_RENAME)
    ipcMain.removeHandler(AgentIpcChannels.SESSIONS_CREATE)
    ipcMain.removeHandler(AgentIpcChannels.SESSIONS_SAVE_STATE)
    ipcMain.removeHandler(AgentIpcChannels.SESSIONS_LOAD_STATE)
    ipcMain.removeHandler(AgentIpcChannels.SESSIONS_DELETE)
    ipcMain.removeHandler(AgentIpcChannels.SESSIONS_DELETE_OLDER)
    ipcMain.removeHandler(AgentIpcChannels.SESSIONS_PIN)
    ipcMain.removeHandler(AgentIpcChannels.SESSIONS_HIDE)
    ipcMain.removeHandler(AgentIpcChannels.SESSIONS_LIST_PINNED)
  }
}
