import { randomUUID } from 'crypto'
import { execFileSync } from 'child_process'
import { statSync } from 'fs'
import log from '../logger'
import { gitRun } from '../git-run'
import { resolve, join, basename, dirname, sep } from 'path'
import { ipcMain, type BrowserWindow } from 'electron'
import { addProjectAdditionalDir, readScopedAdditionalDirs, removeProjectAdditionalDir } from './project-additional-dirs'
import { WarmupManager } from './warmup-manager'
import { fetchModels } from './claude-models'
import { AgentIpcChannels, type AgentEvent, type AgentPrewarmHint, type CodexCollaborationMode, type CodexPermissionPreset, type CodexReasoningEffort, type ModelOption, type PermissionMode, type QuestionAnnotations, type RemoteCommand, type ResourceScope, type SandboxMode, type SendMessageRequest, type TerminalEvent } from '@superone/shared/agent-types'
import type { RemoteControlService, RemoteResponder } from '../remote-control-service'
import { stripMessagesForRemote, stripEventForRemote } from '../remote-control-service'
import { trace } from './event-trace'
import { getRecentFolders, addRecentFolder } from '../recent-folders'
import { readdir, mkdir } from 'fs/promises'
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { getDb, getCachedHarnessResources } from '../database'
import { resolveTestApiKey } from './provider-test-key'
import { buildRemoteActiveService, resolveChatService } from '../providers/resolver'
import { getPlatforms } from '../providers/registry'
import { testServiceEndpoints } from '../providers/endpoint-test'
import { discoverModels } from '../providers/model-discovery'
import {
  createCredential,
  deleteBinding,
  deleteCredential,
  deleteCustomPlatform,
  listBindings,
  listCredentials,
  setBinding,
  updateCredential,
  upsertCustomPlatform,
  type CreateCredentialInput,
  type UpdateCredentialInput,
} from '../providers/credential-store'
import type { CapabilityTask, ConsumerBinding, ConsumerId, Platform, ServiceEndpoint } from '@superone/shared/platform-registry'
import { sanitizeGitRef } from '../path-security'
import { authorizeAndStat, FileBridgeError, type AuthorizedFile } from '../file-bridge'
import { tmpdir } from 'os'
import { app } from 'electron'
import { activateWorktree, getCheckedOutBranches, getWorktreeInfo, gitErrorMessage } from '../git/worktree-ops'
import { coerceSandboxModeForCapability, getSandboxCapability } from '../sandbox-platform'
import { searchFiles, searchMentions, EXCLUDED_DIRS, type AgentEntry } from './fuzzy-file-search'
import { SessionClaimConflictError, SessionLockedError } from '../session/types'
import { installAcpRecapFocus } from '../acp/acp-recap-focus'

/** Resolve a path to its git common directory (shared across worktrees). */
function getGitRoot(cwd: string): string {
  try {
    // Synchronous on the main thread — a git that never returns would freeze
    // the whole app, so this one is capped.
    const raw = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd, encoding: 'utf-8', timeout: 5000 }).trim()
    // --git-common-dir returns relative or absolute; resolve relative to cwd
    return resolve(cwd, raw)
  } catch {
    return cwd // Fallback: not a git repo, use path itself
  }
}
import { listSessionsForFolder, createSession, createAutomationSession, renameSession as dbRenameSession, saveSessionState, loadSessionState, loadSessionMessagesPaginated, sessionBelongsToProject, deleteSession as dbDeleteSession, deleteSessionsOlderThan as dbDeleteSessionsOlderThan, pinSession as dbPinSession, hideSession as dbHideSession, listPinnedSessions } from '../db-sessions'
import { loadSessionMessages } from '../session-history'
import { listMcpConfigs, saveMcpConfig, deleteMcpConfig, toggleMcpConfig } from '../mcp-config-service'
import { listHooks, saveHook, deleteHook } from '../hooks-config-service'
import { checkMcpServers, readMcpMetaCache } from '../mcp-probe-service'
import { authorizeHttpMcpServer } from '../mcp-oauth'
import { listSkills, readSkillContent, readSkillFile, installSkill, deleteSkill, readCodexSkillContent, readCodexSkillFile, deleteCodexSkill } from '../skills-service'
import { getSharedCodexSkillsService } from '../codex/codex-skills-rpc-singleton'
import { readAppSettings, saveAppSettings } from '../app-settings-service'
import { listCodexMcpConfigs } from '../codex-config-service'
import { discoverAllAgents, discoverProjectCommands, readAgentFile } from './discover-resources'
import { listPlugins, readPluginContent, readPluginFile, deletePlugin, listMarketplacePlugins, installPlugin, updatePlugin, updateMarketplace, addMarketplace, removeMarketplace, readMarketplacePluginContent, readMarketplacePluginFile, getGithubStars, listGithubReposForOwner, listMyGithubRepos } from '../plugins-service'
import { cacheRemoteImage } from '../image-cache'
import { resolveFavicon, cacheCapturedFavicon } from '../favicon'
import { backupMcpServers, listLibrary, deleteLibraryEntry, getLibraryEntry } from '../mcp-library-service'
import { uninstallMcpbBundle } from '../mcpb/mcpb-installer'
import type { HookSavePayload, SessionForkRequest, HarnessId } from '@superone/shared/agent-types'
import { forkSession } from '../session/session-fork'

export class AgentService {
  private mainWindow: BrowserWindow | null = null
  private sessionManager: import('../session/session-manager').SessionManagerImpl | null = null
  private eventSubscribers: Array<(event: AgentEvent) => void> = []
  private codexListModels?: (projectPath: string) => Promise<ModelOption[]>
  private codexGetAuthStatus?: (projectPath: string) => unknown
  private codexProviderChanged?: (invalidateModelCache?: boolean) => void
  private remoteControlService?: RemoteControlService
  private mobileReceiveService?: import('../remote/mobile-receive-service').MobileReceiveService
  private deviceRegistry?: import('../remote/device-registry').DeviceRegistry
  private terminalManager?: import('../terminal/terminal-manager').TerminalManager
  private warmupManager = new WarmupManager()

  setCodexListModels(fn: (projectPath: string) => Promise<ModelOption[]>): void {
    this.codexListModels = fn
  }

  setCodexProviderChanged(fn: (invalidateModelCache?: boolean) => void): void {
    this.codexProviderChanged = fn
  }

  setCodexGetAuthStatus(fn: (projectPath: string) => unknown): void {
    this.codexGetAuthStatus = fn
  }

  setRemoteControlService(svc: RemoteControlService): void {
    this.remoteControlService = svc
  }

  setMobileReceiveService(svc: import('../remote/mobile-receive-service').MobileReceiveService): void {
    this.mobileReceiveService = svc
  }

  setDeviceRegistry(reg: import('../remote/device-registry').DeviceRegistry): void {
    this.deviceRegistry = reg
  }

  setTerminalManager(mgr: import('../terminal/terminal-manager').TerminalManager): void {
    this.terminalManager = mgr
  }

  setBroadcastFn(fn: (event: AgentEvent) => void): void {
    this.broadcastFn = fn
  }

  private broadcastFn: ((event: AgentEvent) => void) | null = null

  private broadcastEventToRenderer(event: AgentEvent): void {
    trace('remote.debug', 'broadcastEventToRenderer', { type: event.type, projectPath: event.projectPath, sessionId: event.sessionId, messageId: 'messageId' in event ? event.messageId : undefined })
    if (event.type === 'permission_request') {
      const alive = !!this.mainWindow && !this.mainWindow.isDestroyed()
      log.info('[broadcast] permission_request requestId=%s toolName=%s sessionId=%s projectPath=%s windowAlive=%s',
        event.request.requestId, event.request.toolName, event.sessionId ?? '(none)', event.projectPath ?? '(none)', alive)
    }
    if (this.broadcastFn) {
      this.broadcastFn(event)
      return
    }
    this.mainWindow && !this.mainWindow.isDestroyed() && this.mainWindow.webContents.send(AgentIpcChannels.EVENT, event)
  }

  private isRemoteLockedSession(projectPath: string): boolean {
    const activeSession = this.sessionManager?.getActiveSession(projectPath)
    if (!activeSession) return false
    if (activeSession.owner.kind === 'remote') return true
    if (activeSession.subscribers.size > 0) return true
    return false
  }

  private throwIfRemoteLocked(projectPath: string): void {
    const activeSession = this.sessionManager?.getActiveSession(projectPath)
    if (!activeSession) return
    if (activeSession.owner.kind === 'remote') {
      throw new SessionLockedError(activeSession.id, 'remote-owned', activeSession.owner.deviceId)
    }
    if (activeSession.subscribers.size > 0) {
      throw new SessionLockedError(activeSession.id, 'remote-subscribed')
    }
  }

  private resolveRemoteProjectPath(commandPath: string | undefined, sessionId: string): string | null {
    if (commandPath) return commandPath
    const session = this.sessionManager?.getSession(sessionId)
    return session?.projectPath ?? null
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

  /**
   * Spawn an automation-owned session via SessionManager and send the prompt.
   * Works for every harness (claude / codex / acp / opencode) through providerId `*-base`.
   */
  async runAutomationSession(projectPath: string, options: {
    content: string
    agentConfig: import('@superone/shared/agent-types').AgentRunConfig
    automationId?: string
    automationName?: string
  }): Promise<{ sessionId: string }> {
    const mgr = this.requireSessionManager()
    const cfg = options.agentConfig
    const harnessId = cfg.type
    const providerId = `${harnessId}-base`
    const sessionId = harnessId === 'codex' ? `codex-auto-${Date.now()}` : randomUUID()
    const title = `[Auto] ${options.automationName ?? 'Automation'}`

    if (options.automationId) {
      try {
        createAutomationSession(projectPath, sessionId, title, options.automationId, harnessId)
      } catch { /* ignore — session row may already exist on retry */ }
    }

    const model = 'model' in cfg ? cfg.model : undefined
    const effort = (
      cfg.type === 'codex'
        ? (cfg.effort ?? cfg.reasoningEffort)
        : 'effort' in cfg
          ? cfg.effort
          : undefined
    ) as SendMessageRequest['effort'] | undefined

    let permissionMode: PermissionMode | undefined
    let sandboxMode: SandboxMode | undefined
    let permissionPreset: CodexPermissionPreset | undefined
    let apiProviderId: string | null | undefined
    let acpAgentId: string | null | undefined

    if (cfg.type === 'claude') {
      permissionMode = cfg.permissionMode ?? 'bypassPermissions'
      sandboxMode = cfg.sandboxMode ?? 'off'
      apiProviderId = cfg.apiProviderId
    } else if (cfg.type === 'codex') {
      permissionPreset = cfg.permissionPreset
        ?? (cfg.permissionMode === 'bypassPermissions' || cfg.permissionMode === 'acceptEdits'
          ? 'full-access'
          : cfg.permissionMode
            ? 'default'
            : 'full-access')
      permissionMode = cfg.permissionMode
        ?? (permissionPreset === 'full-access' ? 'bypassPermissions' : 'default')
      apiProviderId = cfg.apiProviderId
    } else if (cfg.type === 'acp') {
      permissionMode = cfg.permissionMode ?? 'bypassPermissions'
      acpAgentId = cfg.acpAgentId ?? null
      apiProviderId = cfg.apiProviderId
    } else {
      permissionMode = cfg.permissionMode ?? 'bypassPermissions'
      apiProviderId = cfg.apiProviderId
    }

    const session = mgr.createSession({
      projectPath,
      providerId,
      id: sessionId,
      model,
      effort,
      permissionMode,
      sandboxMode,
      apiProviderId: apiProviderId ?? null,
      acpAgentId: acpAgentId ?? null,
    })

    const clientMessageId = `auto_${Date.now()}`
    if (cfg.type === 'codex') {
      await session.send({
        content: options.content,
        clientMessageId,
        assistantMessageId: `auto-${Date.now()}`,
        model,
        effort,
        codex: {
          permissionPreset,
          reasoningEffort: effort as CodexReasoningEffort | undefined,
        },
      })
    } else {
      await session.send({
        content: options.content,
        model,
        effort,
        clientMessageId,
      })
    }

    return { sessionId }
  }

  /** @deprecated Prefer runAutomationSession with agentConfig — kept for callers mid-migration. */
  async runCodexAutomationSession(projectPath: string, options: {
    content: string
    model?: string
    reasoningEffort?: string
    permissionPreset?: string
    automationId?: string
    automationName?: string
  }): Promise<{ sessionId: string }> {
    return this.runAutomationSession(projectPath, {
      content: options.content,
      automationId: options.automationId,
      automationName: options.automationName,
      agentConfig: {
        type: 'codex',
        model: options.model,
        effort: options.reasoningEffort,
        reasoningEffort: options.reasoningEffort as CodexReasoningEffort | undefined,
        permissionPreset: options.permissionPreset as CodexPermissionPreset | undefined,
      },
    })
  }

  notifyEventSubscribers(event: AgentEvent): void {
    this.eventSubscribers.forEach((cb) => cb(event))
  }

  private broadcastProviderChanged(harnessId: 'claude' | 'codex'): void {
    const provider = buildRemoteActiveService(resolveChatService(harnessId, null, {
      experimentalClaudeOpenAiChatEnabled: readAppSettings().experimentalClaudeOpenAiChatEnabled,
    }), harnessId)
    const event: AgentEvent = { type: 'provider_changed', harnessId, provider }
    this.notifyEventSubscribers(event)
    this.broadcastEventToRenderer(event)
  }

  /**
   * Index the cached models.dev catalog by bare model id so relay model discovery can classify a
   * plain OpenAI-compatible `/v1/models` id (no `supported_endpoint_types`) instead of defaulting
   * every id to chat. Never throws — a catalog miss just falls back to the old chat-only default.
   */
  private async buildDiscoveryCatalogIndex(): Promise<Map<string, CapabilityTask[]> | undefined> {
    try {
      const { getModelCatalog } = await import('../model-catalog')
      const { buildCatalogTaskIndex } = await import('@superone/shared/platform-registry')
      return buildCatalogTaskIndex(await getModelCatalog())
    } catch (err) {
      log.warn('[discover-models] catalog index unavailable:', err)
      return undefined
    }
  }

  /** A credential/platform change can affect either harness — rebuild and re-broadcast both. */
  private broadcastProviderConfigChanged(): void {
    this.markAllNeedsRebuild()
    this.codexProviderChanged?.()
    this.broadcastProviderChanged('claude')
    this.broadcastProviderChanged('codex')
  }

  private validateAddDirCandidate(
    projectPath: string,
    candidate: string,
  ): { ok: true } | { ok: false; reason: 'not-found' | 'not-directory' | 'same-as-project' | 'same-repo' } {
    const cwd = this.sessionManager?.getActiveSession(projectPath)?.snapshot.cwd ?? projectPath
    if (!existsSync(candidate)) return { ok: false, reason: 'not-found' }
    try {
      if (!statSync(candidate).isDirectory()) return { ok: false, reason: 'not-directory' }
    } catch {
      return { ok: false, reason: 'not-found' }
    }
    const candidateResolved = resolve(candidate)
    const cwdResolved = resolve(cwd)
    const projectResolved = resolve(projectPath)
    if (candidateResolved === cwdResolved || candidateResolved === projectResolved) {
      return { ok: false, reason: 'same-as-project' }
    }
    const projectGitRoot = getGitRoot(cwdResolved)
    const candidateGitRoot = getGitRoot(candidateResolved)
    if (projectGitRoot === candidateGitRoot && projectGitRoot !== cwdResolved && projectGitRoot !== candidateResolved) {
      return { ok: false, reason: 'same-repo' }
    }
    return { ok: true }
  }

  private listDirectoryForAddDir(
    projectPath: string,
    rawInput: string,
  ): { absolutePath: string; entries: Array<{ name: string; isDirectory: boolean }> } {
    const cwd = this.sessionManager?.getActiveSession(projectPath)?.snapshot.cwd ?? projectPath
    const expanded = rawInput.startsWith('~') ? join(homedir(), rawInput.slice(1)) : rawInput
    const target = resolve(cwd, expanded || '.')
    if (!existsSync(target)) return { absolutePath: target, entries: [] }
    try {
      if (!statSync(target).isDirectory()) return { absolutePath: target, entries: [] }
      const entries = readdirSync(target, { withFileTypes: true })
      const result: Array<{ name: string; isDirectory: boolean }> = []
      for (const entry of entries) {
        if (EXCLUDED_DIRS.has(entry.name)) continue
        result.push({ name: entry.name, isDirectory: entry.isDirectory() })
      }
      result.sort((a, b) => (a.isDirectory !== b.isDirectory ? (a.isDirectory ? -1 : 1) : a.name.localeCompare(b.name)))
      return { absolutePath: target, entries: result }
    } catch {
      return { absolutePath: target, entries: [] }
    }
  }

  private emitAdditionalDirsChanged(projectPath: string, sessionId?: string): void {
    const scoped = readScopedAdditionalDirs(projectPath)
    const targetSession = sessionId ? this.sessionManager?.getSession(sessionId) : this.sessionManager?.getActiveSession(projectPath)
    const sessionDirs = targetSession?.getAdditionalDirectoriesSnapshot() ?? []
    const dedup = Array.from(new Set([...scoped.user, ...scoped.projectShared, ...scoped.projectLocal, ...sessionDirs]))
    const event: AgentEvent = {
      type: 'additional_dirs_changed',
      projectPath,
      sessionId: targetSession?.snapshot.id,
      additionalDirectories: dedup,
      additionalDirsScoped: scoped,
      sessionAdditionalDirs: sessionDirs,
    }
    this.notifyEventSubscribers(event)
    this.broadcastEventToRenderer(event)
  }

  private async ensureRemoteOwnership<T>(
    deviceId: string,
    session: import('../session/types').Session,
    fn: () => Promise<T>,
    opts?: { onClaim?: () => void },
  ): Promise<T> {
    session.claim({ kind: 'remote', deviceId })
    opts?.onClaim?.()
    return fn()
  }

  private async notifySessionLocked(deviceId: string, sessionId: string, currentOwnerDeviceId: string): Promise<void> {
    await this.remoteControlService?.sendEventToMobile(
      { type: 'session_locked_by_other_device', sessionId, ownerDeviceId: currentOwnerDeviceId },
      [deviceId],
    )
  }

  private releaseDeviceFromOtherSessions(deviceId: string, exceptSessionId: string): void {
    this.sessionManager?.forEachSession((s) => {
      if (s.id === exceptSessionId) return
      if (s.owner.kind === 'remote' && s.owner.deviceId === deviceId) s.release(deviceId, 'self_switch')
      if (s.subscribers.has(deviceId)) s.unsubscribe(deviceId, 'self_switch')
    })
  }

  private async runCodexRemoteTurn(projectPath: string, sessionId: string, deviceId: string, command: { content: string; model?: string; effort?: string; permissionPreset?: string; collaborationMode?: string; threadId?: string; images?: SendMessageRequest['images']; gitBranch?: string | null; worktreeBranch?: string | null }, isNewSession?: boolean): Promise<void> {
    const userMessageId = `user_${Date.now()}`
    const assistantMessageId = `remote-${Date.now()}`
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
    try {
      await this.ensureRemoteOwnership(deviceId, session, async () => {
        await session!.send({
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
      }, {
        onClaim: isNewSession
          ? () => {
              this.remoteControlService?.sendAgentEvent({
                type: 'session_init', projectPath, sessionId,
                session: { sessionId, permissionMode: command.permissionPreset ?? 'default' },
              } as AgentEvent, [deviceId])
            }
          : undefined,
      })
    } catch (err) {
      if (err instanceof SessionClaimConflictError) {
        await this.notifySessionLocked(deviceId, sessionId, err.currentOwnerDeviceId)
        return
      }
      throw err
    }
  }

  private async sendTerminalResult(
    deviceId: string,
    requestId: string,
    ok: boolean,
    terminalId?: string,
    code?: 'not_owner' | 'already_claimed' | 'no_terminal',
  ): Promise<void> {
    const event: TerminalEvent = { type: 'terminal_command_result', requestId, ok, terminalId, code }
    await this.remoteControlService?.sendTerminalFrame(event, [deviceId])
  }

  private async sendTerminalSnapshot(
    term: import('../terminal/terminal-session').TerminalSession,
    deviceId: string,
  ): Promise<void> {
    const frames = await term.snapshotFrames(deviceId)
    for (const frame of frames) {
      await this.remoteControlService?.sendTerminalFrame(frame, [deviceId])
    }
  }

  async handleRemoteCommand(command: RemoteCommand, respond?: RemoteResponder, source?: { deviceId: string; transport: 'lan' | 'relay' }): Promise<void> {
    if (!source?.deviceId) {
      log.warn('[AgentService] handleRemoteCommand without source.deviceId for command=%s; using "unknown-device" fallback', command.type)
    }
    const deviceId = source?.deviceId ?? 'unknown-device'
    const cmdStart = Date.now()
    if (command.type === 'list_projects' || command.type === 'get_system_info' || command.type === 'list_sessions' || command.type === 'list_models') {
      log.info('[CONN-DESK] %s start transport=%s deviceId=%s', command.type, source?.transport ?? '?', deviceId)
    }
    trace('remote.cmd', command.type, command)
    switch (command.type) {
      case 'create_session': {
        const { projectPath, sessionId, provider } = command
        if (!projectPath || !sessionId) {
          await respond?.(command.requestId, { ok: false, error: 'projectPath and sessionId required' })
          break
        }
        const mgr = this.requireSessionManager()

        if (provider === 'codex') {
          try {
            mgr.createSession({ projectPath, providerId: 'codex-base', id: sessionId })
            await respond?.(command.requestId, { ok: true, sessionId })
          } catch (err) {
            await respond?.(command.requestId, { ok: false, error: (err as Error).message })
          }
          break
        }

        let cwd = projectPath
        let recordedGitBranch: string | null | undefined = undefined
        try {
          if (command.worktreePath && command.worktreePath !== projectPath) {
            if (!existsSync(command.worktreePath)) {
              await respond?.(command.requestId, { ok: false, error: 'Worktree path not found' })
              break
            }
            cwd = command.worktreePath
            recordedGitBranch = command.gitBranch ?? undefined
          } else if (command.worktreeBranch) {
            const wtMode = command.worktreeMode ?? 'branch'
            const wtBranchName = command.worktreeBranchName ?? (wtMode === 'branch' ? command.worktreeBranch : undefined)
            const result = await activateWorktree(projectPath, {
              baseBranch: command.worktreeBranch,
              mode: wtMode,
              branchName: wtBranchName,
              carryLocalChanges: command.worktreeCarryLocalChanges,
            })
            cwd = result.path
            recordedGitBranch = result.recordedBranch
          } else if (command.gitBranch) {
            try {
              const currentBranch = (await gitRun(projectPath, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
              if (currentBranch !== command.gitBranch) {
                await gitRun(projectPath, ['checkout', sanitizeGitRef(command.gitBranch)])
              }
            } catch { /* branch may already be correct */ }
          }

          mgr.createSession({
            projectPath,
            cwd,
            providerId: 'claude-base',
            id: sessionId,
            ...(recordedGitBranch !== undefined ? { gitBranch: recordedGitBranch } : {}),
            permissionMode: command.permissionMode as PermissionMode | undefined,
            effort: command.effort as SendMessageRequest['effort'] | undefined,
            ...(command.additionalDirectories?.length ? { additionalDirectories: command.additionalDirectories } : {}),
          })
          await respond?.(command.requestId, { ok: true, sessionId, cwd, gitBranch: recordedGitBranch ?? null })
        } catch (err) {
          await respond?.(command.requestId, { ok: false, error: gitErrorMessage(err) })
        }
        break
      }
      case 'send_message': {
        const { projectPath, sessionId } = command
        if (!projectPath || !sessionId) break

        const mgr = this.requireSessionManager()
        if (!this.canAccessSession(projectPath, sessionId)) {
          log.warn('[AgentService] %s', this.buildSessionAccessError(projectPath, sessionId))
          break
        }

        const saved = loadSessionState(sessionId)
        if (command.provider === 'codex' || saved?.provider === 'codex') {
          await this.runCodexRemoteTurn(projectPath, sessionId, deviceId, command)
          break
        }

        let session: import('../session/types').Session
        const existing = mgr.getSession(sessionId)
        if (existing) {
          session = existing
        } else {
          try { session = mgr.resumeSession(sessionId) } catch {
            log.warn('[AgentService] remote send_message: session %s not found', sessionId)
            break
          }
        }

        trace('remote.debug', 'send_message:dispatch', { sid: sessionId, projectPath, deviceId })
        try {
          await this.ensureRemoteOwnership(deviceId, session, async () => {
            await session.send({
              content: command.content,
              model: command.model,
              effort: command.effort as SendMessageRequest['effort'] | undefined,
              images: command.images,
              priority: command.priority,
              clientMessageId: command.clientMessageId,
            }, { providerOrigin: 'remote' })
          })
        } catch (err) {
          if (err instanceof SessionClaimConflictError) {
            await this.notifySessionLocked(deviceId, sessionId, err.currentOwnerDeviceId)
            break
          }
          throw err
        }
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
        if (agent) await agent.interrupt()
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
          this.broadcastEventToRenderer({ type: 'interaction_resolved', interactionType: 'plan_approval', requestId: command.requestId, approved: command.approved, feedback: command.feedback, projectPath, sessionId: command.sessionId })
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
        const reqId = command.requestId
        if (!this.canAccessSession(command.projectPath, command.sessionId)) {
          log.warn('[AgentService] %s', this.buildSessionAccessError(command.projectPath, command.sessionId))
          if (reqId) await respond?.(reqId, { error: this.buildSessionAccessError(command.projectPath, command.sessionId) })
          break
        }
        const mgr = this.sessionManager
        if (!mgr) {
          if (reqId) await respond?.(reqId, { error: 'session_manager_not_ready' })
          break
        }
        let subSession = mgr.getSession(command.sessionId)
        if (!subSession) {
          try {
            subSession = mgr.resumeSession(command.sessionId, { passive: true })
          } catch (err) {
            log.warn('[AgentService] subscribe_session: session %s not found: %s', command.sessionId, err instanceof Error ? err.message : String(err))
            if (reqId) await respond?.(reqId, { error: 'session_not_found' })
            break
          }
        }
        try {
          subSession.subscribe(deviceId)
        } catch (err) {
          if (err instanceof SessionClaimConflictError) {
            if (reqId) {
              await respond?.(reqId, { error: 'session_locked', ownerDeviceId: err.currentOwnerDeviceId })
            } else {
              await this.notifySessionLocked(deviceId, command.sessionId, err.currentOwnerDeviceId)
            }
            break
          }
          throw err
        }
        this.releaseDeviceFromOtherSessions(deviceId, command.sessionId)
        for (const event of subSession.getReplayEvents()) {
          try {
            await this.remoteControlService?.sendAgentEvent(event, [deviceId])
          } catch (err) {
            log.warn('[AgentService] subscribe_session: replay event failed sid=%s type=%s: %s', command.sessionId, event.type, err instanceof Error ? err.message : String(err))
          }
        }
        if (reqId) await respond?.(reqId, { ok: true })
        break
      }
      case 'unsubscribe_session': {
        const targetSessionId = command.sessionId
        if (targetSessionId) {
          const s = this.sessionManager?.getSession(targetSessionId)
          if (s && s.subscribers.has(deviceId)) s.unsubscribe(deviceId, 'self_leave')
        } else {
          this.deviceRegistry?.unsubscribeAll(deviceId, 'self_leave')
        }
        break
      }
      case 'leave_session': {
        const session = this.sessionManager?.getSession(command.sessionId)
        if (!session) break
        if (session.owner.kind === 'remote' && session.owner.deviceId === deviceId) {
          session.release(deviceId, 'self_leave')
        }
        if (session.subscribers.has(deviceId)) session.unsubscribe(deviceId, 'self_leave')
        break
      }
      case 'terminal_create': {
        const mgr = this.terminalManager
        if (!mgr) { await this.sendTerminalResult(deviceId, command.requestId, false, undefined, 'no_terminal'); break }
        const cwd = (command.sessionId ? this.sessionManager?.getSession(command.sessionId)?.cwd : undefined) ?? command.projectPath
        const term = mgr.create({ cwd, title: basename(cwd) || 'Terminal' })
        term.ownership.subscribe(deviceId)
        term.ownership.claim(deviceId)
        await this.sendTerminalResult(deviceId, command.requestId, true, term.terminalId)
        await this.sendTerminalSnapshot(term, deviceId)
        break
      }
      case 'terminal_subscribe': {
        const term = this.terminalManager?.get(command.terminalId)
        if (!term) { await this.sendTerminalResult(deviceId, command.requestId, false, command.terminalId, 'no_terminal'); break }
        term.ownership.subscribe(deviceId)
        await this.sendTerminalResult(deviceId, command.requestId, true, term.terminalId)
        await this.sendTerminalSnapshot(term, deviceId)
        break
      }
      case 'terminal_unsubscribe': {
        if (command.terminalId) {
          const term = this.terminalManager?.get(command.terminalId)
          term?.ownership.handleDeviceDisconnected(deviceId)
        } else {
          for (const item of this.terminalManager?.list() ?? []) {
            this.terminalManager?.get(item.terminalId)?.ownership.handleDeviceDisconnected(deviceId)
          }
        }
        break
      }
      case 'terminal_claim': {
        const term = this.terminalManager?.get(command.terminalId)
        if (!term) { await this.sendTerminalResult(deviceId, command.requestId, false, command.terminalId, 'no_terminal'); break }
        const res = term.ownership.claim(deviceId)
        if (res.ok) await this.sendTerminalResult(deviceId, command.requestId, true, term.terminalId)
        else await this.sendTerminalResult(deviceId, command.requestId, false, term.terminalId, res.code)
        break
      }
      case 'terminal_release': {
        const term = this.terminalManager?.get(command.terminalId)
        term?.ownership.release(deviceId)
        await this.sendTerminalResult(deviceId, command.requestId, true, command.terminalId)
        break
      }
      case 'terminal_input': {
        const term = this.terminalManager?.get(command.terminalId)
        if (!term) break
        if (!term.ownership.isWritableBy(deviceId)) {
          await this.remoteControlService?.sendTerminalFrame(
            { type: 'terminal_error', terminalId: command.terminalId, code: 'not_owner', message: 'Terminal is controlled by another device' },
            [deviceId],
          )
          break
        }
        term.input(command.data)
        break
      }
      case 'terminal_resize': {
        const term = this.terminalManager?.get(command.terminalId)
        if (!term || !term.ownership.isWritableBy(deviceId)) break
        term.resize(command.cols, command.rows)
        break
      }
      case 'terminal_kill': {
        const term = this.terminalManager?.get(command.terminalId)
        if (!term) break
        if (!term.ownership.isWritableBy(deviceId)) {
          await this.remoteControlService?.sendTerminalFrame(
            { type: 'terminal_error', terminalId: command.terminalId, code: 'not_owner', message: 'Only the controlling device can kill this terminal' },
            [deviceId],
          )
          break
        }
        this.terminalManager?.kill(command.terminalId)
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
          const snapshot = session?.snapshot
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
            isWorktree: snapshot?.isWorktree ?? false,
            worktreePath: snapshot?.worktreePath ?? null,
            gitBranch: snapshot?.gitBranch ?? null,
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
        log.info('[CONN-DESK] list_projects done elapsed=%dms count=%d', Date.now() - cmdStart, folders.length)
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
          const cached = getCachedHarnessResources('claude')
          const cachedModels = cached?.models
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
          const { agentPreference } = readAppSettings()
          if (isClaude) {
            const cached = getCachedHarnessResources('claude')
            log.info('[get_system_info] provider=claude hasCached=%s cachedModels=%d projectPath=%s', !!cached, cached?.models?.length ?? 0, command.projectPath)
            const cachedModels = cached?.models
            const fetchStart = Date.now()
            const models = cachedModels?.length ? cachedModels : await fetchModels(command.projectPath)
            log.info('[get_system_info] resolvedModels=%d source=%s modelsElapsed=%dms', models.length, cachedModels?.length ? 'cache' : 'fetch', Date.now() - fetchStart)
            const activeProvider = buildRemoteActiveService(resolveChatService('claude', null, {
              experimentalClaudeOpenAiChatEnabled: readAppSettings().experimentalClaudeOpenAiChatEnabled,
            }), 'claude')
            await respond?.(command.requestId, {
              models,
              userSlashCommands: cached?.slashCommands ?? [],
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
            const cached = getCachedHarnessResources('codex')
            const models = this.codexListModels ? await this.codexListModels(command.projectPath) : []
            const userPrompts = cached?.prompts ?? []
            const activeProvider = buildRemoteActiveService(resolveChatService('codex'), 'codex')
            await respond?.(command.requestId, {
              models,
              slashCommands: [
                { name: 'help', description: 'Show available commands' },
                { name: 'reset', description: 'Reset Codex thread' },
                { name: 'auth', description: 'Show auth status' },
                { name: 'review', description: 'Review code changes' },
                { name: 'compact', description: 'Compact thread context' },
                ...userPrompts.map((p) => ({ name: p.name, description: p.description ?? '', argumentHint: p.argumentHint ?? '' })),
              ],
              account: this.codexGetAuthStatus?.(command.projectPath) ?? null,
              permissionPresets: ['read-only', 'default', 'full-access'],
              activeProvider,
              defaults: {
                model: agentPreference.codex.defaultModel || null,
                reasoningEffort: agentPreference.codex.defaultReasoningEffort || null,
                permissionPreset: agentPreference.codex.defaultPermissionPreset || null,
              },
            })
          }
        } catch (err) {
          log.error('[get_system_info] error: %s', err instanceof Error ? err.message : String(err))
          await respond?.(command.requestId, { error: (err as Error).message })
        }
        log.info('[CONN-DESK] get_system_info done elapsed=%dms', Date.now() - cmdStart)
        break
      }
      case 'get_project_resources': {
        try {
          const isClaude = command.provider !== 'codex'
          if (isClaude) {
            const skills = listSkills(command.projectPath)
            const agents = discoverAllAgents(command.projectPath)
            const projectSlashCommands = discoverProjectCommands(command.projectPath)
            const scoped = readScopedAdditionalDirs(command.projectPath)
            await respond?.(command.requestId, {
              skills: skills.map((s) => ({ name: s.name, description: s.description ?? '', argumentHint: s.argumentHint ?? '' })),
              agents: agents.map((a) => ({ name: a.name, description: a.description ?? '', model: a.model })),
              projectSlashCommands: projectSlashCommands.map((c) => ({ name: c.name, description: c.description ?? '', argumentHint: c.argumentHint ?? '' })),
              additionalDirsScoped: { user: scoped.user, projectShared: scoped.projectShared, projectLocal: scoped.projectLocal },
              cwd: command.projectPath,
              homedir: homedir(),
            })
          } else {
            const skills = await getSharedCodexSkillsService().list(command.projectPath)
            await respond?.(command.requestId, {
              skills: skills.map((s) => ({ name: s.name, description: s.description ?? '', argumentHint: s.argumentHint ?? '' })),
            })
          }
        } catch (err) {
          await respond?.(command.requestId, { error: (err as Error).message })
        }
        break
      }
      case 'get_git_info': {
        try {
          const branch = await gitRun(command.projectPath, ['rev-parse', '--abbrev-ref', 'HEAD'])
            .catch(() => gitRun(command.projectPath, ['symbolic-ref', 'HEAD']).then((r) => r.replace('refs/heads/', '')))
          const status = await gitRun(command.projectPath, ['status', '--porcelain'])
          const files = status ? status.split('\n').filter(Boolean).length : 0
          let insertions = 0
          let deletions = 0
          if (files > 0) {
            try {
              const shortstat = await gitRun(command.projectPath, ['diff', 'HEAD', '--shortstat'])
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
          const raw = await gitRun(command.projectPath, ['branch', '--format=%(refname:short)'])
          await respond?.(command.requestId, { branches: raw.split('\n').filter(Boolean) })
        } catch {
          await respond?.(command.requestId, { branches: [] })
        }
        break
      }
      case 'switch_git_branch': {
        try {
          await gitRun(command.projectPath, ['checkout', sanitizeGitRef(command.branch)])
          await respond?.(command.requestId, { ok: true })
        } catch (err) {
          const stderr = (err as { stderr?: string })?.stderr?.trim()
          await respond?.(command.requestId, { ok: false, error: stderr || (err as Error)?.message || 'Unknown git error' })
        }
        break
      }
      case 'create_git_branch': {
        try {
          await gitRun(command.projectPath, ['rev-parse', '--verify', 'HEAD'])
        } catch {
          await respond?.(command.requestId, { ok: false, error: 'Cannot create branch before the first commit.' })
          break
        }
        try {
          await gitRun(command.projectPath, ['checkout', '-b', sanitizeGitRef(command.branch)])
          await respond?.(command.requestId, { ok: true })
        } catch (err) {
          const stderr = (err as { stderr?: string })?.stderr?.trim()
          await respond?.(command.requestId, { ok: false, error: stderr || (err as Error)?.message || 'Unknown git error' })
        }
        break
      }
      case 'get_worktree_info': {
        const info = await getWorktreeInfo(command.projectPath)
        await respond?.(command.requestId, info ?? { isWorktree: false, currentBranch: '', entries: [] })
        break
      }
      case 'get_checked_out_branches': {
        const branches = await getCheckedOutBranches(command.projectPath)
        await respond?.(command.requestId, { branches })
        break
      }
      case 'activate_worktree': {
        try {
          if (command.baseBranch === null) {
            await this.switchCwd(command.projectPath, command.projectPath, null)
            await respond?.(command.requestId, { ok: true, path: command.projectPath })
            break
          }
          const mode = command.mode ?? 'branch'
          const branchName = command.branchName ?? (mode === 'branch' ? command.baseBranch : undefined)
          const result = await activateWorktree(command.projectPath, {
            baseBranch: command.baseBranch,
            mode,
            branchName,
            carryLocalChanges: command.carryLocalChanges,
          })
          await this.switchCwd(command.projectPath, result.path, result.recordedBranch)
          await respond?.(command.requestId, { ok: true, path: result.path })
        } catch (err) {
          await respond?.(command.requestId, { ok: false, error: gitErrorMessage(err) })
        }
        break
      }
      case 'list_directory_for_add_dir': {
        try {
          const result = this.listDirectoryForAddDir(command.projectPath, command.rawInput)
          await respond?.(command.requestId, result)
        } catch (err) {
          await respond?.(command.requestId, { error: (err as Error).message })
        }
        break
      }
      case 'validate_add_dir': {
        try {
          const result = this.validateAddDirCandidate(command.projectPath, command.candidate)
          await respond?.(command.requestId, result)
        } catch (err) {
          await respond?.(command.requestId, { error: (err as Error).message })
        }
        break
      }
      case 'add_project_additional_dir': {
        try {
          const v = this.validateAddDirCandidate(command.projectPath, command.dir)
          if (!v.ok) {
            await respond?.(command.requestId, v)
            break
          }
          addProjectAdditionalDir(command.projectPath, command.dir)
          this.sessionManager?.invalidateProjectResources(command.projectPath)
          this.emitAdditionalDirsChanged(command.projectPath)
          await respond?.(command.requestId, { ok: true })
        } catch (err) {
          await respond?.(command.requestId, { ok: false, reason: (err as Error).message })
        }
        break
      }
      case 'remove_project_additional_dir': {
        try {
          removeProjectAdditionalDir(command.projectPath, command.dir)
          this.sessionManager?.invalidateProjectResources(command.projectPath)
          this.emitAdditionalDirsChanged(command.projectPath)
          await respond?.(command.requestId, { ok: true })
        } catch (err) {
          await respond?.(command.requestId, { ok: false, reason: (err as Error).message })
        }
        break
      }
      case 'set_session_additional_dirs': {
        try {
          const session = this.sessionManager?.getSession(command.sessionId)
          if (!session) {
            await respond?.(command.requestId, { ok: false, reason: 'session-not-found' })
            break
          }
          await session.dispatchBackendCommand({ kind: 'claude.set_additional_dirs', dirs: command.dirs })
          this.emitAdditionalDirsChanged(command.projectPath, command.sessionId)
          await respond?.(command.requestId, { ok: true })
        } catch (err) {
          await respond?.(command.requestId, { ok: false, reason: (err as Error).message })
        }
        break
      }
      case 'read_desktop_file': {
        await this.handleReadDesktopFile(command, respond, source)
        break
      }
      case 'upload_file': {
        if (!respond) break
        const svc = this.mobileReceiveService
        if (!svc) {
          await respond(command.requestId, { ok: false, error: 'no_transport', message: 'upload service unavailable' })
          break
        }
        const res = await svc.handleUploadFile({
          requestId: command.requestId,
          sessionId: command.sessionId,
          targetDir: command.targetDir,
          name: command.name,
          mimeType: command.mimeType,
          size: command.size,
          inlineBase64: command.inlineBase64,
          transport: source?.transport ?? 'relay',
        })
        await respond(command.requestId, res)
        break
      }
      case 'upload_file_complete': {
        if (!respond) break
        const svc = this.mobileReceiveService
        if (!svc) {
          await respond(command.requestId, { ok: false, error: 'no_transport', message: 'upload service unavailable' })
          break
        }
        const res = await svc.handleUploadComplete({ requestId: command.requestId })
        await respond(command.requestId, res)
        break
      }
      case 'list_providers': {
        try {
          await respond?.(command.requestId, { providers: listCredentials() })
        } catch (err) {
          await respond?.(command.requestId, { error: (err as Error).message })
        }
        break
      }
      case 'set_session_api_provider_id': {
        const session = this.sessionManager?.getSession(command.sessionId)
        if (!session) break
        if (!this.canAccessSession(command.projectPath, command.sessionId)) {
          log.warn('[AgentService] %s', this.buildSessionAccessError(command.projectPath, command.sessionId))
          break
        }
        session.setApiProviderId(command.apiProviderId)
        break
      }
    }
  }

  private async handleReadDesktopFile(
    command: Extract<RemoteCommand, { type: 'read_desktop_file' }>,
    respond?: RemoteResponder,
    source?: { deviceId: string; transport: 'lan' | 'relay' },
  ): Promise<void> {
    if (!respond) return
    let authorized: AuthorizedFile
    try {
      authorized = await authorizeAndStat(command.path, { allowedRoots: [] }, { maxBytes: command.maxBytes, skipRootCheck: true })
    } catch (err) {
      if (err instanceof FileBridgeError) {
        await respond(command.requestId, { ok: false, error: err.code, message: err.message })
      } else {
        await respond(command.requestId, { ok: false, error: 'internal_error', message: (err as Error).message })
      }
      return
    }

    if (command.statOnly) {
      await respond(command.requestId, {
        ok: true,
        statOnly: true,
        mimeType: authorized.mimeType,
        name: authorized.name,
        size: authorized.size,
        modifiedAt: authorized.modifiedAt,
      })
      return
    }

    const transport = source?.transport ?? 'relay'
    const remote = this.remoteControlService
    if (!remote) {
      await respond(command.requestId, { ok: false, error: 'no_transport', message: 'remote control unavailable' })
      return
    }

    try {
      let url: string
      let expiresAt: number
      let encryption: { version: number; format: string; key: string } | undefined
      if (transport === 'lan') {
        const lanUrl = await remote.signLanFileUrl(authorized.realPath, { ttlMs: 60_000 })
        if (!lanUrl) {
          await respond(command.requestId, { ok: false, error: 'no_transport', message: 'LAN file bridge unavailable' })
          return
        }
        url = lanUrl
        expiresAt = Date.now() + 60_000
      } else {
        const result = await remote.uploadFileToRelay(
          authorized.realPath,
          { mimeType: authorized.mimeType, size: authorized.size },
          command.sessionId ?? 'no-session',
        )
        url = result.downloadUrl
        expiresAt = result.expiresAt
        encryption = result.encryption
      }
      await respond(command.requestId, {
        ok: true,
        url,
        mimeType: authorized.mimeType,
        name: authorized.name,
        size: authorized.size,
        modifiedAt: authorized.modifiedAt,
        expiresAt,
        ...(encryption ? { encryption } : {}),
      })
    } catch (err) {
      log.error('[AgentService] read_desktop_file failed:', err)
      await respond(command.requestId, { ok: false, error: 'upload_failed', message: (err as Error).message })
    }
  }

  markAllNeedsRebuild(harnessId?: 'claude' | 'codex'): void {
    this.sessionManager?.markAllNeedsRebuild(harnessId)
  }

  markProjectNeedsRebuild(projectPath: string, harnessId?: 'claude' | 'codex'): void {
    this.sessionManager?.markProjectNeedsRebuild(projectPath, harnessId)
  }

  markSessionNeedsRebuild(sessionId: string, harnessId?: 'claude' | 'codex'): void {
    this.sessionManager?.markSessionNeedsRebuild(sessionId, harnessId)
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
    this.wireComputerUseStop()
    this.wireAcpRecapFocus()
  }

  /**
   * Auto session-recap when a Grok/ACP chat loses session foreground long enough
   * (user switched to another SuperOne session), not whole-app window blur.
   * Synchronous install so setForeground events cannot race a pending dynamic import.
   */
  private wireAcpRecapFocus(): void {
    const mgr = this.sessionManager
    if (!mgr) return
    installAcpRecapFocus({
      requestAutoRecap: async (sessionId) => {
        const session = mgr.getSession(sessionId)
        if (!session?.requestSessionRecap) return false
        return session.requestSessionRecap(true)
      },
    })
    log.info('[agent-service] ACP auto session-recap (per-session focus) installed')
  }

  /**
   * Stop in the Computer Use helper's status menu interrupts the driving turn.
   * macOS-only: the helper is the only thing that emits this event.
   */
  private wireComputerUseStop(): void {
    if (process.platform !== 'darwin') return
    void import('../computer-use/stop-bridge')
      .then(({ wireComputerUseStopBridge }) => {
        wireComputerUseStopBridge((sessionId) => {
          const session = this.sessionManager?.getSession(sessionId)
          if (!session) return
          void session.interrupt()
        })
      })
      .catch((err) => {
        log.debug('[agent-service] computer-use stop bridge unavailable: %s', String(err))
      })
  }

  private requireSessionManager(): import('../session/session-manager').SessionManagerImpl {
    if (!this.sessionManager) throw new Error('SessionManager not injected into AgentService')
    return this.sessionManager
  }

  private baseProviderIdForHarness(harnessId: 'claude' | 'codex' | 'acp' | 'opencode' | undefined): string {
    if (harnessId === 'codex') return 'codex-base'
    if (harnessId === 'acp') return 'acp-base'
    if (harnessId === 'opencode') return 'opencode-base'
    return 'claude-base'
  }

  /**
   * Align a live session's cwd with the renderer's worktree selection.
   * Without this, a prewarmed ACP/Claude process stays bound to the project
   * root after the user switches into a worktree (session/new cwd is sticky).
   */
  private async applyWorktreeCwdHint(
    session: import('../session/types').Session,
    hint?: {
      worktreePath?: string | null
      gitBranch?: string | null
    },
  ): Promise<void> {
    const wt = hint?.worktreePath?.trim()
    if (!wt || !existsSync(wt)) return
    const branch = hint?.gitBranch
    if (session.cwd === wt) {
      if (branch !== undefined && branch !== session.snapshot.gitBranch) {
        await session.switchCwd(wt, branch)
      }
      return
    }
    await session.switchCwd(wt, branch ?? undefined)
  }

  private async getOrCreateActiveSession(
    projectPath: string,
    requestedSid?: string,
    hint?: {
      worktreePath?: string | null
      gitBranch?: string | null
      apiProviderId?: string | null
      provider?: 'claude' | 'codex' | 'acp' | 'opencode'
    },
  ): Promise<import('../session/types').Session> {
    const mgr = this.requireSessionManager()
    const activeCwd = mgr.getActiveSession(projectPath)?.cwd
    const cwd = hint?.worktreePath ?? activeCwd
    const gitBranch = hint?.gitBranch ?? null
    const apiProviderHint = hint?.apiProviderId ?? null
    const providerId = this.baseProviderIdForHarness(hint?.provider)
    const shouldApplyHint = (existing: import('../session/types').Session): boolean =>
      apiProviderHint !== null && existing.snapshot.apiProviderId !== apiProviderHint
    const expectedHarness = hint?.provider
    const prefsFor = (provider: 'claude' | 'codex' | 'acp' | 'opencode' | undefined) =>
      provider === 'claude' || !provider
        ? this.readDefaultSessionPrefs()
        : { permissionMode: undefined as PermissionMode | undefined, sandboxMode: undefined as SandboxMode | undefined }

    if (requestedSid) {
      const existing = mgr.getSession(requestedSid)
      if (existing) {
        // Empty draft may keep one SuperOne sid across harness switches in the
        // renderer — dispose + recreate so send does not ride the old runtime.
        if (
          expectedHarness
          && existing.snapshot.harnessId !== expectedHarness
          && existing.snapshot.messages.length === 0
          && !existing.isStreaming()
        ) {
          await mgr.disposeSession(requestedSid)
          const prefs = prefsFor(expectedHarness)
          return mgr.createSession({
            projectPath,
            cwd,
            providerId,
            id: requestedSid,
            gitBranch,
            permissionMode: prefs.permissionMode,
            sandboxMode: prefs.sandboxMode,
            apiProviderId: apiProviderHint,
          })
        }
        mgr.setActiveSession(projectPath, requestedSid)
        if (shouldApplyHint(existing)) existing.setApiProviderId(apiProviderHint)
        await this.applyWorktreeCwdHint(existing, hint)
        return existing
      }
      try {
        const resumed = mgr.resumeSession(requestedSid)
        if (
          expectedHarness
          && resumed.snapshot.harnessId !== expectedHarness
          && resumed.snapshot.messages.length === 0
          && !resumed.isStreaming()
        ) {
          await mgr.disposeSession(requestedSid)
          const prefs = prefsFor(expectedHarness)
          return mgr.createSession({
            projectPath,
            cwd,
            providerId,
            id: requestedSid,
            gitBranch,
            permissionMode: prefs.permissionMode,
            sandboxMode: prefs.sandboxMode,
            apiProviderId: apiProviderHint,
          })
        }
        if (shouldApplyHint(resumed)) resumed.setApiProviderId(apiProviderHint)
        await this.applyWorktreeCwdHint(resumed, hint)
        return resumed
      } catch {
        const prefs = prefsFor(hint?.provider)
        return mgr.createSession({
          projectPath,
          cwd,
          providerId,
          id: requestedSid,
          gitBranch,
          permissionMode: prefs.permissionMode,
          sandboxMode: prefs.sandboxMode,
          apiProviderId: apiProviderHint,
        })
      }
    }
    const active = mgr.getActiveSession(projectPath)
    if (active) {
      if (shouldApplyHint(active)) active.setApiProviderId(apiProviderHint)
      await this.applyWorktreeCwdHint(active, hint)
      return active
    }
    const prefs = prefsFor(hint?.provider)
    return mgr.createSession({
      projectPath,
      cwd,
      providerId,
      gitBranch,
      permissionMode: prefs.permissionMode,
      sandboxMode: prefs.sandboxMode,
      apiProviderId: apiProviderHint,
    })
  }

  private async getOrCreatePrewarmSession(
    projectPath: string,
    hint?: AgentPrewarmHint,
  ): Promise<import('../session/types').Session | null> {
    const mgr = this.requireSessionManager()
    const providerId = this.baseProviderIdForHarness(hint?.provider)
    const harnessId = hint?.provider ?? 'claude'
    const activeCwd = mgr.getActiveSession(projectPath)?.cwd
    const cwd = hint?.worktreePath ?? activeCwd
    const { permissionMode, sandboxMode } = this.readDefaultSessionPrefs()
    const createOpts = {
      projectPath,
      cwd,
      providerId,
      permissionMode,
      sandboxMode,
      effort: hint?.effort,
      model: hint?.model,
      additionalDirectories: hint?.additionalDirs,
      acpAgentId: hint?.acpAgentId ?? null,
    }
    if (hint?.sessionId) {
      const existing = mgr.getSession(hint.sessionId)
      if (existing) {
        if (existing.snapshot.harnessId === harnessId) {
          mgr.setActiveSession(projectPath, hint.sessionId)
          await this.applyWorktreeCwdHint(existing, {
            worktreePath: hint.worktreePath,
          })
          return existing
        }
        if (existing.snapshot.messages.length > 0 || existing.isStreaming()) {
          log.debug('[agent-service] prewarm skipped sid=%s harness=%s expected=%s', hint.sessionId, existing.snapshot.harnessId, harnessId)
          return null
        }
        await mgr.disposeSession(hint.sessionId)
        // Harness switch on an empty draft: create fresh (do not resume old provider session).
        return mgr.createSession({ ...createOpts, id: hint.sessionId })
      }
      // Session not in memory — resume from DB so provider_session_id is restored for
      // ACP session/load (Grok). createSession alone used to drop that id and force session/new.
      try {
        const resumed = mgr.resumeSession(hint.sessionId, { passive: true })
        if (resumed.snapshot.harnessId === harnessId) {
          mgr.setActiveSession(projectPath, hint.sessionId)
          await this.applyWorktreeCwdHint(resumed, {
            worktreePath: hint.worktreePath,
          })
          log.debug(
            '[agent-service] prewarm resumed sid=%s harness=%s providerSessionId=%s',
            hint.sessionId,
            harnessId,
            resumed.snapshot.providerSessionId ?? '(none)',
          )
          return resumed
        }
        if (resumed.snapshot.messages.length > 0 || resumed.isStreaming()) {
          log.debug(
            '[agent-service] prewarm skipped resumed sid=%s harness=%s expected=%s',
            hint.sessionId,
            resumed.snapshot.harnessId,
            harnessId,
          )
          return null
        }
        await mgr.disposeSession(hint.sessionId)
      } catch {
        // Not in DB yet (true draft) — fall through to create.
      }
      return mgr.createSession({ ...createOpts, id: hint.sessionId })
    }
    const active = mgr.getActiveSession(projectPath)
    if (active?.snapshot.harnessId === harnessId) {
      await this.applyWorktreeCwdHint(active, {
        worktreePath: hint?.worktreePath,
      })
      return active
    }
    return mgr.createSession(createOpts)
  }

  private readDefaultSessionPrefs(): { permissionMode: PermissionMode; sandboxMode: SandboxMode | undefined } {
    const { agentPreference } = readAppSettings()
    const storedSandboxMode = agentPreference.claude.defaultSandboxMode || undefined
    return {
      permissionMode: agentPreference.claude.defaultPermissionMode || 'default',
      sandboxMode: coerceSandboxModeForCapability(storedSandboxMode),
    }
  }

  setup(): void {

    // --- Session-scoped handlers (projectPath as first arg) ---

    ipcMain.handle(AgentIpcChannels.SEND_MESSAGE, async (_event, projectPath: string, request: SendMessageRequest) => {
      this.throwIfRemoteLocked(projectPath)
      const session = await this.getOrCreateActiveSession(projectPath, request.sessionId, {
        worktreePath: request.worktreePath,
        gitBranch: request.gitBranch,
        ...(request.apiProviderId !== undefined ? { apiProviderId: request.apiProviderId } : {}),
        ...(request.provider ? { provider: request.provider } : {}),
      })
      trace('session.lifecycle', 'ipc_sendMessage', {
        projectPath,
        sessionId: session.snapshot.id,
        providerSessionId: session.snapshot.providerSessionId ?? '(none)',
        status: session.snapshot.status,
        cwd: session.cwd,
        worktreePath: request.worktreePath ?? null,
      })
      await session.send(request)
    })

    ipcMain.handle(AgentIpcChannels.DEQUEUE_MESSAGE, (_event, projectPath: string, clientMessageId: string) => {
      const session = this.sessionManager?.getActiveSession(projectPath)
      if (!session) return false
      return session.dequeueMessage(clientMessageId)
    })

    ipcMain.handle(AgentIpcChannels.PREWARM, async (_event, projectPath: string, hint?: AgentPrewarmHint) => {
      if (!this.sessionManager) return
      if (this.isRemoteLockedSession(projectPath)) return
      const session = await this.getOrCreatePrewarmSession(projectPath, hint)
      if (!session) return
      log.debug('[agent-service] prewarm sid=%s harness=%s', session.id, session.snapshot.harnessId)
      try { session.prewarm(hint) } catch (err) { log.debug('[agent-service] prewarm failed: %s', err instanceof Error ? err.message : String(err)) }
    })

    ipcMain.handle(AgentIpcChannels.INTERRUPT, async (_event, sessionId: string) => {
      const session = this.sessionManager?.getSession(sessionId)
      if (!session) return false
      this.throwIfRemoteLocked(session.snapshot.projectPath)
      return session.interrupt()
    })

    ipcMain.handle(AgentIpcChannels.STOP_TASK, async (_event, sessionId: string, taskId: string) => {
      const session = this.sessionManager?.getSession(sessionId)
      if (!session) return false
      this.throwIfRemoteLocked(session.snapshot.projectPath)
      await session.dispatchBackendCommand({ kind: 'claude.stop_task', taskId })
      return true
    })

    ipcMain.handle(AgentIpcChannels.PERMISSION_RESPONSE, (_event, sessionId: string, requestId: string, allow: boolean, alwaysAllow?: boolean, reason?: string, selectedSuggestions?: number[], decision?: 'cancel', formAnswers?: Record<string, unknown>) => {
      const session = this.sessionManager?.getSession(sessionId)
      if (!session) return false
      this.throwIfRemoteLocked(session.snapshot.projectPath)
      trace('agent.emit', 'permission_responded', { requestId, allow, reason, sessionId })
      trace('permission.flow', 'ipc_response', { projectPath: session.snapshot.projectPath, sessionId, allow, alwaysAllow, reason, decision, formAnswers }, requestId)
      const result = session.respondToPermission(requestId, allow, alwaysAllow, reason, selectedSuggestions, decision, formAnswers)
      // Only clear the pending UI when something actually handled the response.
      // Unconditional broadcast used to dismiss config/video confirms on harnesses
      // that did not resolve the host gate, leaving config_apply hung until timeout.
      if (result) {
        this.broadcastEventToRenderer({ type: 'interaction_resolved', interactionType: 'permission', requestId, projectPath: session.snapshot.projectPath, sessionId })
      }
      return result
    })

    ipcMain.handle(AgentIpcChannels.SET_PERMISSION_MODE, async (_event, projectPath: string, mode: PermissionMode) => {
      this.throwIfRemoteLocked(projectPath)
      const session = await this.getOrCreateActiveSession(projectPath)
      trace('permission.flow', 'ipc_setMode', { projectPath, mode, sid: session.id, status: session.snapshot.status })
      await session.setPermissionMode(mode)
    })

    ipcMain.handle(AgentIpcChannels.SET_SANDBOX_MODE, async (_event, projectPath: string, mode: SandboxMode) => {
      this.throwIfRemoteLocked(projectPath)
      const capability = getSandboxCapability()
      if (mode !== 'off' && capability.supportLevel === 'unsupported') {
        throw new Error(capability.unsupportedReason ?? '当前平台不支持沙盒')
      }
      const session = await this.getOrCreateActiveSession(projectPath)
      return session.setSandboxMode(mode)
    })

    ipcMain.handle(AgentIpcChannels.SET_SESSION_SETTINGS, (_event, projectPath: string, settings: { model?: string | null; effort?: SendMessageRequest['effort'] | null; mode?: string | null }) => {
      if (this.isRemoteLockedSession(projectPath)) return
      const session = this.sessionManager?.getActiveSession(projectPath)
      if (!session) return
      session.setSelectedSettings(settings)
    })

    ipcMain.handle(AgentIpcChannels.SET_SESSION_API_PROVIDER, (_event, sessionId: string, apiProviderId: string | null) => {
      const session = this.sessionManager?.getSession(sessionId)
      if (!session) return
      this.throwIfRemoteLocked(session.snapshot.projectPath)
      session.setApiProviderId(apiProviderId)
    })

    ipcMain.handle(AgentIpcChannels.ANSWER_QUESTION, (_event, sessionId: string, requestId: string, answers: Record<string, string>, annotations?: QuestionAnnotations) => {
      const session = this.sessionManager?.getSession(sessionId)
      if (!session) return
      this.throwIfRemoteLocked(session.snapshot.projectPath)
      trace('agent.emit', 'question_answered', { requestId, answers, sessionId })
      session.respondToQuestion(requestId, answers, annotations)
      this.broadcastEventToRenderer({ type: 'interaction_resolved', interactionType: 'question', requestId, projectPath: session.snapshot.projectPath, sessionId })
    })

    ipcMain.handle(AgentIpcChannels.DISMISS_QUESTION, (_event, sessionId: string, requestId: string) => {
      const session = this.sessionManager?.getSession(sessionId)
      if (!session) return
      this.throwIfRemoteLocked(session.snapshot.projectPath)
      trace('agent.emit', 'question_dismissed', { requestId, sessionId })
      session.dismissQuestion(requestId)
      this.broadcastEventToRenderer({ type: 'interaction_resolved', interactionType: 'question', requestId, projectPath: session.snapshot.projectPath, sessionId })
    })

    ipcMain.handle(AgentIpcChannels.RESPOND_PLAN_APPROVAL, (_event, sessionId: string, requestId: string, approved: boolean, feedback?: string) => {
      const session = this.sessionManager?.getSession(sessionId)
      if (!session) return
      this.throwIfRemoteLocked(session.snapshot.projectPath)
      trace('agent.emit', 'plan_approval_responded', { requestId, approved, feedback, sessionId })
      session.respondToPlanApproval(requestId, approved, feedback)
      this.broadcastEventToRenderer({ type: 'interaction_resolved', interactionType: 'plan_approval', requestId, approved, feedback, projectPath: session.snapshot.projectPath, sessionId })
    })

    ipcMain.handle(AgentIpcChannels.CREATE_SESSION, async (_event, projectPath: string) => {
      const mgr = this.requireSessionManager()
      const { permissionMode, sandboxMode } = this.readDefaultSessionPrefs()
      const session = mgr.createSession({ projectPath, providerId: 'claude-base', permissionMode, sandboxMode })
      return session.snapshot.id
    })

    ipcMain.handle(AgentIpcChannels.RESET_SESSION, async (_event, sessionId: string, newSessionId?: string) => {
      const mgr = this.requireSessionManager()
      const existing = mgr.getSession(sessionId)
      if (!existing) {
        trace('session.lifecycle', 'ipc_resetSession_miss', { sessionId, newSessionId: newSessionId ?? '(none)' })
        return null
      }
      const projectPath = existing.snapshot.projectPath
      const providerId = existing.snapshot.providerId
      const harnessId = existing.snapshot.harnessId
      trace('session.lifecycle', 'ipc_resetSession', {
        projectPath,
        oldSessionId: sessionId,
        newSessionId: newSessionId ?? '(none)',
        harnessId,
      })
      await mgr.disposeSession(sessionId)
      if (!newSessionId) return null
      const prefs = harnessId === 'claude'
        ? this.readDefaultSessionPrefs()
        : { permissionMode: undefined, sandboxMode: undefined }
      const fresh = mgr.createSession({ projectPath, providerId, ...prefs, id: newSessionId })
      return { permissionMode: fresh.getCurrentPermissionMode(), sandboxInfo: fresh.getCurrentSandboxInfo() }
    })

    // Manual `/recap` (Grok ACP) — fire-and-forget x.ai/recap; result is session_recap event.
    ipcMain.handle(AgentIpcChannels.REQUEST_SESSION_RECAP, async (_event, sessionId: string) => {
      const session = this.sessionManager?.getSession(sessionId)
      if (!session?.requestSessionRecap) return false
      return session.requestSessionRecap(false)
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

    ipcMain.handle(AgentIpcChannels.MCP_SERVER_AUTHENTICATE, async (_event, projectPath: string, serverName: string) => {
      const session = this.sessionManager?.getActiveSession(projectPath)
      if (!session) throw new Error('No active session')
      await session.authenticateMcp(serverName)
    })

    ipcMain.handle(AgentIpcChannels.GET_CONTEXT_USAGE, async (_event, projectPath: string, sessionId?: string) => {
      const session = sessionId
        ? this.sessionManager?.getSession(sessionId)
        : this.sessionManager?.getActiveSession(projectPath)
      if (!session) return null
      if (sessionId && session.snapshot.projectPath !== projectPath) return null
      return session.getContextUsage()
    })

    ipcMain.handle(AgentIpcChannels.ACP_GET_RATE_LIMITS, async (
      _event,
      projectPath: string,
      agentId: string,
      force?: boolean,
    ) => {
      const { getAcpRateLimits } = await import('../acp/acp-usage-service')
      const session = this.sessionManager?.getActiveSession(projectPath) ?? null
      return getAcpRateLimits(agentId, session, force ?? false)
    })

    ipcMain.handle(AgentIpcChannels.PLUGINS_RELOAD, async (_event, projectPath: string) => {
      const session = this.sessionManager?.getActiveSession(projectPath)
      if (!session) return false
      return session.reloadPlugins()
    })

    ipcMain.handle(AgentIpcChannels.LIST_DIRECTORY, async (_event, projectPath: string, relativePath: string) => {
      const { parseRemoteProjectKey } = await import('@superone/shared/remote-resource-key')
      if (parseRemoteProjectKey(projectPath)) {
        try {
          const { getEnvironmentHost } = await import('../environment')
          const { listRemoteDirectoryForMentions } = await import('../environment/remote-mentions')
          return (
            (await listRemoteDirectoryForMentions(
              getEnvironmentHost(),
              projectPath,
              relativePath ?? '',
            )) ?? []
          )
        } catch {
          return []
        }
      }
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

    ipcMain.handle(AgentIpcChannels.VALIDATE_ADD_DIR, async (_event, projectPath: string, candidate: string) => {
      return this.validateAddDirCandidate(projectPath, candidate)
    })

    ipcMain.handle(AgentIpcChannels.LIST_DIRECTORY_FOR_ADD_DIR, async (_event, projectPath: string, rawInput: string) => {
      return this.listDirectoryForAddDir(projectPath, rawInput)
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
      const { parseRemoteProjectKey } = await import('@superone/shared/remote-resource-key')
      if (parseRemoteProjectKey(projectPath)) {
        try {
          const { getEnvironmentHost } = await import('../environment')
          const { searchRemoteFiles } = await import('../environment/remote-mentions')
          return (await searchRemoteFiles(getEnvironmentHost(), projectPath, query, 20)) ?? []
        } catch {
          return []
        }
      }
      const cwd = this.sessionManager?.getActiveSession(projectPath)?.snapshot.cwd ?? projectPath
      const roots = [cwd, ...(additionalDirs || [])]
      return searchFiles(roots, query, 20)
    })

    ipcMain.handle(AgentIpcChannels.SEARCH_MENTIONS, async (_event, projectPath: string, query: string, agents: AgentEntry[], additionalDirs?: string[], scopeDir?: string) => {
      const { parseRemoteProjectKey } = await import('@superone/shared/remote-resource-key')
      if (parseRemoteProjectKey(projectPath)) {
        try {
          const { getEnvironmentHost } = await import('../environment')
          const { searchRemoteMentions } = await import('../environment/remote-mentions')
          return (
            (await searchRemoteMentions(
              getEnvironmentHost(),
              projectPath,
              query,
              agents ?? [],
              scopeDir,
              20,
            )) ?? []
          )
        } catch {
          return []
        }
      }
      const cwd = this.sessionManager?.getActiveSession(projectPath)?.snapshot.cwd ?? projectPath
      const roots = [cwd, ...(additionalDirs || [])]
      return searchMentions(roots, query, agents, 20, scopeDir)
    })

    ipcMain.handle(AgentIpcChannels.DISCONNECT_REMOTE_SESSION, async (_event, sessionId?: string) => {
      const targets: import('../session/types').Session[] = []
      if (sessionId) {
        const s = this.sessionManager?.getSession(sessionId)
        if (s) targets.push(s)
      } else {
        this.sessionManager?.forEachSession((s) => {
          if (s.owner.kind === 'remote' || s.subscribers.size > 0) targets.push(s)
        })
      }
      for (const session of targets) {
        if (session.owner.kind === 'remote') session.release(session.owner.deviceId, 'desktop_kick')
        for (const d of Array.from(session.subscribers)) session.unsubscribe(d, 'desktop_kick')
      }
    })

    // --- Additional directories ---

    ipcMain.handle(AgentIpcChannels.READ_PROJECT_ADDITIONAL_DIRS, (_event, projectPath: string) => {
      return readScopedAdditionalDirs(projectPath)
    })

    ipcMain.handle(AgentIpcChannels.ADD_PROJECT_ADDITIONAL_DIR, (_event, projectPath: string, dir: string) => {
      addProjectAdditionalDir(projectPath, dir)
      this.sessionManager?.invalidateProjectResources(projectPath)
      this.emitAdditionalDirsChanged(projectPath)
    })

    ipcMain.handle(AgentIpcChannels.REMOVE_PROJECT_ADDITIONAL_DIR, (_event, projectPath: string, dir: string) => {
      removeProjectAdditionalDir(projectPath, dir)
      this.sessionManager?.invalidateProjectResources(projectPath)
      this.emitAdditionalDirsChanged(projectPath)
    })

    // --- Plugins (session-scoped — need cwd) ---

    ipcMain.handle(AgentIpcChannels.PLUGINS_LIST, async (_event, projectPath: string) => {
      const { parseRemoteProjectKey } = await import('@superone/shared/remote-resource-key')
      if (parseRemoteProjectKey(projectPath)) {
        try {
          const { getEnvironmentHost } = await import('../environment')
          const { listRemoteManagedPlugins } = await import('../environment/remote-resources')
          return (await listRemoteManagedPlugins(getEnvironmentHost(), projectPath)) ?? []
        } catch {
          return []
        }
      }
      return listPlugins(projectPath)
    })

    ipcMain.handle(AgentIpcChannels.PLUGINS_READ, async (_event, projectPath: string, key: string) => {
      const { parseRemoteProjectKey } = await import('@superone/shared/remote-resource-key')
      if (parseRemoteProjectKey(projectPath)) {
        const { getEnvironmentHost } = await import('../environment')
        const { getRemoteManagedPlugin } = await import('../environment/remote-resources')
        return (await getRemoteManagedPlugin(getEnvironmentHost(), projectPath, key)) ?? null
      }
      return readPluginContent(projectPath, key)
    })

    ipcMain.handle(AgentIpcChannels.PLUGINS_READ_FILE, async (_event, projectPath: string, key: string, relativePath: string) => {
      const { parseRemoteProjectKey } = await import('@superone/shared/remote-resource-key')
      if (parseRemoteProjectKey(projectPath)) {
        const { getEnvironmentHost } = await import('../environment')
        const { readRemoteManagedPluginFile } = await import('../environment/remote-resources')
        return (
          (await readRemoteManagedPluginFile(getEnvironmentHost(), projectPath, key, relativePath)) ??
          null
        )
      }
      return readPluginFile(projectPath, key, relativePath)
    })

    ipcMain.handle(AgentIpcChannels.PLUGINS_DELETE, async (_event, projectPath: string, key: string, scope: ResourceScope) => {
      const { parseRemoteProjectKey } = await import('@superone/shared/remote-resource-key')
      if (parseRemoteProjectKey(projectPath)) {
        if (scope !== 'user' && scope !== 'project') {
          throw new Error('Remote plugin delete only supports user or project scope')
        }
        const { getEnvironmentHost } = await import('../environment')
        const { deleteRemoteManagedPlugin } = await import('../environment/remote-resources')
        const ok = await deleteRemoteManagedPlugin(getEnvironmentHost(), projectPath, key, scope)
        if (!ok) throw new Error('Remote plugin delete failed')
        return
      }
      deletePlugin(key, scope, projectPath)
    })

    ipcMain.handle(AgentIpcChannels.PLUGINS_LIST_MARKETPLACE, async (_event, projectPath: string) => {
      const { parseRemoteProjectKey } = await import('@superone/shared/remote-resource-key')
      if (parseRemoteProjectKey(projectPath)) {
        try {
          const { getEnvironmentHost } = await import('../environment')
          const { listRemoteMarketplacePlugins } = await import('../environment/remote-resources')
          return (await listRemoteMarketplacePlugins(getEnvironmentHost(), projectPath)) ?? []
        } catch {
          return []
        }
      }
      return listMarketplacePlugins(projectPath)
    })

    ipcMain.handle(AgentIpcChannels.PLUGINS_INSTALL, async (_event, projectPath: string, key: string, scope: ResourceScope) => {
      const { parseRemoteProjectKey } = await import('@superone/shared/remote-resource-key')
      if (parseRemoteProjectKey(projectPath)) {
        if (scope !== 'user' && scope !== 'project') {
          throw new Error('Remote plugin install only supports user or project scope')
        }
        const { getEnvironmentHost } = await import('../environment')
        const { installRemoteManagedPlugin } = await import('../environment/remote-resources')
        const ok = await installRemoteManagedPlugin(getEnvironmentHost(), projectPath, key, scope)
        if (!ok) throw new Error('Remote plugin install failed')
        return
      }
      await installPlugin(key, scope, projectPath)
      try { await this.sessionManager?.getActiveSession(projectPath)?.reloadPlugins() } catch (err) { log.debug('[agent] reloadPlugins skipped:', err) }
    })

    ipcMain.handle(AgentIpcChannels.PLUGINS_UPDATE, async (_event, projectPath: string, updates: Array<{ key: string; scope: ResourceScope }>) => {
      const { parseRemoteProjectKey } = await import('@superone/shared/remote-resource-key')
      if (parseRemoteProjectKey(projectPath)) {
        const { getEnvironmentHost } = await import('../environment')
        const { updateRemoteManagedPlugin } = await import('../environment/remote-resources')
        const host = getEnvironmentHost()
        for (const { key, scope } of updates) {
          if (scope !== 'user' && scope !== 'project') {
            throw new Error('Remote plugin update only supports user or project scope')
          }
          const ok = await updateRemoteManagedPlugin(host, projectPath, key, scope)
          if (!ok) throw new Error(`Remote plugin update failed for ${key}`)
        }
        return
      }
      for (const { key, scope } of updates) {
        updatePlugin(key, scope, projectPath)
      }
      try { await this.sessionManager?.getActiveSession(projectPath)?.reloadPlugins() } catch (err) { log.debug('[agent] reloadPlugins skipped:', err) }
    })

    ipcMain.handle(AgentIpcChannels.PLUGINS_UPDATE_MARKETPLACE, async (_event, name: string) => {
      await updateMarketplace(name)
    })

    ipcMain.handle(AgentIpcChannels.PLUGINS_GITHUB_STARS, async (_event, repoSlug: string) => {
      return getGithubStars(repoSlug)
    })

    ipcMain.handle(AgentIpcChannels.PLUGINS_GITHUB_SEARCH_REPOS, async (_event, owner: string) => {
      return listGithubReposForOwner(owner)
    })

    ipcMain.handle(
      AgentIpcChannels.PLUGINS_GITHUB_LIST_MY_REPOS,
      async (_event, page?: number, perPage?: number) => {
        return listMyGithubRepos(
          typeof page === 'number' ? page : 1,
          typeof perPage === 'number' ? perPage : 20,
        )
      },
    )

    ipcMain.handle(AgentIpcChannels.CACHE_IMAGE, async (_event, url: string) => {
      return cacheRemoteImage(url)
    })

    ipcMain.handle(AgentIpcChannels.RESOLVE_FAVICON, async (_event, url: string, isDark: boolean) => {
      return resolveFavicon(url, isDark)
    })

    ipcMain.handle(AgentIpcChannels.CACHE_FAVICON, async (_event, pageUrl: string, faviconUrl: string, isDark: boolean) => {
      await cacheCapturedFavicon(pageUrl, faviconUrl, isDark)
    })

    ipcMain.handle(AgentIpcChannels.PLUGINS_ADD_MARKETPLACE, async (_event, source: string, scope: ResourceScope, projectPath: string) => {
      const { parseRemoteProjectKey } = await import('@superone/shared/remote-resource-key')
      if (parseRemoteProjectKey(projectPath)) {
        if (scope !== 'user' && scope !== 'project') {
          throw new Error('Remote marketplace add only supports user or project scope')
        }
        const { getEnvironmentHost } = await import('../environment')
        const { addRemoteMarketplace } = await import('../environment/remote-resources')
        const ok = await addRemoteMarketplace(getEnvironmentHost(), projectPath, source, scope)
        if (!ok) throw new Error('Remote marketplace add failed')
        return
      }
      await addMarketplace(source, scope, projectPath)
    })

    ipcMain.handle(AgentIpcChannels.PLUGINS_REMOVE_MARKETPLACE, async (_event, name: string, scope: 'user' | 'project' | 'local' | 'official', projectPath: string) => {
      const { parseRemoteProjectKey } = await import('@superone/shared/remote-resource-key')
      if (parseRemoteProjectKey(projectPath)) {
        const { getEnvironmentHost } = await import('../environment')
        const { removeRemoteMarketplace } = await import('../environment/remote-resources')
        const ok = await removeRemoteMarketplace(getEnvironmentHost(), projectPath, name, scope)
        if (!ok) throw new Error('Remote marketplace remove failed')
        return
      }
      await removeMarketplace(name, scope, projectPath)
    })

    ipcMain.handle(AgentIpcChannels.PLUGINS_READ_MARKETPLACE, (_event, marketplace: string, name: string) => {
      return readMarketplacePluginContent(marketplace, name)
    })

    ipcMain.handle(AgentIpcChannels.PLUGINS_READ_MARKETPLACE_FILE, (_event, marketplace: string, name: string, relativePath: string) => {
      return readMarketplacePluginFile(marketplace, name, relativePath)
    })

    // --- Skills (session-scoped) ---

    ipcMain.handle(AgentIpcChannels.SKILLS_LIST, async (_event, projectPath: string) => {
      const { parseRemoteProjectKey } = await import('@superone/shared/remote-resource-key')
      if (parseRemoteProjectKey(projectPath)) {
        try {
          const { getEnvironmentHost } = await import('../environment')
          const { listRemoteSkillsAndCommands } = await import('../environment/remote-mentions')
          const listed = await listRemoteSkillsAndCommands(getEnvironmentHost(), projectPath)
          if (!listed) return []
          // SkillInfo shape for settings UI — map slash entries.
          // sourcePath must be unique (React keys + detail expand use it).
          return listed.skills.map((s) => ({
            name: s.name,
            description: s.description,
            argumentHint: s.argumentHint,
            scope: 'project' as const,
            hasConfig: false,
            sourcePath: `remote:${projectPath}:skill:${s.name}`,
          }))
        } catch {
          return []
        }
      }
      return listSkills(projectPath)
    })

    ipcMain.handle(AgentIpcChannels.SLASH_RESOURCES_LIST, async (_event, projectPath: string) => {
      const { parseRemoteProjectKey } = await import('@superone/shared/remote-resource-key')
      if (parseRemoteProjectKey(projectPath)) {
        try {
          const { getEnvironmentHost } = await import('../environment')
          const { listRemoteSkillsAndCommands } = await import('../environment/remote-mentions')
          return (
            (await listRemoteSkillsAndCommands(getEnvironmentHost(), projectPath)) ?? {
              skills: [],
              commands: [],
            }
          )
        } catch {
          return { skills: [], commands: [] }
        }
      }
      // Local: project-scoped discovery only (user skills already in harnessResources).
      const { discoverProjectSkills, discoverProjectCommands } = await import('./discover-resources')
      return {
        skills: discoverProjectSkills(projectPath),
        commands: discoverProjectCommands(projectPath),
      }
    })

    ipcMain.handle(AgentIpcChannels.SKILLS_READ, async (_event, projectPath: string, name: string, sourcePath?: string) => {
      const { parseRemoteProjectKey } = await import('@superone/shared/remote-resource-key')
      if (parseRemoteProjectKey(projectPath)) {
        try {
          const { getEnvironmentHost } = await import('../environment')
          const { getRemoteManagedSkill } = await import('../environment/remote-resources')
          return (await getRemoteManagedSkill(getEnvironmentHost(), projectPath, name, { sourcePath })) ?? null
        } catch {
          return null
        }
      }
      return readSkillContent(projectPath, name, sourcePath)
    })

    ipcMain.handle(AgentIpcChannels.SKILLS_READ_FILE, async (_event, projectPath: string, skillName: string, relativePath: string, sourcePath?: string) => {
      const { parseRemoteProjectKey } = await import('@superone/shared/remote-resource-key')
      if (parseRemoteProjectKey(projectPath)) {
        try {
          const { getEnvironmentHost } = await import('../environment')
          const { readRemoteManagedSkillFile } = await import('../environment/remote-resources')
          return (
            (await readRemoteManagedSkillFile(
              getEnvironmentHost(),
              projectPath,
              skillName,
              relativePath,
              { sourcePath },
            )) ?? null
          )
        } catch {
          return null
        }
      }
      return readSkillFile(projectPath, skillName, relativePath, sourcePath)
    })

    ipcMain.handle(AgentIpcChannels.SKILLS_INSTALL, (_event, sourcePath: string) => {
      return installSkill(sourcePath)
    })

    ipcMain.handle(AgentIpcChannels.SKILLS_DELETE, async (_event, projectPath: string, sourcePath: string) => {
      const { parseRemoteProjectKey } = await import('@superone/shared/remote-resource-key')
      if (parseRemoteProjectKey(projectPath)) {
        const { getEnvironmentHost } = await import('../environment')
        const { deleteRemoteManagedSkill } = await import('../environment/remote-resources')
        const ok = await deleteRemoteManagedSkill(getEnvironmentHost(), projectPath, sourcePath)
        if (!ok) throw new Error('Remote skill delete failed or path is not remote')
        return
      }
      deleteSkill(sourcePath, projectPath)
    })

    ipcMain.handle(AgentIpcChannels.SKILLS_TOGGLE, (_event, name: string, disabled: boolean): string[] => {
      const current = readAppSettings().agentPreference.claude.disabledSkills
      const next = disabled
        ? Array.from(new Set([...current, name]))
        : current.filter((n) => n !== name)
      saveAppSettings({ agentPreference: { claude: { disabledSkills: next } } })
      return next
    })

    // --- Codex Skills (read-only) ---

    ipcMain.handle(AgentIpcChannels.CODEX_SKILLS_LIST, async (_event, projectPath: string) => {
      const { parseRemoteProjectKey } = await import('@superone/shared/remote-resource-key')
      // Remote projects: do not scan local ~/.codex/skills for a remote: key.
      if (parseRemoteProjectKey(projectPath)) return []
      return getSharedCodexSkillsService().list(projectPath)
    })

    ipcMain.handle(AgentIpcChannels.CODEX_SKILLS_READ, async (_event, projectPath: string, name: string, sourcePath?: string) => {
      const { parseRemoteProjectKey } = await import('@superone/shared/remote-resource-key')
      if (parseRemoteProjectKey(projectPath)) {
        try {
          const { getEnvironmentHost } = await import('../environment')
          const { getRemoteManagedSkill } = await import('../environment/remote-resources')
          return (
            (await getRemoteManagedSkill(getEnvironmentHost(), projectPath, name, {
              sourcePath,
              provider: 'codex',
            })) ?? null
          )
        } catch {
          return null
        }
      }
      return readCodexSkillContent(projectPath, name, sourcePath)
    })

    ipcMain.handle(AgentIpcChannels.CODEX_SKILLS_READ_FILE, async (_event, projectPath: string, skillName: string, relativePath: string, sourcePath?: string) => {
      const { parseRemoteProjectKey } = await import('@superone/shared/remote-resource-key')
      if (parseRemoteProjectKey(projectPath)) {
        try {
          const { getEnvironmentHost } = await import('../environment')
          const { readRemoteManagedSkillFile } = await import('../environment/remote-resources')
          return (
            (await readRemoteManagedSkillFile(
              getEnvironmentHost(),
              projectPath,
              skillName,
              relativePath,
              { sourcePath, provider: 'codex' },
            )) ?? null
          )
        } catch {
          return null
        }
      }
      return readCodexSkillFile(projectPath, skillName, relativePath, sourcePath)
    })

    ipcMain.handle(AgentIpcChannels.CODEX_SKILLS_DELETE, async (_event, projectPath: string, sourcePath: string) => {
      const { parseRemoteProjectKey } = await import('@superone/shared/remote-resource-key')
      if (parseRemoteProjectKey(projectPath)) {
        const { getEnvironmentHost } = await import('../environment')
        const { deleteRemoteManagedSkill } = await import('../environment/remote-resources')
        const ok = await deleteRemoteManagedSkill(getEnvironmentHost(), projectPath, sourcePath, 'codex')
        if (!ok) throw new Error('Remote codex skill delete failed')
        return
      }
      deleteCodexSkill(sourcePath, projectPath)
    })

    // --- Codex MCP config (read-only) ---

    ipcMain.handle(AgentIpcChannels.CODEX_MCP_LIST_CONFIG, async (_event, projectPath: string) => {
      const { parseRemoteProjectKey } = await import('@superone/shared/remote-resource-key')
      if (parseRemoteProjectKey(projectPath)) {
        try {
          const { getEnvironmentHost } = await import('../environment')
          const { listRemoteManagedMcp } = await import('../environment/remote-resources')
          return (await listRemoteManagedMcp(getEnvironmentHost(), projectPath, 'codex')) ?? []
        } catch {
          return []
        }
      }
      return listCodexMcpConfigs(projectPath)
    })

    // --- Agents (read-only) ---

    ipcMain.handle(AgentIpcChannels.AGENTS_LIST, async (_event, projectPath: string) => {
      const { parseRemoteProjectKey } = await import('@superone/shared/remote-resource-key')
      if (parseRemoteProjectKey(projectPath)) {
        try {
          const { getEnvironmentHost } = await import('../environment')
          const { listRemoteAgents } = await import('../environment/remote-mentions')
          return (await listRemoteAgents(getEnvironmentHost(), projectPath)) ?? []
        } catch {
          return []
        }
      }
      return discoverAllAgents(projectPath)
    })

    ipcMain.handle(AgentIpcChannels.AGENTS_READ_FILE, async (_event, projectPath: string, name: string) => {
      const { parseRemoteProjectKey } = await import('@superone/shared/remote-resource-key')
      if (parseRemoteProjectKey(projectPath)) {
        try {
          const { getEnvironmentHost } = await import('../environment')
          const { readRemoteAgentFile } = await import('../environment/remote-mentions')
          return (await readRemoteAgentFile(getEnvironmentHost(), projectPath, name)) ?? ''
        } catch {
          return ''
        }
      }
      return readAgentFile(projectPath, name)
    })

    // --- MCP config (session-scoped) ---

    ipcMain.handle(AgentIpcChannels.MCP_LIST_CONFIG, async (_event, projectPath: string) => {
      const { parseRemoteProjectKey } = await import('@superone/shared/remote-resource-key')
      if (parseRemoteProjectKey(projectPath)) {
        try {
          const { getEnvironmentHost } = await import('../environment')
          const { listRemoteManagedMcp } = await import('../environment/remote-resources')
          return (await listRemoteManagedMcp(getEnvironmentHost(), projectPath, 'claude')) ?? []
        } catch {
          return []
        }
      }
      return listMcpConfigs(projectPath)
    })

    ipcMain.handle(AgentIpcChannels.MCP_SAVE_CONFIG, async (_event, projectPath: string, name: string, config: Record<string, unknown>, scope: ResourceScope) => {
      const { parseRemoteProjectKey } = await import('@superone/shared/remote-resource-key')
      if (parseRemoteProjectKey(projectPath)) {
        if (scope !== 'user' && scope !== 'project') {
          throw new Error('Remote MCP save only supports user or project scope')
        }
        const { getEnvironmentHost } = await import('../environment')
        const { saveRemoteManagedMcp } = await import('../environment/remote-resources')
        const ok = await saveRemoteManagedMcp(getEnvironmentHost(), projectPath, {
          provider: 'claude',
          name,
          scope,
          config,
        })
        if (!ok) throw new Error('Remote MCP save failed')
        return
      }
      saveMcpConfig(name, config, scope, projectPath)
      const session = this.sessionManager?.getActiveSession(projectPath)
      if (session) {
        try { await session.toggleMcpServer(name, true) } catch (err) { log.debug('[agent] MCP save enable skipped:', err) }
        try { await session.reconnectMcp(name) } catch (err) { log.debug('[agent] MCP save reconnect skipped:', err) }
      }
    })

    ipcMain.handle(AgentIpcChannels.MCP_DELETE_CONFIG, async (_event, projectPath: string, name: string, scope: ResourceScope) => {
      const { parseRemoteProjectKey } = await import('@superone/shared/remote-resource-key')
      if (parseRemoteProjectKey(projectPath)) {
        if (scope !== 'user' && scope !== 'project') {
          throw new Error('Remote MCP delete only supports user or project scope')
        }
        const { getEnvironmentHost } = await import('../environment')
        const { deleteRemoteManagedMcp } = await import('../environment/remote-resources')
        const ok = await deleteRemoteManagedMcp(getEnvironmentHost(), projectPath, {
          provider: 'claude',
          name,
          scope,
        })
        if (!ok) throw new Error('Remote MCP delete failed')
        return
      }
      deleteMcpConfig(name, scope, projectPath)
      try { await this.sessionManager?.getActiveSession(projectPath)?.toggleMcpServer(name, false) } catch (err) { log.debug('[agent] MCP delete toggle skipped:', err) }
    })

    ipcMain.handle(AgentIpcChannels.MCP_TOGGLE_CONFIG, async (_event, projectPath: string, name: string, disabled: boolean, scope: ResourceScope) => {
      const { parseRemoteProjectKey } = await import('@superone/shared/remote-resource-key')
      if (parseRemoteProjectKey(projectPath)) {
        if (scope !== 'user' && scope !== 'project') {
          throw new Error('Remote MCP toggle only supports user or project scope')
        }
        const { getEnvironmentHost } = await import('../environment')
        const { toggleRemoteManagedMcp } = await import('../environment/remote-resources')
        const ok = await toggleRemoteManagedMcp(getEnvironmentHost(), projectPath, {
          provider: 'claude',
          name,
          scope,
          disabled,
        })
        if (!ok) throw new Error('Remote MCP toggle failed')
        return
      }
      if (scope !== 'claudeai') toggleMcpConfig(name, disabled, scope, projectPath)
      try { await this.sessionManager?.getActiveSession(projectPath)?.toggleMcpServer(name, !disabled) } catch (err) { log.debug('[agent] MCP toggle skipped:', err) }
    })

    ipcMain.handle(AgentIpcChannels.MCP_CHECK_SERVERS, async (_event, projectPath: string, harness?: HarnessId) => {
      // Source the configs for the requesting harness so a Codex session probes
      // codex config.toml (not Claude's MCP config) and vice-versa. Falls back to the
      // active session's harness, then Claude (the settings page passes no harness).
      const resolvedHarness = harness ?? this.sessionManager?.getActiveSession(projectPath)?.snapshot.harnessId ?? 'claude'
      const configs = resolvedHarness === 'codex' ? listCodexMcpConfigs(projectPath) : listMcpConfigs(projectPath)
      const result = await checkMcpServers(configs)
      if (resolvedHarness !== 'codex') {
        try {
          const sdkStatus = await this.sessionManager?.getActiveSession(projectPath)?.getMcpServerStatus() ?? []
          const claudeaiServers = sdkStatus.filter((s) => s.scope === 'claudeai')
          if (claudeaiServers.length > 0) {
            result.status.push(...claudeaiServers)
          }
        } catch (err) { log.debug('[agent] claudeai MCP status fetch skipped:', err) }
      }
      const connectedNames = new Set(result.status.filter((s) => s.status === 'connected').map((s) => s.name))
      const connectedMeta = Object.fromEntries(
        Object.entries(result.meta).filter(([name]) => connectedNames.has(name))
      )
      try { backupMcpServers(configs, connectedMeta) } catch (err) { log.warn('[agent] MCP backup failed:', err) }
      return result
    })

    ipcMain.handle(AgentIpcChannels.MCP_META_CACHE, async () => {
      return readMcpMetaCache()
    })

    ipcMain.handle(AgentIpcChannels.MCP_OAUTH_AUTHORIZE, async (_event, serverUrl: string, headers?: Record<string, string>, transport?: 'http' | 'sse') => {
      return authorizeHttpMcpServer(serverUrl, headers, transport)
    })

    // --- Hooks config (settings.json#hooks) ---

    ipcMain.handle(AgentIpcChannels.HOOKS_LIST, async (_event, projectPath: string) => {
      const { parseRemoteProjectKey } = await import('@superone/shared/remote-resource-key')
      if (parseRemoteProjectKey(projectPath)) {
        try {
          const { getEnvironmentHost } = await import('../environment')
          const { listRemoteManagedHooks } = await import('../environment/remote-resources')
          return (await listRemoteManagedHooks(getEnvironmentHost(), projectPath)) ?? []
        } catch {
          return []
        }
      }
      return listHooks(projectPath)
    })

    ipcMain.handle(AgentIpcChannels.HOOKS_SAVE, async (_event, projectPath: string, payload: HookSavePayload, replaceId?: string) => {
      const { parseRemoteProjectKey } = await import('@superone/shared/remote-resource-key')
      if (parseRemoteProjectKey(projectPath)) {
        const { getEnvironmentHost } = await import('../environment')
        const { saveRemoteManagedHook } = await import('../environment/remote-resources')
        const ok = await saveRemoteManagedHook(getEnvironmentHost(), projectPath, payload, replaceId)
        if (!ok) throw new Error('remote hooks.save requires connected node gateway')
        return
      }
      saveHook(projectPath, payload, replaceId)
    })

    ipcMain.handle(AgentIpcChannels.HOOKS_DELETE, async (_event, projectPath: string, id: string) => {
      const { parseRemoteProjectKey } = await import('@superone/shared/remote-resource-key')
      if (parseRemoteProjectKey(projectPath)) {
        const { getEnvironmentHost } = await import('../environment')
        const { deleteRemoteManagedHook } = await import('../environment/remote-resources')
        const ok = await deleteRemoteManagedHook(getEnvironmentHost(), projectPath, id)
        if (!ok) throw new Error('remote hooks.delete requires connected node gateway')
        return
      }
      deleteHook(projectPath, id)
    })

    // --- Providers ---

    ipcMain.handle(AgentIpcChannels.PLATFORMS_LIST, () => getPlatforms())
    ipcMain.handle(AgentIpcChannels.PLATFORMS_CREATE_CUSTOM, (_event, def: Platform) => upsertCustomPlatform(def))
    ipcMain.handle(AgentIpcChannels.PLATFORMS_UPDATE_CUSTOM, (_event, def: Platform) => upsertCustomPlatform(def))
    ipcMain.handle(AgentIpcChannels.PLATFORMS_DELETE_CUSTOM, (_event, id: string) => {
      const ok = deleteCustomPlatform(id)
      this.broadcastProviderConfigChanged()
      return ok
    })

    ipcMain.handle(AgentIpcChannels.CREDENTIALS_LIST, () => listCredentials())
    ipcMain.handle(AgentIpcChannels.CREDENTIALS_CREATE, (_event, input: CreateCredentialInput) => createCredential(input))
    ipcMain.handle(AgentIpcChannels.CREDENTIALS_UPDATE, (_event, id: string, patch: UpdateCredentialInput) => {
      const result = updateCredential(id, patch)
      this.broadcastProviderConfigChanged()
      return result
    })
    ipcMain.handle(AgentIpcChannels.CREDENTIALS_DELETE, (_event, id: string) => {
      const ok = deleteCredential(id)
      this.broadcastProviderConfigChanged()
      return ok
    })

    ipcMain.handle(AgentIpcChannels.BINDINGS_GET, () => listBindings())
    ipcMain.handle(AgentIpcChannels.BINDINGS_SET, (_event, binding: ConsumerBinding) => {
      log.info('[bindings] set consumer=%s credential=%s', binding.consumer, binding.credentialId)
      setBinding(binding)
      const harness = binding.consumer === 'chat:codex' ? 'codex' : 'claude'
      this.markAllNeedsRebuild()
      if (harness === 'codex') this.codexProviderChanged?.(false)
      this.broadcastProviderChanged(harness)
    })
    ipcMain.handle(AgentIpcChannels.BINDINGS_CLEAR, (_event, consumer: ConsumerId) => {
      log.info('[bindings] clear consumer=%s', consumer)
      deleteBinding(consumer)
      const harness = consumer === 'chat:codex' ? 'codex' : 'claude'
      this.markAllNeedsRebuild()
      if (harness === 'codex') this.codexProviderChanged?.(false)
      this.broadcastProviderChanged(harness)
    })

    ipcMain.handle(AgentIpcChannels.PROVIDERS_TEST_ENDPOINT, async (_event, data: { apiKey: string; credentialId?: string; endpoints: ServiceEndpoint[] }) => {
      const apiKey = resolveTestApiKey({ api_key: data.apiKey, credential_id: data.credentialId })
      const results = await testServiceEndpoints(data.endpoints, apiKey)
      trace('providers.test', 'result', results)
      return { success: results.every((r) => r.success), results }
    })

    ipcMain.handle(AgentIpcChannels.PROVIDERS_DISCOVER_MODELS, async (_event, data: { apiKey: string; credentialId?: string; endpoint: ServiceEndpoint }) => {
      const apiKey = resolveTestApiKey({ api_key: data.apiKey, credential_id: data.credentialId })
      const catalogIndex = await this.buildDiscoveryCatalogIndex()
      const result = await discoverModels(data.endpoint, apiKey, catalogIndex)
      trace('providers.discover', 'result', result)
      return result
    })

    // Cache-only. Detection / model probes run on app open (see main process startup).
    ipcMain.handle(AgentIpcChannels.ACP_LIST_AGENTS, async () => {
      const { readAcpResourcesCache } = await import('../acp/acp-model-cache')
      return readAcpResourcesCache()
    })

    // Once-per-launch model catalog refresh for installed ACP agents.
    ipcMain.handle(AgentIpcChannels.ACP_REFRESH_MODELS, async (_event, agentId?: string) => {
      const { refreshAcpModelsOnce } = await import('../acp/acp-model-cache')
      return refreshAcpModelsOnce(agentId ? { agentIds: [agentId] } : undefined)
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

    ipcMain.handle(AgentIpcChannels.MCP_DELETE_LIBRARY_ENTRY, async (_event, name: string) => {
      const entry = getLibraryEntry(name)
      if (entry?.bundleId) {
        await uninstallMcpbBundle(name)
      }
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
      const mgr = this.requireSessionManager()
      const defaults = this.readDefaultSessionPrefs()
      const effectiveMode = permissionMode ?? defaults.permissionMode
      let session = mgr.getSession(sessionId)
      if (!session) {
        try {
          session = mgr.resumeSession(sessionId, { permissionMode: effectiveMode, sandboxMode: defaults.sandboxMode })
        } catch (error) {
          log.warn(
            '[AgentService] resume session failed sid=%s project=%s: %s',
            sessionId,
            projectPath,
            error instanceof Error ? error.message : String(error),
          )
          throw error
        }
      } else if (permissionMode) {
        await session.setPermissionMode(permissionMode)
      }
      if (worktreeCwd && session.cwd !== worktreeCwd && existsSync(worktreeCwd)) {
        await session.switchCwd(worktreeCwd)
      }
      try { mgr.setActiveSession(projectPath, sessionId) } catch { /* session from another project, skip */ }
      return {
        permissionMode: session.getCurrentPermissionMode(),
        sandboxInfo: session.getCurrentSandboxInfo(),
      }
    })

    ipcMain.handle(AgentIpcChannels.PARK_SESSION, async (_event, projectPath: string) => {
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

    ipcMain.handle(AgentIpcChannels.SET_SESSION_FOREGROUND, (_event, sessionId: string, foreground: boolean) => {
      this.requireSessionManager().getSession(sessionId)?.setForeground(foreground)
    })

    ipcMain.handle(AgentIpcChannels.GET_LIVE_SNAPSHOTS, () => {
      return this.requireSessionManager().listLiveSnapshots()
    })

    ipcMain.handle(AgentIpcChannels.SESSIONS_LOAD_MESSAGES, (_event, projectPath: string, sessionId: string, limit: number, cursor?: number) => {
      return loadSessionMessages(projectPath, sessionId, limit, cursor)
    })

    ipcMain.handle(AgentIpcChannels.SESSIONS_RENAME, (_event, sessionId: string, title: string) => {
      const session = this.requireSessionManager().getSession(sessionId)
      if (session) {
        session.setTitle(title, 'user')
      } else {
        dbRenameSession(sessionId, title, 'user')
      }
      this.emitSessionsChanged()
    })

    ipcMain.handle(AgentIpcChannels.SESSIONS_LOAD_STATE, (_event, sessionId: string) => {
      return loadSessionState(sessionId)
    })

    ipcMain.handle(AgentIpcChannels.SESSIONS_DELETE, (_event, sessionId: string) => {
      dbDeleteSession(sessionId)
      this.emitSessionsChanged()
    })

    ipcMain.handle(AgentIpcChannels.SESSIONS_DELETE_OLDER, (_event, folderPath: string, cutoffDate: string) => {
      const deleted = dbDeleteSessionsOlderThan(folderPath, cutoffDate)
      if (deleted.length > 0) {
        this.emitSessionsChanged()
      }
      return deleted
    })

    ipcMain.handle(AgentIpcChannels.SESSIONS_FORK, async (_event, request: SessionForkRequest) => {
      const result = await forkSession(request)
      if (result.ok) {
        this.emitSessionsChanged()
      }
      return result
    })

    ipcMain.handle(AgentIpcChannels.SESSIONS_PIN, (_event, sessionId: string, pinned: boolean) => {
      dbPinSession(sessionId, pinned)
      this.emitSessionsChanged()
    })

    ipcMain.handle(AgentIpcChannels.SESSIONS_HIDE, (_event, sessionId: string, hidden: boolean) => {
      dbHideSession(sessionId, hidden)
      this.emitSessionsChanged()
    })

    ipcMain.handle(AgentIpcChannels.SESSIONS_LIST_PINNED, () => {
      return listPinnedSessions()
    })
  }

  private emitSessionsChanged(): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(AgentIpcChannels.SESSIONS_CHANGED)
    }
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
  }

  hasRunningSessions(): boolean {
    return this.sessionManager?.hasAnyStreaming() ?? false
  }

  async dispose(): Promise<void> {
    this.warmupManager.dispose()

    ipcMain.removeHandler(AgentIpcChannels.SEND_MESSAGE)
    ipcMain.removeHandler(AgentIpcChannels.DEQUEUE_MESSAGE)
    ipcMain.removeHandler(AgentIpcChannels.PREWARM)
    ipcMain.removeHandler(AgentIpcChannels.INTERRUPT)
    ipcMain.removeHandler(AgentIpcChannels.STOP_TASK)
    ipcMain.removeHandler(AgentIpcChannels.PERMISSION_RESPONSE)
    ipcMain.removeHandler(AgentIpcChannels.SET_PERMISSION_MODE)
    ipcMain.removeHandler(AgentIpcChannels.SET_SESSION_SETTINGS)
    ipcMain.removeHandler(AgentIpcChannels.SET_SESSION_API_PROVIDER)
    ipcMain.removeHandler(AgentIpcChannels.SET_SANDBOX_MODE)
    ipcMain.removeHandler(AgentIpcChannels.ANSWER_QUESTION)
    ipcMain.removeHandler(AgentIpcChannels.DISMISS_QUESTION)
    ipcMain.removeHandler(AgentIpcChannels.RESPOND_PLAN_APPROVAL)
    ipcMain.removeHandler(AgentIpcChannels.RESET_SESSION)
    ipcMain.removeHandler(AgentIpcChannels.REQUEST_SESSION_RECAP)
    ipcMain.removeHandler(AgentIpcChannels.CREATE_SESSION)
    ipcMain.removeHandler(AgentIpcChannels.TRUNCATE_AT_CHECKPOINT)
    ipcMain.removeHandler(AgentIpcChannels.REWIND_FILES)
    ipcMain.removeHandler(AgentIpcChannels.REWIND_FILES_PREVIEW)
    ipcMain.removeHandler(AgentIpcChannels.REWIND_CODE_AND_CHAT)
    ipcMain.removeHandler(AgentIpcChannels.REWIND_CONVERSATION)
    ipcMain.removeHandler(AgentIpcChannels.GET_SESSION_ID)
    ipcMain.removeHandler(AgentIpcChannels.MCP_SERVER_STATUS)
    ipcMain.removeHandler(AgentIpcChannels.MCP_SERVER_AUTHENTICATE)
    ipcMain.removeHandler(AgentIpcChannels.GET_CONTEXT_USAGE)
    ipcMain.removeHandler(AgentIpcChannels.PLUGINS_RELOAD)
    ipcMain.removeHandler(AgentIpcChannels.LIST_DIRECTORY)
    ipcMain.removeHandler(AgentIpcChannels.LIST_DIRECTORY_FOR_ADD_DIR)
    ipcMain.removeHandler(AgentIpcChannels.VALIDATE_ADD_DIR)
    ipcMain.removeHandler(AgentIpcChannels.FIND_LINE_NUMBER)
    ipcMain.removeHandler(AgentIpcChannels.SEARCH_FILES)
    ipcMain.removeHandler(AgentIpcChannels.SEARCH_MENTIONS)
    ipcMain.removeHandler(AgentIpcChannels.DISCONNECT_REMOTE_SESSION)
    ipcMain.removeHandler(AgentIpcChannels.READ_PROJECT_ADDITIONAL_DIRS)
    ipcMain.removeHandler(AgentIpcChannels.ADD_PROJECT_ADDITIONAL_DIR)
    ipcMain.removeHandler(AgentIpcChannels.REMOVE_PROJECT_ADDITIONAL_DIR)
    ipcMain.removeHandler(AgentIpcChannels.PLUGINS_LIST)
    ipcMain.removeHandler(AgentIpcChannels.PLUGINS_READ)
    ipcMain.removeHandler(AgentIpcChannels.PLUGINS_READ_FILE)
    ipcMain.removeHandler(AgentIpcChannels.PLUGINS_DELETE)
    ipcMain.removeHandler(AgentIpcChannels.PLUGINS_LIST_MARKETPLACE)
    ipcMain.removeHandler(AgentIpcChannels.PLUGINS_INSTALL)
    ipcMain.removeHandler(AgentIpcChannels.PLUGINS_UPDATE)
    ipcMain.removeHandler(AgentIpcChannels.PLUGINS_UPDATE_MARKETPLACE)
    ipcMain.removeHandler(AgentIpcChannels.PLUGINS_GITHUB_STARS)
    ipcMain.removeHandler(AgentIpcChannels.PLUGINS_GITHUB_SEARCH_REPOS)
    ipcMain.removeHandler(AgentIpcChannels.PLUGINS_GITHUB_LIST_MY_REPOS)
    ipcMain.removeHandler(AgentIpcChannels.CACHE_IMAGE)
    ipcMain.removeHandler(AgentIpcChannels.SKILLS_LIST)
    ipcMain.removeHandler(AgentIpcChannels.SLASH_RESOURCES_LIST)
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
    ipcMain.removeHandler(AgentIpcChannels.MCP_META_CACHE)
    ipcMain.removeHandler(AgentIpcChannels.MCP_OAUTH_AUTHORIZE)
    ipcMain.removeHandler(AgentIpcChannels.MCP_LIST_LIBRARY)
    ipcMain.removeHandler(AgentIpcChannels.MCP_DELETE_LIBRARY_ENTRY)
    ipcMain.removeHandler(AgentIpcChannels.HOOKS_LIST)
    ipcMain.removeHandler(AgentIpcChannels.HOOKS_SAVE)
    ipcMain.removeHandler(AgentIpcChannels.HOOKS_DELETE)
    ipcMain.removeHandler(AgentIpcChannels.SESSION_PROVIDERS_LIST)
    ipcMain.removeHandler(AgentIpcChannels.SESSION_PROVIDERS_LIST_BY_HARNESS)
    ipcMain.removeHandler(AgentIpcChannels.SESSION_PROVIDERS_GET)
    ipcMain.removeHandler(AgentIpcChannels.SESSION_PROVIDERS_GET_BASE)
    ipcMain.removeHandler(AgentIpcChannels.SESSION_PROVIDERS_CREATE)
    ipcMain.removeHandler(AgentIpcChannels.SESSION_PROVIDERS_UPDATE)
    ipcMain.removeHandler(AgentIpcChannels.SESSION_PROVIDERS_DELETE)
    ipcMain.removeHandler(AgentIpcChannels.PARK_SESSION)
    ipcMain.removeHandler(AgentIpcChannels.ACTIVATE_SESSION)
    ipcMain.removeHandler(AgentIpcChannels.SET_SESSION_FOREGROUND)
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
    ipcMain.removeHandler(AgentIpcChannels.SESSIONS_FORK)
    ipcMain.removeHandler(AgentIpcChannels.SESSIONS_PIN)
    ipcMain.removeHandler(AgentIpcChannels.SESSIONS_HIDE)
    ipcMain.removeHandler(AgentIpcChannels.SESSIONS_LIST_PINNED)
  }
}
