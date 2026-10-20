import { isAgentProfilesEnabled } from '../session/agent-profile-feature'
import { readAgentProfile } from '@superone/shared/agent-profile'
import { registerAgentProfileManagementIpc, unregisterAgentProfileManagementIpc } from '../session/agent-profile-management-ipc'
import { readDefaultSessionPrefs } from '../session/session-preferences'
import { preferredVoiceRequest, windowVoiceEndpoint, readyWindowVoice } from './realtime-voice-control'
import { codexAccountStore } from '../codex/codex-account-store'
import { resolveProjectExtraDirs } from '@superone/shared/project-extra-dirs'
import { findAttachment } from '../remote/attachment-thumbnail'
import { readPhoneFile, readPhoneVideoPoster, type PhoneFileInput, type PhoneFileSource } from '../remote/phone-files'
import type { SessionActivity } from '@superone/shared/session-activity'
import type { SuggestedTaskLaunchChoice } from '@superone/shared/suggested-task'
import { liveSessionActivity } from '../remote/live-session-activity'
import { spawnParentOf } from '../session/collaboration-mailbox'
import { enqueueSessionQueueOp } from '../session/session-queue'
import { sendPhoneMcpAppMessage } from '../session/mcp-app-send'
import { randomUUID } from 'crypto'
import { newMessageId } from '@superone/shared/message-id'
import { execFileSync } from 'child_process'
import { statSync } from 'fs'
import log from '../logger'
import { ensureShellPath } from '../shell-path'
import { resolve, join } from 'path';
import { ipcMain, type BrowserWindow } from 'electron'
import { windowControlIpc } from '../session/control-context'
import { WarmupManager } from './warmup-manager'
import { fetchModels } from './claude-models'
import { AgentIpcChannels, type AgentEvent, type AgentPrewarmHint, type CodexPermissionPreset, type CodexReasoningEffort, type McpToolPermission, type ModelOption, type PermissionMode, type ResourceScope, type SandboxMode, type SendMessageRequest } from '@superone/shared/agent-types';
import { baseSessionProviderId } from '@superone/shared/session-provider-definitions'
import { parseRemoteProjectKey } from '@superone/shared/remote-resource-key'
import { localSessionEnvironmentId } from '../environment/session-identity'
import type { RemoteControlService } from '../remote-control-service'
import type { McpChange } from '@superone/runtime/server/rpc-resources'
import { trace } from './event-trace'
import { applySessionDirectoryHint, sessionCreationCwd } from './session-directory'
import { getProjectExtraDirs, updateProject } from '../recent-folders';
import { readdir, mkdir } from 'fs/promises'
import { existsSync, readdirSync, readFileSync } from 'fs';
import { homedir } from 'os'
import { getCachedHarnessResources } from '../database'
import { resolveTestApiKey } from './provider-test-key'
import { buildRemoteActiveService, platformDisplay, resolveChatService } from '../providers/resolver'
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
import { coerceSandboxModeForCapability, getSandboxCapability } from '../sandbox-platform'
import { searchFiles, searchMentions, EXCLUDED_DIRS, type AgentEntry } from './fuzzy-file-search'
import { type Session as SessionContract } from '../session/types';
import { installAcpRecapFocus } from '../acp/acp-recap-focus';
import { harnessProviderCatalog } from './remote-selector-catalog'
import { defaultChatProviderId } from './default-chat-provider'
import { listAccounts as listClaudeAccounts } from './claude-account-service'
import { getCurrentLocale } from '../i18n'
import { buildRemoteHarnessSystemInfo } from './remote-harness-system-info'
import { sessionDefaultsForHarness } from '@superone/shared/harness/session-defaults'

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
import { createSession, createAutomationSession, loadSessionMessage, readSessionHarnessId } from '../db-sessions';
import { getSessionRecord } from '../session/session-repo'
import { worktreeExists } from '../git/worktree-alive'
import { listMcpConfigs, saveMcpConfig, deleteMcpConfig, toggleMcpConfig, listMcpToolPermissions, setMcpToolPermission } from '../mcp-config-service'
import {
  deleteDshMcpConfig,
  listDshMcpConfigs,
  saveDshMcpConfig,
  toggleDshMcpConfig,
} from '@superone/runtime/fs'
import { listHooks, saveHook, deleteHook } from '../hooks-config-service'
import { checkMcpServers, readMcpMetaCache } from '../mcp-probe-service'
import { authorizeHttpMcpServer } from '../mcp-oauth'
import { listSkills, readSkillContent, readSkillFile, installSkill, deleteSkill, readCodexSkillContent, readCodexSkillFile, deleteCodexSkill } from '../skills-service'
import { getSharedCodexSkillsService } from '../codex/codex-skills-rpc-singleton'
import { readAppSettings, saveAppSettings } from '../app-settings-service'
import { queryHarnessSessionRanks } from '../usage-stats-service'
import { listCodexMcpConfigs } from '../codex-config-service'
import { discoverAllAgents, discoverProjectCommands, readAgentFile } from './discover-resources'
import { listPlugins, readPluginContent, readPluginFile, deletePlugin, setPluginEnabled, readPluginUserConfig, savePluginUserConfig, reviewPluginMods, listMarketplacePlugins, installPlugin, updatePlugin, updateMarketplace, addMarketplace, removeMarketplace, readMarketplacePluginContent, readMarketplacePluginFile, getGithubStars, listGithubReposForOwner, searchGithubRepositories, listMyGithubRepos } from '../plugins-service'
import { cacheRemoteImage } from '../image-cache'
import { resolveFavicon, cacheCapturedFavicon } from '../favicon'
import { resolveSiteIdentity } from '../site-identity'
import { backupMcpServers, listLibrary, deleteLibraryEntry, getLibraryEntry } from '../mcp-library-service'
import { uninstallMcpbBundle } from '../mcpb/mcpb-installer'
import type { PluginModReview, HookSavePayload, SessionForkRequest, HarnessId, DshPluginInstallSource } from '@superone/shared/agent-types'
import { tryResolveHarnessRuntime } from '../harness/resolve-runtime'
import { forkSession } from '../session/session-fork'
import { loadRealtimeTimeline, reconcileRealtimeTimeline } from '../session/realtime-timeline-repo'

export class AgentService {
  private prepareDraftOpen?: (draftId: string) => Promise<void>
  setPrepareDraftOpen(prepare: (draftId: string) => Promise<void>): void { this.prepareDraftOpen = prepare }
  async remotePrepareDraftOpen(draftId: string): Promise<void> { await this.prepareDraftOpen?.(draftId) }
  remoteSendMcpAppMessage(input: Parameters<typeof sendPhoneMcpAppMessage>[1], source: Parameters<typeof sendPhoneMcpAppMessage>[2], onAccepted: () => void): Promise<void> {
    return sendPhoneMcpAppMessage(this.requireSessionManager(), input, source, onAccepted)
  }
  private mainWindow: BrowserWindow | null = null
  private sessionManager: import('../session/session-manager').SessionManagerImpl | null = null
  private eventSubscribers: Array<(event: AgentEvent) => void> = []
  private codexListModels?: (projectPath: string) => Promise<ModelOption[]>
  private codexGetAuthStatus?: (projectPath: string) => unknown
  private readHarnessUsage?: (request: import('./harness-usage').HarnessUsageRequest) => Promise<import('@superone/shared/agent-types').RemoteUsage | null>
  private codexProviderChanged?: (invalidateModelCache?: boolean) => void
  private remoteControlService?: RemoteControlService
  private mobileReceiveService?: import('../remote/mobile-receive-service').MobileReceiveService
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

  /** Subscription-meter reader shared with the desktop gauge's data sources; see `harness-usage.ts`. */
  setHarnessUsageReader(fn: NonNullable<typeof this.readHarnessUsage>): void {
    this.readHarnessUsage = fn
  }


  setRemoteControlService(svc: RemoteControlService): void {
    this.remoteControlService = svc
  }

  setMobileReceiveService(svc: import('../remote/mobile-receive-service').MobileReceiveService): void {
    this.mobileReceiveService = svc
  }

  private sessionForegroundListener: ((windowId: number, ref: { environmentId: string; sessionId: string }, foreground: boolean, sender: Electron.WebContents) => void) | null = null

  /** Told which session each window's views show; main keeps the renderer's topics from it. */
  setSessionForegroundListener(listener: (windowId: number, ref: { environmentId: string; sessionId: string }, foreground: boolean, sender: Electron.WebContents) => void): void {
    this.sessionForegroundListener = listener
  }

  /** Where environment events (no session) go: the main event hub in production. */
  setEnvironmentEventPublisher(fn: (event: AgentEvent) => void): void {
    this.environmentEventPublisher = fn
  }

  private environmentEventPublisher: ((event: AgentEvent) => void) | null = null

  private releaseRoutedSessions?: (sessionId?: string) => Promise<void>
  setRoutedSessionRelease(release: (sessionId?: string) => Promise<void>): void { this.releaseRoutedSessions = release }
  async disconnectSessionController(sessionId?: string): Promise<void> {
    const targets: import('../session/types').Session[] = []
    if (sessionId) {
      const session = this.sessionManager?.getSession(sessionId)
      if (session) targets.push(session)
    } else {
      this.sessionManager?.forEachSession(session => {
        if (session.lease.isExternal) targets.push(session)
      })
    }
    for (const session of targets) session.lease.takeBack()
    await this.releaseRoutedSessions?.(sessionId)
  }

  private publishEnvironmentEvent(event: AgentEvent): void {
    trace('remote.debug', 'publishEnvironmentEvent', { type: event.type, projectPath: event.projectPath, sessionId: event.sessionId })
    if (this.environmentEventPublisher) {
      this.environmentEventPublisher(event)
      return
    }
    this.notifyEventSubscribers(event)
    this.mainWindow && !this.mainWindow.isDestroyed() && this.mainWindow.webContents.send(AgentIpcChannels.EVENT, event)
  }

  private isRemoteLockedSession(projectPath: string): boolean {
    return this.isSessionRemoteLocked(this.sessionManager?.getActiveSession(projectPath))
  }

  /**
   * Lock check for one specific session rather than "whatever the project's
   * active session happens to be".
   *
   * Handlers that accept an explicit session id must use this: reading the
   * project's active session there answers a question about a different
   * session, and lets a write through on the strength of it.
   */
  private isSessionRemoteLocked(session: SessionContract | null | undefined): boolean {
    if (!session) return false
    return session.lease.isExternal
  }

  private throwIfRemoteLocked(projectPath: string): void {
    const activeSession = this.sessionManager?.getActiveSession(projectPath)
    if (!activeSession) return
    activeSession.lease.assertMutation()
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
    const sessionId = harnessId === 'codex' ? `codex-auto-${randomUUID()}` : randomUUID()
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
        ?? (cfg.permissionMode === 'auto'
          ? 'auto-review'
          : cfg.permissionMode === 'bypassPermissions' || cfg.permissionMode === 'acceptEdits'
          ? 'full-access'
          : cfg.permissionMode
            ? 'default'
            : 'full-access')
      permissionMode = cfg.permissionMode
        ?? (permissionPreset === 'full-access' ? 'bypassPermissions' : permissionPreset === 'auto-review' ? 'auto' : 'default')
      apiProviderId = cfg.apiProviderId
    } else if (cfg.type === 'acp') {
      permissionMode = cfg.permissionMode ?? 'bypassPermissions'
      acpAgentId = cfg.acpAgentId ?? null
      apiProviderId = cfg.apiProviderId
    } else {
      // Only the legacy Plan selection seeds an agent; permissions are native.
      permissionMode = cfg.permissionMode === 'plan' ? 'plan' : 'default'
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
      unattended: true,
    })

    const clientMessageId = newMessageId('auto')
    if (cfg.type === 'codex') {
      await session.send({
        content: options.content,
        clientMessageId,
        assistantMessageId: newMessageId('auto'),
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
    this.publishEnvironmentEvent(event)
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

  /**
   * Claude accounts changed on this machine. Other desktops hear the existing
   * `provider_changed` notice. Sessions are not rebuilt: an account list is not
   * a credential or binding change.
   */
  publishClaudeAccountsChanged(): void {
    this.publishEnvironmentEvent({ type: 'provider_changed', harnessId: 'claude', provider: null })
  }

  /** A credential/platform change can affect either harness — rebuild and re-broadcast both. */
  providerConfigChanged(): void {
    this.markAllNeedsRebuild()
    this.codexProviderChanged?.()
    this.broadcastProviderChanged('claude')
    this.broadcastProviderChanged('codex')
  }

  /** One consumer's binding changed: rebuild sessions and re-broadcast its harness. */
  providerBindingChanged(consumer: ConsumerId): void {
    const harness = consumer === 'chat:codex' ? 'codex' : 'claude'
    this.markAllNeedsRebuild()
    if (harness === 'codex') this.codexProviderChanged?.(false)
    this.broadcastProviderChanged(harness)
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

  /**
   * Replace a project's workspace folders and tell everyone.
   *
   * Mobile's add/remove commands land here: the folder belongs to the SuperOne
   * project now, not to whichever config file the caller's harness reads.
   */
  private setProjectExtraDirs(projectPath: string, update: (dirs: string[]) => string[]): void {
    updateProject({ path: projectPath, extraDirs: update(getProjectExtraDirs(projectPath)) })
    // The event carries `workspaceDirs`, so the renderer repaints from it —
    // no separate project-list broadcast needed.
    this.emitAdditionalDirsChanged(projectPath)
  }

  private emitAdditionalDirsChanged(projectPath: string, sessionId?: string): void {
    const targetSession = sessionId ? this.sessionManager?.getSession(sessionId) : this.sessionManager?.getActiveSession(projectPath)
    const sessionDirs = targetSession?.getCallerScopedDirsSnapshot() ?? []
    const workspaceDirs = getProjectExtraDirs(projectPath)
    const event: AgentEvent = {
      type: 'additional_dirs_changed',
      projectPath,
      sessionId: targetSession?.snapshot.id,
      additionalDirectories: Array.from(new Set([...workspaceDirs, ...sessionDirs])),
      sessionAdditionalDirs: sessionDirs,
      workspaceDirs,
    }
    this.publishEnvironmentEvent(event)
  }

  /** A harness's catalog and defaults for a phone composer (`get_system_info`, `harness.systemInfo`). */
  async remoteSystemInfo(projectPath: string, provider: HarnessId, force?: boolean): Promise<import('@superone/shared/agent-types').RemoteSystemInfo> {
    const settings = readAppSettings()
    // Claude account choices retain their credential domain even with one account.
    const claudeAccounts = provider === 'claude'
      ? (await listClaudeAccounts().catch(() => [])).filter((account) => account.loggedIn)
      : []
    const info = await buildRemoteHarnessSystemInfo(projectPath, provider, {
      settings,
      currentLocale: getCurrentLocale(),
      getCachedResources: getCachedHarnessResources,
      fetchClaudeModels: fetchModels,
      connectOpenCodeResources: async (projectPath) => {
        const { connectOpenCodeResources } = await import('../opencode/opencode-resources')
        return connectOpenCodeResources(projectPath, force)
      },
      listCodexModels: this.codexListModels,
      codexAccount: this.codexGetAuthStatus,
      activeProvider: (harnessId) => buildRemoteActiveService(
        harnessId === 'claude'
          ? resolveChatService('claude', null, {
              experimentalClaudeOpenAiChatEnabled: settings.experimentalClaudeOpenAiChatEnabled,
            })
          : resolveChatService('codex'),
        harnessId,
      ),
      providerCatalog: (harnessId) => {
        if (harnessId !== 'claude' && harnessId !== 'codex') return { providers: [], selectedProviderId: null }
        // The credential store is optional context here: a client that
        // cannot switch provider must still get its models and defaults.
        try {
        const credentials = listCredentials()
        const options = { experimentalClaudeOpenAiChatEnabled: settings.experimentalClaudeOpenAiChatEnabled }
        return harnessProviderCatalog(harnessId, {
          credentials,
          // Resolve through the store the same way `activeProvider` does, so
          // the bound credential picks up its binding-level mapping overrides
          // and every row carries the mapping the client cannot compute itself.
          servesHarness: (credentialId) => {
            const resolved = resolveChatService(harnessId, credentialId, options)
            if (!resolved) return null
            return { brand: resolved.brand, modelEnv: resolved.modelMapping }
          },
          platformDisplay,
          claudeAccounts,
          codexAccounts: harnessId === 'codex' ? codexAccountStore().list() : [],
          selectedProviderId: defaultChatProviderId(harnessId, options),
        })
        } catch (err) {
          log.warn('[get_system_info] provider catalog unavailable: %s', err instanceof Error ? err.message : String(err))
          return { providers: [], selectedProviderId: null }
        }
      },
      // Same answer `Session` reaches for at construction: the stored
      // preference when there is one, the platform's own default otherwise.
      defaultSandboxMode: () => this.readDefaultSessionPrefs(provider).sandboxMode
        ?? getSandboxCapability().defaultMode,
      sandboxSupport: () => getSandboxCapability().supportLevel,
      catalogModels: async () => {
        try {
          const { getModelCatalog } = await import('../model-catalog')
          const { buildCatalogModelIndex } = await import('@superone/shared/platform-registry')
          return buildCatalogModelIndex(await getModelCatalog())
        } catch (err) {
          log.warn('[get_system_info] model catalog unavailable: %s', err instanceof Error ? err.message : String(err))
          return new Map()
        }
      },
      deepseekPresets: async () => {
        try {
          const { getDeepseekRuntime } = await import('../deepseek/deepseek-runtime-host')
          const { listDeepseekPresets } = await import('@superone/deepseek/presets')
          const runtime = await getDeepseekRuntime()
          return { presets: await listDeepseekPresets(runtime.context), current: null, switchable: true }
        } catch (err) {
          log.warn('[get_system_info] deepseek presets unavailable: %s', err instanceof Error ? err.message : String(err))
          return null
        }
      },
    })
    return info
  }

  /** Skills, agents and commands a phone composer offers in a project (`get_project_resources`, `harness.projectResources`). */
  async remoteProjectResources(projectPath: string, provider: HarnessId): Promise<Record<string, unknown>> {
    if (provider === 'claude') {
      const skills = listSkills(projectPath)
      const agents = discoverAllAgents(projectPath)
      const projectSlashCommands = discoverProjectCommands(projectPath)
      return {
        skills: skills.map((s) => ({ name: s.name, description: s.description ?? '', argumentHint: s.argumentHint ?? '' })),
        agents: agents.map((a) => ({ name: a.name, description: a.description ?? '', model: a.model })),
        projectSlashCommands: projectSlashCommands.map((c) => ({ name: c.name, description: c.description ?? '', argumentHint: c.argumentHint ?? '' })),
        workspaceDirs: getProjectExtraDirs(projectPath),
        cwd: projectPath,
        homedir: homedir(),
      }
    } else if (provider === 'codex') {
      const skills = await getSharedCodexSkillsService().list(projectPath)
      return {
        skills: skills.map((s) => ({ name: s.name, description: s.description ?? '', argumentHint: s.argumentHint ?? '' })),
        workspaceDirs: getProjectExtraDirs(projectPath),
        cwd: projectPath,
        homedir: homedir(),
      }
    } else {
      return {
        skills: [],
        agents: [],
        projectSlashCommands: [],
        workspaceDirs: getProjectExtraDirs(projectPath),
        cwd: projectPath,
        homedir: homedir(),
      }
    }
  }

  /** The harnesses a phone offers for a new chat, in the desktop's suggestion order (`list_harness_options`, `harness.options`). */
  async remoteHarnessOptions(): Promise<{ options: Array<{ key: string; provider: string; acpAgentId: string | null; label: string }> }> {
    const [{ listHarnessInstallations }, { detectBuiltinAgents }, { orderSuggestionHarnesses }, { isGrokAcpAgent }] =
      await Promise.all([
        import('../harness/service'),
        import('../acp/acp-detect'),
        import('@superone/shared/suggestion-harness-order'),
        import('@superone/shared/acp-brand'),
      ])
    const settings = readAppSettings()
    await ensureShellPath()
    const catalog = listHarnessInstallations()
    const catalogOn = (id: string) => catalog.some((row) => row.id === id && row.enabled)
    // Same visibility rules as the desktop `ChatSuggestions`: OpenCode has
    // its own harness row, and a non-Grok ACP agent needs the experimental
    // opt-in that names it.
    const acpAgents = (await detectBuiltinAgents())
      .filter((agent) => agent.id !== 'opencode' && (isGrokAcpAgent(agent.id)
        ? catalogOn('acp-grok')
        : settings.experimentalAgentsEnabled || settings.enabledExperimentalAgents.includes(agent.id)))
      .map((agent) => ({ id: agent.id, name: agent.name }))
    const options = orderSuggestionHarnesses({
      ranks: queryHarnessSessionRanks(7),
      acpAgents,
      includeClaude: catalogOn('claude'),
      includeCodex: catalogOn('codex'),
      includeOpenCode: catalogOn('opencode') || settings.experimentalAgentsEnabled,
      includeCursor: catalogOn('cursor'),
      includeDeepseek: catalogOn('dsh'),
      harnessOrder: settings.harnessOrder,
      defaultHarness: settings.suggestionHarness,
      secondaryHarness: settings.secondaryHarness,
    })
    return { options: options.map(({ key, provider, acpAgentId, label }) => ({ key, provider, acpAgentId, label })) }
  }

  /**
   * A message attachment's bytes: in the live session while the turn runs or
   * the message is queued, otherwise in the persisted message.
   */
  remoteAttachment(sessionId: string, messageId: string, selector: { attachmentId?: string; name: string }): ReturnType<typeof findAttachment> {
    const live = this.sessionManager?.getSession(sessionId)
    const message = live?.snapshot.messages.find((item) => item.id === messageId)
      ?? live?.getQueuedMessagesEvent()?.messages.find((item) => item.id === messageId)
      ?? loadSessionMessage(sessionId, messageId)
    return message ? findAttachment(message, selector) : undefined
  }

  /** What every live session is doing, for the phone's sidebar. */
  remoteSessionActivity(): SessionActivity[] {
    const sessions: SessionActivity[] = []
    this.sessionManager?.forEachSession((session) => {
      if (!session.ephemeral) sessions.push(liveSessionActivity(session, spawnParentOf(session.id)))
    })
    return sessions
  }

  /**
   * `@` mention candidates from the asking client's own checkout and roots.
   *
   * Never the project's active session: that is whichever chat the desktop
   * last focused or sent from, and a phone in another worktree would search a
   * checkout its agent cannot see.
   */
  async remoteSearchMentions(projectPath: string, query: string, opts: { sessionId?: string; worktreePath?: string; scopeDir?: string; additionalDirs?: string[]; iconsById?: boolean }): Promise<unknown> {
    const live = opts.sessionId ? this.sessionManager?.getSession(opts.sessionId) : undefined
    const session = live?.projectPath === projectPath ? live : undefined
    const record = opts.sessionId && !live ? getSessionRecord(opts.sessionId) : null
    const cwd = session?.cwd
      ?? (record?.projectPath === projectPath ? record.worktreePath ?? projectPath : undefined)
      // A chat not created yet searches the worktree its draft picked.
      ?? (opts.worktreePath && worktreeExists(opts.worktreePath, projectPath) ? opts.worktreePath : projectPath)
    // The session already knows its extra roots; a phone would have to ask
    // for them in a separate round trip and could only ever be stale.
    const additionalDirs = opts.additionalDirs ?? session?.getAdditionalDirectoriesSnapshot()
    const { searchRemoteMentions } = await import('./remote-mention-search')
    return searchRemoteMentions(projectPath, cwd, query, {
      ...(opts.scopeDir !== undefined ? { scopeDir: opts.scopeDir } : {}),
      ...(additionalDirs?.length ? { additionalDirs } : {}),
      ...(opts.iconsById ? { iconsById: true } : {}),
    })
  }

  async remoteSearchMcpMentions(projectPath: string, sessionId: string, query: string): Promise<unknown> {
    const { searchMcpMentions } = await import('../mcp-apps/mention-search-ipc')
    return searchMcpMentions(this.mcpMentionSession(sessionId), projectPath, query)
  }

  async remoteReadMcpMentions(projectPath: string, sessionId: string, targets: Array<{ server: string; uri: string }>): Promise<{ resources: unknown }> {
    const { readMcpMentions } = await import('../mcp-apps/mention-search-ipc')
    return { resources: await readMcpMentions(this.mcpMentionSession(sessionId), projectPath, targets) }
  }

  async remoteMcpServers(projectPath: string): Promise<{ servers: unknown[] }> {
    const session = this.sessionManager?.getActiveSession(projectPath)
    return { servers: (await session?.getMcpServerStatus()) ?? [] }
  }

  /** The phone read a session: clear its unseen mark. */
  markRemoteSeen(sessionId: string): void {
    this.sessionManager?.getSession(sessionId)?.markSeen()
  }

  /** Read a host or node file over the requesting phone's authenticated transport. */
  remoteReadFile(input: PhoneFileInput, source: PhoneFileSource): Promise<unknown> {
    return readPhoneFile(input, source, this.remoteControlService)
  }

  remoteVideoPoster(input: PhoneFileInput): Promise<unknown> {
    return readPhoneVideoPoster(input)
  }

  /** Start a phone upload; `uploadId` keys its completion (`files.upload`). */
  async remoteUpload(input: Omit<Parameters<import('../remote/mobile-receive-service').MobileReceiveService['handleUploadFile']>[0], 'requestId'> & { uploadId: string }): Promise<unknown> {
    const { uploadId, ...rest } = input
    if (!this.mobileReceiveService) return { ok: false, error: 'no_transport', message: 'upload service unavailable' }
    return this.mobileReceiveService.handleUploadFile({ ...rest, requestId: uploadId })
  }

  async remoteUploadComplete(uploadId: string): Promise<unknown> {
    if (!this.mobileReceiveService) return { ok: false, error: 'no_transport', message: 'upload service unavailable' }
    return this.mobileReceiveService.handleUploadComplete({ requestId: uploadId })
  }

  /**
   * A phone's change to a project's extra folders (`project.update`). Added
   * folders are checked like `/add-dir`; deltas compose with concurrent edits.
   */
  remoteUpdateProjectDirs(projectPath: string, patch: import('@superone/shared/project-extra-dirs').ProjectExtraDirsPatch): void {
    for (const dir of patch.addExtraDirs ?? []) {
      const verdict = this.validateAddDirCandidate(projectPath, dir)
      if (!verdict.ok) throw Object.assign(new Error(`cannot add ${dir}: ${verdict.reason}`), { code: 'invalid_argument', details: { reason: verdict.reason } })
    }
    this.setProjectExtraDirs(projectPath, (dirs) => resolveProjectExtraDirs(dirs, patch) ?? dirs)
  }

  /** A host folder's entries for the phone's folder browser, directories first. */
  async remoteListDirectory(path: string, opts: { showHidden?: boolean; ignoreMode?: 'none' | 'excluded-dirs' | 'gitignore' }): Promise<{ items: Array<{ name: string; isDirectory: boolean }>; appliedIgnoreMode: string }> {
    const entries = await readdir(path, { withFileTypes: true })
    const ignoreMode = opts.ignoreMode ?? 'none'
    const ignored = ignoreMode === 'gitignore'
      ? await import('./remote-directory-ignores').then((m) => m.projectIgnoreFilter(path))
      : null
    const items = entries
      .filter((e) => opts.showHidden || !e.name.startsWith('.'))
      .filter((e) => ignoreMode === 'none' || !EXCLUDED_DIRS.has(e.name))
      .filter((e) => !ignored?.(e.name, e.isDirectory()))
      .map((e) => ({ name: e.name, isDirectory: e.isDirectory() }))
      .sort((a, b) => (a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : a.isDirectory ? -1 : 1))
    return { items, appliedIgnoreMode: ignoreMode }
  }

  /** A new folder named `name` directly inside `path`. */
  async remoteCreateDirectory(path: string, name: string): Promise<void> {
    if (name.includes('..') || name.includes('/') || name.includes('\\')) {
      throw Object.assign(new Error('Invalid directory name'), { code: 'invalid_argument' })
    }
    await mkdir(join(path, name))
  }

  /** A harness's usage meter for a phone composer (`get_usage`, `harness.usage`). */
  async remoteUsage(request: import('./harness-usage').HarnessUsageRequest): Promise<{ usage: import('@superone/shared/agent-types').RemoteUsage | null }> {
    return { usage: this.readHarnessUsage ? await this.readHarnessUsage(request) : null }
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

  /** The session MCP mentions are searched and read through; loading it is fine, the user asked. */
  private mcpMentionSession(sessionId: string): import('../session/types').Session | null {
    const mgr = this.sessionManager
    const loaded = mgr?.getSession(sessionId)
    if (!mgr || loaded) return loaded ?? null
    try { return mgr.resumeSession(sessionId, { passive: true }) } catch { return null }
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

  /** Live Claude runtimes pick up a plugin change now; released ones load it on their next start. */
  reloadLiveClaudePlugins(): void {
    this.sessionManager?.forEachSession((session) => {
      if (session.snapshot.harnessId === 'claude' && session.hasActiveRuntime()) void session.reloadPlugins()
    })
  }

  /**
   * After a Claude MCP config change on disk, by the window or any node
   * client: the project's active session turns the server on or off, and
   * reconnects a saved one so it runs the new launch config.
   */
  async mcpConfigChanged({ provider, projectPath, name, enabled, saved }: McpChange): Promise<void> {
    if (provider !== 'claude') return
    const session = this.sessionManager?.getActiveSession(projectPath)
    if (!session) return
    try { await session.toggleMcpServer(name, enabled) } catch (err) { log.debug('[agent] MCP toggle skipped:', err) }
    if (saved) {
      try { await session.reconnectMcp(name) } catch (err) { log.debug('[agent] MCP reconnect skipped:', err) }
    }
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

  private baseProviderIdForHarness(harnessId: HarnessId | undefined): string {
    return baseSessionProviderId(harnessId ?? 'claude')
  }

  private async getOrCreateActiveSession(
    projectPath: string,
    requestedSid?: string,
    hint?: {
      worktreePath?: string | null
      gitBranch?: string | null
      apiProviderId?: string | null
      provider?: HarnessId
      acpAgentId?: string | null
    },
  ): Promise<import('../session/types').Session> {
    const mgr = this.requireSessionManager()
    const cwd = sessionCreationCwd(projectPath, { ...hint, sessionId: requestedSid }, mgr.getActiveSession(projectPath))
    const gitBranch = hint?.gitBranch ?? null
    const apiProviderHint = hint?.apiProviderId ?? null
    const acpAgentHint = hint?.acpAgentId ?? null
    const providerId = this.baseProviderIdForHarness(hint?.provider)
    const shouldApplyHint = (existing: import('../session/types').Session): boolean =>
      apiProviderHint !== null && existing.snapshot.apiProviderId !== apiProviderHint
    const expectedHarness = hint?.provider
    // Every harness owns its defaults now, so this no longer special-cases
    // Claude — a harness with nothing configured still resolves to its own
    // first declared mode rather than to Claude's.
    const prefsFor = (provider: HarnessId | undefined) =>
      this.readDefaultSessionPrefs(provider ?? 'claude')

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
          log.warn('[agent-service] empty session recreated sid=%s harness=%s->%s', requestedSid, existing.snapshot.harnessId, expectedHarness)
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
            acpAgentId: acpAgentHint,
          })
        }
        mgr.setActiveSession(projectPath, requestedSid)
        if (shouldApplyHint(existing)) existing.setApiProviderId(apiProviderHint)
        if (acpAgentHint) existing.setAcpAgentId(acpAgentHint)
        await applySessionDirectoryHint(existing, hint)
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
          log.warn('[agent-service] empty session recreated sid=%s harness=%s->%s (resumed)', requestedSid, resumed.snapshot.harnessId, expectedHarness)
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
            acpAgentId: acpAgentHint,
          })
        }
        if (shouldApplyHint(resumed)) resumed.setApiProviderId(apiProviderHint)
        if (acpAgentHint) resumed.setAcpAgentId(acpAgentHint)
        await applySessionDirectoryHint(resumed, hint)
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
          acpAgentId: acpAgentHint,
        })
      }
    }
    const active = mgr.getActiveSession(projectPath)
    if (active) {
      if (shouldApplyHint(active)) active.setApiProviderId(apiProviderHint)
      if (acpAgentHint) active.setAcpAgentId(acpAgentHint)
      await applySessionDirectoryHint(active, hint)
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
      acpAgentId: acpAgentHint,
    })
  }

  private async getOrCreatePrewarmSession(
    projectPath: string,
    hint?: AgentPrewarmHint,
  ): Promise<import('../session/types').Session | null> {
    const mgr = this.requireSessionManager()
    const providerId = this.baseProviderIdForHarness(hint?.provider)
    const harnessId = hint?.provider ?? 'claude'
    const cwd = sessionCreationCwd(projectPath, hint, mgr.getActiveSession(projectPath))
    const { permissionMode, sandboxMode } = this.readDefaultSessionPrefs(harnessId)
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
          await applySessionDirectoryHint(existing, {
            worktreePath: hint.worktreePath,
          })
          return existing
        }
        if (existing.snapshot.messages.length > 0 || existing.isStreaming()) {
          log.debug('[agent-service] prewarm skipped sid=%s harness=%s expected=%s', hint.sessionId, existing.snapshot.harnessId, harnessId)
          return null
        }
        log.warn('[agent-service] prewarm recreated empty session sid=%s harness=%s->%s', hint.sessionId, existing.snapshot.harnessId, harnessId)
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
          await applySessionDirectoryHint(resumed, {
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
      await applySessionDirectoryHint(active, {
        worktreePath: hint?.worktreePath,
      })
      return active
    }
    return mgr.createSession(createOpts)
  }

  /**
   * Defaults a new session on `harnessId` starts with. Public so the
   * scheduled-send service can revive a session with the same ones.
   *
   * The permission mode is already validated against that harness's own
   * vocabulary by `sessionDefaultsForHarness`; only the sandbox still needs the
   * platform coercion, which is a fact this process owns.
   */
  readDefaultSessionPrefs(
    harnessId: HarnessId = 'claude',
  ): { permissionMode: PermissionMode; sandboxMode: SandboxMode | undefined } {
    return readDefaultSessionPrefs(harnessId)
  }

  setup(): void {
    const windowIpc = windowControlIpc(ipcMain)
    registerAgentProfileManagementIpc(windowIpc, () => this.sessionManager)

    // --- Session-scoped handlers (projectPath as first arg) ---

    windowIpc.handle(AgentIpcChannels.PREWARM, async (_event, projectPath: string, hint?: AgentPrewarmHint) => {
      if (!this.sessionManager) return
      // A remote project is executed by its node. Never instantiate a local
      // Session whose cwd is the renderer-only `remote:<connection>:<path>` key.
      if (parseRemoteProjectKey(projectPath)) return
      if (this.isRemoteLockedSession(projectPath)) return
      const session = await this.getOrCreatePrewarmSession(projectPath, hint)
      if (!session) return
      log.debug('[agent-service] prewarm sid=%s harness=%s', session.id, session.snapshot.harnessId)
      try { session.prewarm(hint) } catch (err) { log.debug('[agent-service] prewarm failed: %s', err instanceof Error ? err.message : String(err)) }
    })

    windowIpc.handle(AgentIpcChannels.START_REALTIME_VOICE, async (event, projectPath: string, sessionId: string, request: import('@superone/shared/agent-types').RealtimeVoiceStartRequest) => {
      const mgr = this.requireSessionManager()
      if (!request.attemptId) throw new Error('Voice attempt is required.')
      const existing = mgr.getSession(sessionId)
      if (existing && existing.projectPath !== projectPath) throw new Error('Session project mismatch.')
      const session = existing ?? await this.getOrCreateActiveSession(projectPath, sessionId, { provider: 'codex' })
      session.lease.assertMutation()
      const endpoint = windowVoiceEndpoint(event.sender, session)
      return mgr.realtimeVoice.start(session, endpoint, request.attemptId, preferredVoiceRequest(request, readAppSettings().agentPreference.codex.realtimeVoice))
    })

    windowIpc.handle(AgentIpcChannels.STOP_REALTIME_VOICE, (event, projectPath: string, sessionId: string, attemptId: string) => {
      const mgr = this.requireSessionManager()
      const session = mgr.getSession(sessionId)
      if (!session || session.projectPath !== projectPath) return
      session.lease.assertMutation()
      return mgr.realtimeVoice.stop(session, windowVoiceEndpoint(event.sender, session), attemptId)
    })
    windowIpc.handle(AgentIpcChannels.READY_REALTIME_VOICE, (event, projectPath: string, sessionId: string, identity: import('@superone/shared/realtime-voice').VoiceIdentity) => {
      const mgr = this.requireSessionManager()
      const session = mgr.getSession(sessionId)
      if (!session || session.projectPath !== projectPath) throw new Error('Session unavailable.')
      session.lease.assertMutation()
      readyWindowVoice(mgr, session, event.sender, identity)
    })

    windowIpc.handle(AgentIpcChannels.LOAD_REALTIME_TIMELINE, (_event, sessionId: string) => {
      return loadRealtimeTimeline(sessionId)
    })

    // A read the window makes just by showing the session: it takes no lease,
    // so looking at a session never stops a phone or controller driving it.
    windowIpc.handle(AgentIpcChannels.GET_REALTIME_TIMELINE, async (_event, projectPath: string, sessionId: string) => {
      // Remote voice history is on the node's session.load, not this SQLite.
      if (parseRemoteProjectKey(projectPath)) {
        return { segments: [], threadMessages: [], activeRealtimeSessionId: null, hasTimeline: false }
      }
      const session = await this.getOrCreateActiveSession(projectPath, sessionId, { provider: 'codex' })
      const timeline = await session.getRealtimeTimeline()
      return reconcileRealtimeTimeline(sessionId, timeline)
    })

    windowIpc.handle(AgentIpcChannels.SUGGESTED_TASK_LAUNCH_OPTIONS, async (_event, sessionId: string, taskId: string) => {
      const manager = this.sessionManager
      if (!manager) return { ok: false, error: 'Sessions are not ready yet.' }
      const { suggestedTaskLaunchOptions, suggestedTaskReply } = await import('../session/suggested-task')
      return suggestedTaskReply(async () => suggestedTaskLaunchOptions(manager, sessionId, taskId))
    })

    windowIpc.handle(AgentIpcChannels.LAUNCH_SUGGESTED_TASK, async (
      _event,
      sessionId: string,
      taskId: string,
      choice?: SuggestedTaskLaunchChoice,
    ) => {
      const manager = this.sessionManager
      if (!manager) return { ok: false, error: 'Sessions are not ready yet.' }
      manager.getSession(sessionId)?.lease.assertMutation()
      const { launchSuggestedTask, suggestedTaskReply } = await import('../session/suggested-task')
      return suggestedTaskReply(async () => ({ sessionId: await launchSuggestedTask(manager, sessionId, taskId, choice) }))
    })

    windowIpc.handle(AgentIpcChannels.ACP_GET_RATE_LIMITS, async (
      _event,
      projectPath: string,
      agentId: string,
      force?: boolean,
    ) => {
      const { getAcpRateLimits } = await import('../acp/acp-usage-service')
      return getAcpRateLimits(agentId, force ?? false)
    })

    windowIpc.handle(AgentIpcChannels.PLUGINS_RELOAD, async (_event, projectPath: string) => {
      const session = this.sessionManager?.getActiveSession(projectPath)
      if (!session) return false
      return session.reloadPlugins()
    })

    windowIpc.handle(AgentIpcChannels.LIST_DIRECTORY, async (_event, projectPath: string, relativePath: string) => {
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

    windowIpc.handle(AgentIpcChannels.VALIDATE_ADD_DIR, async (_event, projectPath: string, candidate: string) => {
      return this.validateAddDirCandidate(projectPath, candidate)
    })

    windowIpc.handle(AgentIpcChannels.LIST_DIRECTORY_FOR_ADD_DIR, async (_event, projectPath: string, rawInput: string) => {
      return this.listDirectoryForAddDir(projectPath, rawInput)
    })

    windowIpc.handle(AgentIpcChannels.FIND_LINE_NUMBER, async (_event, _projectPath: string, filePath: string, text: string) => {
      try {
        const content = readFileSync(filePath, 'utf-8')
        const idx = content.indexOf(text)
        if (idx === -1) return null
        return content.substring(0, idx).split('\n').length
      } catch {
        return null
      }
    })

    windowIpc.handle(AgentIpcChannels.SEARCH_FILES, async (_event, projectPath: string, query: string, additionalDirs?: string[]) => {
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

    windowIpc.handle(AgentIpcChannels.SEARCH_MENTIONS, async (_event, projectPath: string, query: string, agents: AgentEntry[], additionalDirs?: string[], scopeDir?: string) => {
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

    // --- Plugins (session-scoped — need cwd) ---

    windowIpc.handle(AgentIpcChannels.PLUGINS_LIST, async (_event, projectPath: string) => {
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

    windowIpc.handle(AgentIpcChannels.PLUGINS_READ, async (_event, projectPath: string, key: string) => {
      const { parseRemoteProjectKey } = await import('@superone/shared/remote-resource-key')
      if (parseRemoteProjectKey(projectPath)) {
        const { getEnvironmentHost } = await import('../environment')
        const { getRemoteManagedPlugin } = await import('../environment/remote-resources')
        return (await getRemoteManagedPlugin(getEnvironmentHost(), projectPath, key)) ?? null
      }
      return readPluginContent(projectPath, key)
    })

    windowIpc.handle(AgentIpcChannels.PLUGINS_READ_FILE, async (_event, projectPath: string, key: string, relativePath: string) => {
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

    windowIpc.handle(AgentIpcChannels.PLUGINS_DELETE, async (_event, projectPath: string, key: string, scope: ResourceScope) => {
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

    windowIpc.handle(AgentIpcChannels.PLUGINS_SET_ENABLED, async (_event, projectPath: string, key: string, scope: ResourceScope, enabled: boolean) => {
      const { parseRemoteProjectKey } = await import('@superone/shared/remote-resource-key')
      if (parseRemoteProjectKey(projectPath)) {
        if (scope !== 'user' && scope !== 'project') throw new Error('Remote plugin toggle only supports user or project scope')
        const { getEnvironmentHost } = await import('../environment')
        const { setRemotePluginEnabled } = await import('../environment/remote-resources')
        if (!(await setRemotePluginEnabled(getEnvironmentHost(), projectPath, key, scope, enabled))) throw new Error('Remote plugin toggle failed')
        return
      }
      setPluginEnabled(projectPath, key, scope, enabled)
      this.reloadLiveClaudePlugins()
    })

    // Mod review and userConfig run the local CLI against the local install; a remote node has no route for them yet.
    const modReviews = new Map<string, Promise<PluginModReview | null>>()
    windowIpc.handle(AgentIpcChannels.PLUGINS_REVIEW_MODS, async (_event, projectPath: string, key: string) => {
      const { parseRemoteProjectKey } = await import('@superone/shared/remote-resource-key')
      if (parseRemoteProjectKey(projectPath)) return null
      const plugin = listPlugins(projectPath).find((p) => p.key === key)
      const binary = plugin?.hasMod ? tryResolveHarnessRuntime('claude') : null
      if (!plugin || !binary) return null
      const cacheKey = `${plugin.installPath}@${plugin.version ?? ''}`
      let review = modReviews.get(cacheKey)
      if (!review) modReviews.set(cacheKey, (review = reviewPluginMods(binary, plugin.installPath)))
      const result = await review
      if (!result) modReviews.delete(cacheKey)
      return result
    })
    windowIpc.handle(AgentIpcChannels.PLUGINS_READ_CONFIG, async (_event, projectPath: string, key: string) => {
      const { parseRemoteProjectKey } = await import('@superone/shared/remote-resource-key')
      return parseRemoteProjectKey(projectPath) ? null : readPluginUserConfig(projectPath, key)
    })
    windowIpc.handle(AgentIpcChannels.PLUGINS_SAVE_CONFIG, async (_event, projectPath: string, key: string, values: Record<string, unknown>) => {
      const { parseRemoteProjectKey } = await import('@superone/shared/remote-resource-key')
      if (parseRemoteProjectKey(projectPath)) throw new Error('Plugin options of a remote project are not editable yet')
      savePluginUserConfig(key, values)
      this.reloadLiveClaudePlugins()
    })

    windowIpc.handle(AgentIpcChannels.PLUGINS_LIST_MARKETPLACE, async (_event, projectPath: string) => {
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

    windowIpc.handle(AgentIpcChannels.PLUGINS_INSTALL, async (_event, projectPath: string, key: string, scope: ResourceScope) => {
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

    windowIpc.handle(AgentIpcChannels.PLUGINS_UPDATE, async (_event, projectPath: string, updates: Array<{ key: string; scope: ResourceScope }>) => {
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

    windowIpc.handle(AgentIpcChannels.PLUGINS_UPDATE_MARKETPLACE, async (_event, name: string) => {
      await updateMarketplace(name)
    })

    windowIpc.handle(AgentIpcChannels.PLUGINS_GITHUB_STARS, async (_event, repoSlug: string) => {
      return getGithubStars(repoSlug)
    })

    windowIpc.handle(AgentIpcChannels.PLUGINS_GITHUB_SEARCH_REPOS, async (_event, owner: string) => {
      return listGithubReposForOwner(owner)
    })

    windowIpc.handle(AgentIpcChannels.PLUGINS_GITHUB_QUERY_REPOS, async (_event, query: string) => {
      return searchGithubRepositories(typeof query === 'string' ? query : '')
    })

    windowIpc.handle(
      AgentIpcChannels.PLUGINS_GITHUB_LIST_MY_REPOS,
      async (_event, page?: number, perPage?: number) => {
        return listMyGithubRepos(
          typeof page === 'number' ? page : 1,
          typeof perPage === 'number' ? perPage : 20,
        )
      },
    )

    windowIpc.handle(AgentIpcChannels.CACHE_IMAGE, async (_event, url: string) => {
      return cacheRemoteImage(url)
    })

    windowIpc.handle(AgentIpcChannels.RESOLVE_FAVICON, async (_event, url: string, isDark: boolean, force?: boolean) => {
      return resolveFavicon(url, isDark, force)
    })

    windowIpc.handle(AgentIpcChannels.RESOLVE_LINK_PREVIEW, async (_event, url: string) => {
      const { resolveLinkPreview } = await import('../link-preview')
      return resolveLinkPreview(url)
    })

    windowIpc.handle(AgentIpcChannels.RESOLVE_SITE_IDENTITY, async (_event, url: string, isDark: boolean, force?: boolean) => {
      return resolveSiteIdentity(url, isDark, force)
    })

    windowIpc.handle(AgentIpcChannels.CACHE_FAVICON, async (_event, pageUrl: string, faviconUrl: string, isDark: boolean) => {
      await cacheCapturedFavicon(pageUrl, faviconUrl, isDark)
    })

    windowIpc.handle(AgentIpcChannels.PLUGINS_ADD_MARKETPLACE, async (_event, source: string, scope: ResourceScope, projectPath: string) => {
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

    windowIpc.handle(AgentIpcChannels.PLUGINS_REMOVE_MARKETPLACE, async (_event, name: string, scope: 'user' | 'project' | 'local' | 'official', projectPath: string) => {
      const { parseRemoteProjectKey } = await import('@superone/shared/remote-resource-key')
      if (parseRemoteProjectKey(projectPath)) {
        if (scope !== 'user' && scope !== 'project') {
          throw new Error('Remote marketplace remove only supports user or project scope')
        }
        const { getEnvironmentHost } = await import('../environment')
        const { removeRemoteMarketplace } = await import('../environment/remote-resources')
        const ok = await removeRemoteMarketplace(getEnvironmentHost(), projectPath, name, scope)
        if (!ok) throw new Error('Remote marketplace remove failed')
        return
      }
      await removeMarketplace(name, scope, projectPath)
    })

    windowIpc.handle(AgentIpcChannels.PLUGINS_READ_MARKETPLACE, (_event, marketplace: string, name: string) => {
      return readMarketplacePluginContent(marketplace, name)
    })

    windowIpc.handle(AgentIpcChannels.PLUGINS_READ_MARKETPLACE_FILE, (_event, marketplace: string, name: string, relativePath: string) => {
      return readMarketplacePluginFile(marketplace, name, relativePath)
    })

    // --- Skills (session-scoped) ---

    windowIpc.handle(AgentIpcChannels.SKILLS_LIST, async (_event, projectPath: string) => {
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

    windowIpc.handle(AgentIpcChannels.SLASH_RESOURCES_LIST, async (_event, projectPath: string) => {
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

    windowIpc.handle(AgentIpcChannels.SKILLS_READ, async (_event, projectPath: string, name: string, sourcePath?: string) => {
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

    windowIpc.handle(AgentIpcChannels.SKILLS_READ_FILE, async (_event, projectPath: string, skillName: string, relativePath: string, sourcePath?: string) => {
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

    windowIpc.handle(AgentIpcChannels.SKILLS_INSTALL, (_event, sourcePath: string) => {
      return installSkill(sourcePath)
    })

    windowIpc.handle(AgentIpcChannels.SKILLS_DELETE, async (_event, projectPath: string, sourcePath: string) => {
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

    windowIpc.handle(AgentIpcChannels.SKILLS_TOGGLE, (_event, name: string, disabled: boolean): string[] => {
      const current = readAppSettings().agentPreference.claude.disabledSkills
      const next = disabled
        ? Array.from(new Set([...current, name]))
        : current.filter((n) => n !== name)
      saveAppSettings({ agentPreference: { claude: { disabledSkills: next } } })
      return next
    })

    // --- Codex Skills (read-only) ---

    windowIpc.handle(AgentIpcChannels.CODEX_SKILLS_LIST, async (_event, projectPath: string, opts?: { forceReload?: boolean }) => {
      const { parseRemoteProjectKey } = await import('@superone/shared/remote-resource-key')
      // Remote projects: do not scan local ~/.codex/skills for a remote: key.
      if (parseRemoteProjectKey(projectPath)) return []
      return getSharedCodexSkillsService().list(projectPath, opts)
    })

    windowIpc.handle(AgentIpcChannels.CODEX_SKILLS_TOGGLE, async (_event, projectPath: string, selector: { name?: string; path?: string }, enabled: boolean) => {
      const { parseRemoteProjectKey } = await import('@superone/shared/remote-resource-key')
      if (parseRemoteProjectKey(projectPath)) throw new Error('Remote Codex skill toggle is not yet supported')
      return getSharedCodexSkillsService().setEnabled(projectPath, selector, enabled)
    })

    windowIpc.handle(AgentIpcChannels.CODEX_SKILLS_READ, async (_event, projectPath: string, name: string, sourcePath?: string) => {
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

    windowIpc.handle(AgentIpcChannels.CODEX_SKILLS_READ_FILE, async (_event, projectPath: string, skillName: string, relativePath: string, sourcePath?: string) => {
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

    windowIpc.handle(AgentIpcChannels.CODEX_SKILLS_DELETE, async (_event, projectPath: string, sourcePath: string) => {
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

    windowIpc.handle(AgentIpcChannels.CODEX_MCP_LIST_CONFIG, async (_event, projectPath: string) => {
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

    // --- dsh MCP config ---

    windowIpc.handle(AgentIpcChannels.DSH_MCP_LIST_CONFIG, async (_event, projectPath: string) => {
      const { parseRemoteProjectKey } = await import('@superone/shared/remote-resource-key')
      if (parseRemoteProjectKey(projectPath)) {
        try {
          const { getEnvironmentHost } = await import('../environment')
          const { listRemoteManagedMcp } = await import('../environment/remote-resources')
          return (await listRemoteManagedMcp(getEnvironmentHost(), projectPath, 'dsh')) ?? []
        } catch {
          return []
        }
      }
      return listDshMcpConfigs(projectPath)
    })

    windowIpc.handle(AgentIpcChannels.DSH_MCP_SAVE_CONFIG, async (_event, projectPath: string, name: string, config: Record<string, unknown>, scope: ResourceScope) => {
      if (scope !== 'user') throw new Error('dsh MCP save only supports user scope')
      const { parseRemoteProjectKey } = await import('@superone/shared/remote-resource-key')
      if (parseRemoteProjectKey(projectPath)) {
        const { getEnvironmentHost } = await import('../environment')
        const { saveRemoteManagedMcp } = await import('../environment/remote-resources')
        const ok = await saveRemoteManagedMcp(getEnvironmentHost(), projectPath, {
          provider: 'dsh',
          name,
          scope,
          config,
        })
        if (!ok) throw new Error('Remote dsh MCP save failed')
        return
      }
      saveDshMcpConfig(name, config, scope, projectPath)
    })

    windowIpc.handle(AgentIpcChannels.DSH_MCP_DELETE_CONFIG, async (_event, projectPath: string, name: string, scope: ResourceScope) => {
      if (scope !== 'user') throw new Error('dsh MCP delete only supports user scope')
      const { parseRemoteProjectKey } = await import('@superone/shared/remote-resource-key')
      if (parseRemoteProjectKey(projectPath)) {
        const { getEnvironmentHost } = await import('../environment')
        const { deleteRemoteManagedMcp } = await import('../environment/remote-resources')
        const ok = await deleteRemoteManagedMcp(getEnvironmentHost(), projectPath, {
          provider: 'dsh',
          name,
          scope,
        })
        if (!ok) throw new Error('Remote dsh MCP delete failed')
        return
      }
      deleteDshMcpConfig(name, scope, projectPath)
    })

    windowIpc.handle(AgentIpcChannels.DSH_MCP_TOGGLE_CONFIG, async (_event, projectPath: string, name: string, disabled: boolean, scope: ResourceScope) => {
      if (scope !== 'user') throw new Error('dsh MCP toggle only supports user scope')
      const { parseRemoteProjectKey } = await import('@superone/shared/remote-resource-key')
      if (parseRemoteProjectKey(projectPath)) {
        const { getEnvironmentHost } = await import('../environment')
        const { toggleRemoteManagedMcp } = await import('../environment/remote-resources')
        const ok = await toggleRemoteManagedMcp(getEnvironmentHost(), projectPath, {
          provider: 'dsh',
          name,
          scope,
          disabled,
        })
        if (!ok) throw new Error('Remote dsh MCP toggle failed')
        return
      }
      toggleDshMcpConfig(name, disabled, scope, projectPath)
    })

    // --- dsh third-party plugins ---
    //
    // Imported lazily: the plugin service pulls in @superone/deepseek, and a
    // build with no dsh session should not pay for it at startup.

    windowIpc.handle(AgentIpcChannels.DSH_PLUGIN_LIST, async () => {
      const { listDshPlugins } = await import('../deepseek/deepseek-plugins')
      return await listDshPlugins()
    })

    windowIpc.handle(AgentIpcChannels.DSH_PLUGIN_INSTALL, async (_event, source: DshPluginInstallSource, force?: boolean) => {
      const { installDshPlugin } = await import('../deepseek/deepseek-plugins')
      return await installDshPlugin(source, force === true)
    })

    windowIpc.handle(AgentIpcChannels.DSH_PLUGIN_SET_DISABLED, async (_event, id: string, disabled: boolean) => {
      const { setDshPluginDisabled } = await import('../deepseek/deepseek-plugins')
      return await setDshPluginDisabled(id, disabled)
    })

    windowIpc.handle(AgentIpcChannels.DSH_PLUGIN_UNINSTALL, async (_event, id: string) => {
      const { uninstallDshPlugin } = await import('../deepseek/deepseek-plugins')
      return await uninstallDshPlugin(id)
    })

    // --- Agents (read-only) ---

    windowIpc.handle(AgentIpcChannels.AGENTS_LIST, async (_event, projectPath: string) => {
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

    windowIpc.handle(AgentIpcChannels.AGENTS_READ_FILE, async (_event, projectPath: string, name: string) => {
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

    windowIpc.handle(AgentIpcChannels.MCP_LIST_CONFIG, async (_event, projectPath: string) => {
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

    windowIpc.handle(AgentIpcChannels.MCP_SAVE_CONFIG, async (_event, projectPath: string, name: string, config: Record<string, unknown>, scope: ResourceScope) => {
      if (scope !== 'user' && scope !== 'project') throw new Error('MCP save only supports user or project scope')
      const { parseRemoteProjectKey } = await import('@superone/shared/remote-resource-key')
      if (parseRemoteProjectKey(projectPath)) {
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
      await this.mcpConfigChanged({ provider: 'claude', projectPath, name, enabled: true, saved: true })
    })

    windowIpc.handle(AgentIpcChannels.MCP_DELETE_CONFIG, async (_event, projectPath: string, name: string, scope: ResourceScope) => {
      if (scope !== 'user' && scope !== 'project') throw new Error('MCP delete only supports user or project scope')
      const { parseRemoteProjectKey } = await import('@superone/shared/remote-resource-key')
      if (parseRemoteProjectKey(projectPath)) {
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
      await this.mcpConfigChanged({ provider: 'claude', projectPath, name, enabled: false, saved: false })
    })

    windowIpc.handle(AgentIpcChannels.MCP_TOGGLE_CONFIG, async (_event, projectPath: string, name: string, disabled: boolean, scope: ResourceScope) => {
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
      await this.mcpConfigChanged({ provider: 'claude', projectPath, name, enabled: !disabled, saved: false })
    })

    // Claude Code re-reads changed settings files, so running sessions pick
    // these rules up without a reconnect. Remote nodes do not serve them yet.
    windowIpc.handle(AgentIpcChannels.MCP_LIST_TOOL_PERMISSIONS, async (_event, projectPath: string) => {
      const { parseRemoteProjectKey } = await import('@superone/shared/remote-resource-key')
      if (parseRemoteProjectKey(projectPath)) return {}
      return listMcpToolPermissions(projectPath)
    })

    windowIpc.handle(AgentIpcChannels.MCP_SET_TOOL_PERMISSION, async (_event, projectPath: string, serverName: string, toolName: string, permission: McpToolPermission | null, scope: ResourceScope) => {
      const { parseRemoteProjectKey } = await import('@superone/shared/remote-resource-key')
      if (parseRemoteProjectKey(projectPath)) throw new Error('MCP tool permissions are not supported on remote projects')
      setMcpToolPermission(projectPath, serverName, toolName, permission, scope)
    })

    windowIpc.handle(AgentIpcChannels.MCP_CHECK_SERVERS, async (_event, projectPath: string, harness?: HarnessId) => {
      // Source the configs for the requesting harness so a Codex session probes
      // codex config.toml (not Claude's MCP config) and vice-versa. Falls back to the
      // active session's harness, then Claude (the settings page passes no harness).
      const resolvedHarness = harness ?? this.sessionManager?.getActiveSession(projectPath)?.snapshot.harnessId ?? 'claude'
      const configs = resolvedHarness === 'codex'
        ? listCodexMcpConfigs(projectPath)
        // dsh keeps its servers in its own profile patch layer, not the shared
        // Claude-shaped files the other harnesses read.
        : resolvedHarness === 'dsh'
          ? listDshMcpConfigs(projectPath)
          : listMcpConfigs(projectPath)
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

    windowIpc.handle(AgentIpcChannels.MCP_META_CACHE, async () => {
      return readMcpMetaCache()
    })

    windowIpc.handle(AgentIpcChannels.MCP_PROBE_ICONS, async (_event, projectPath: string) => {
      const { probeMcpIconsForAllHarnesses } = await import('../mcp-server-icons')
      await probeMcpIconsForAllHarnesses(typeof projectPath === 'string' ? projectPath : '')
    })

    windowIpc.handle(AgentIpcChannels.MCP_OAUTH_AUTHORIZE, async (_event, serverUrl: string, headers?: Record<string, string>, transport?: 'http' | 'sse') => {
      return authorizeHttpMcpServer(serverUrl, headers, transport)
    })

    // --- Hooks config (settings.json#hooks) ---

    windowIpc.handle(AgentIpcChannels.HOOKS_LIST, async (_event, projectPath: string) => {
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

    windowIpc.handle(AgentIpcChannels.HOOKS_SAVE, async (_event, projectPath: string, payload: HookSavePayload, replaceId?: string) => {
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

    windowIpc.handle(AgentIpcChannels.HOOKS_DELETE, async (_event, projectPath: string, id: string) => {
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

    windowIpc.handle(AgentIpcChannels.PLATFORMS_LIST, () => getPlatforms())
    windowIpc.handle(AgentIpcChannels.PLATFORMS_CREATE_CUSTOM, (_event, def: Platform) => upsertCustomPlatform(def))
    windowIpc.handle(AgentIpcChannels.PLATFORMS_UPDATE_CUSTOM, (_event, def: Platform) => upsertCustomPlatform(def))
    windowIpc.handle(AgentIpcChannels.PLATFORMS_DELETE_CUSTOM, (_event, id: string) => {
      const ok = deleteCustomPlatform(id)
      this.providerConfigChanged()
      return ok
    })

    windowIpc.handle(AgentIpcChannels.CREDENTIALS_LIST, () => listCredentials())
    windowIpc.handle(AgentIpcChannels.CREDENTIALS_CREATE, (_event, input: CreateCredentialInput) => createCredential(input))
    windowIpc.handle(AgentIpcChannels.CREDENTIALS_UPDATE, (_event, id: string, patch: UpdateCredentialInput) => {
      const result = updateCredential(id, patch)
      this.providerConfigChanged()
      return result
    })
    windowIpc.handle(AgentIpcChannels.CREDENTIALS_DELETE, (_event, id: string) => {
      const ok = deleteCredential(id)
      this.providerConfigChanged()
      return ok
    })

    windowIpc.handle(AgentIpcChannels.BINDINGS_GET, () => listBindings())
    windowIpc.handle(AgentIpcChannels.BINDINGS_SET, (_event, binding: ConsumerBinding) => {
      log.info('[bindings] set consumer=%s credential=%s', binding.consumer, binding.credentialId)
      setBinding(binding)
      this.providerBindingChanged(binding.consumer)
    })
    windowIpc.handle(AgentIpcChannels.BINDINGS_CLEAR, (_event, consumer: ConsumerId) => {
      log.info('[bindings] clear consumer=%s', consumer)
      deleteBinding(consumer)
      this.providerBindingChanged(consumer)
    })

    windowIpc.handle(AgentIpcChannels.PROVIDERS_TEST_ENDPOINT, async (_event, data: { apiKey: string; credentialId?: string; baseUrl: string; endpoints: ServiceEndpoint[] }) => {
      const apiKey = resolveTestApiKey({ api_key: data.apiKey, credential_id: data.credentialId })
      const results = await testServiceEndpoints(data.baseUrl, data.endpoints, apiKey)
      trace('providers.test', 'result', results)
      return { success: results.every((r) => r.success), results }
    })

    windowIpc.handle(AgentIpcChannels.PROVIDERS_DISCOVER_MODELS, async (_event, data: { apiKey: string; credentialId?: string; baseUrl: string }) => {
      const apiKey = resolveTestApiKey({ api_key: data.apiKey, credential_id: data.credentialId })
      const catalogIndex = await this.buildDiscoveryCatalogIndex()
      const result = await discoverModels(data.baseUrl, apiKey, catalogIndex)
      trace('providers.discover', 'result', result)
      return result
    })

    // Cache-only. Detection / model probes run on app open (see main process startup).
    windowIpc.handle(AgentIpcChannels.ACP_LIST_AGENTS, async () => {
      const { readAcpResourcesCache } = await import('../acp/acp-model-cache')
      return readAcpResourcesCache()
    })

    // Once-per-launch model catalog refresh for installed ACP agents.
    windowIpc.handle(AgentIpcChannels.ACP_REFRESH_MODELS, async (_event, agentId?: string) => {
      const { refreshAcpModelsOnce } = await import('../acp/acp-model-cache')
      return refreshAcpModelsOnce(agentId ? { agentIds: [agentId] } : undefined)
    })

    // Observation, not configuration: Grok applies its sandbox at process start
    // from env / its own config, and SuperOne never sets it. Read so the status
    // bar can report the real state instead of assuming `off`.
    windowIpc.handle(AgentIpcChannels.ACP_GET_SANDBOX, async () => {
      const { currentGrokSandbox } = await import('../acp/grok-sandbox')
      return currentGrokSandbox()
    })

    // --- Session Providers (new session_providers table) ---

    windowIpc.handle(AgentIpcChannels.SESSION_PROVIDERS_LIST, async () => {
      const { listSessionProviders } = await import('../session/session-provider-repo')
      const enabled = isAgentProfilesEnabled()
      return listSessionProviders().filter((row) => enabled || !readAgentProfile(row.config))
    })

    // Composer @-mention list. Derived from the same usable-provider set as
    // session_collab_list_agents, so the popup can never offer an agent that
    // session_collab_request would reject.
    windowIpc.handle(AgentIpcChannels.SESSION_PROVIDERS_MENTION_TARGETS, async () => {
      const { listAgentMentionTargets } = await import('../session/agent-profiles')
      return listAgentMentionTargets()
    })

    windowIpc.handle(AgentIpcChannels.SESSION_PROVIDERS_LIST_BY_HARNESS, async (_event, harnessId: 'claude' | 'codex') => {
      const { listByHarness } = await import('../session/session-provider-repo')
      return listByHarness(harnessId)
    })

    windowIpc.handle(AgentIpcChannels.SESSION_PROVIDERS_GET, async (_event, id: string) => {
      const { getSessionProvider } = await import('../session/session-provider-repo')
      return getSessionProvider(id)
    })

    windowIpc.handle(AgentIpcChannels.SESSION_PROVIDERS_GET_BASE, async (_event, harnessId: 'claude' | 'codex') => {
      const { getBaseProvider } = await import('../session/session-provider-repo')
      return getBaseProvider(harnessId)
    })

    windowIpc.handle(AgentIpcChannels.SESSION_PROVIDERS_CREATE, async (_event, input: { harnessId: 'claude' | 'codex'; name: string; config: unknown; id?: string }) => {
      const { createSessionProvider } = await import('../session/session-provider-repo')
      return createSessionProvider(input)
    })

    windowIpc.handle(AgentIpcChannels.SESSION_PROVIDERS_UPDATE, async (_event, id: string, patch: { name?: string; config?: unknown }) => {
      const { updateSessionProvider } = await import('../session/session-provider-repo')
      return updateSessionProvider(id, patch)
    })

    windowIpc.handle(AgentIpcChannels.SESSION_PROVIDERS_DELETE, async (_event, id: string) => {
      const { deleteSessionProvider } = await import('../session/session-provider-repo')
      return deleteSessionProvider(id)
    })

    // --- MCP library (global) ---

    windowIpc.handle(AgentIpcChannels.MCP_LIST_LIBRARY, () => {
      return listLibrary()
    })

    windowIpc.handle(AgentIpcChannels.MCP_DELETE_LIBRARY_ENTRY, async (_event, name: string) => {
      const entry = getLibraryEntry(name)
      if (entry?.bundleId) {
        await uninstallMcpbBundle(name)
      }
      deleteLibraryEntry(name)
    })

    // --- Session history (session-scoped) ---

    windowIpc.handle(AgentIpcChannels.PARK_SESSION, async (_event, projectPath: string) => {
      const mgr = this.requireSessionManager()
      mgr.clearActiveSession(projectPath)
      // Parking has no harness to speak of, and every caller discards this
      // reply — it is kept only so the IPC contract stays stable.
      const { permissionMode, sandboxMode } = this.readDefaultSessionPrefs()
      const sandboxInfo = sandboxMode !== undefined
        ? { enabled: sandboxMode !== 'off', autoAllowBash: sandboxMode === 'auto' }
        : { enabled: true, autoAllowBash: false }
      return { permissionMode, sandboxInfo }
    })

    // A window shows this session: bring its runtime up in its stored worktree
    // and make it the project's active one. A draft the host has not seen yet
    // answers nothing.
    windowIpc.handle(AgentIpcChannels.ACTIVATE_SESSION, async (_event, projectPath: string, sessionId: string, worktreeCwd?: string) => {
      // A node runs its own sessions; this computer has no runtime to bring up for one.
      if (parseRemoteProjectKey(projectPath)) return undefined
      const mgr = this.requireSessionManager()
      let session = mgr.getSession(sessionId)
      if (!session) {
        const harnessId = readSessionHarnessId(sessionId)
        if (!harnessId) return undefined
        // A stored session resumes on its own harness, so its defaults come from
        // there. A failure to resume one reaches the window.
        const defaults = this.readDefaultSessionPrefs(harnessId)
        session = mgr.resumeSession(sessionId, { permissionMode: defaults.permissionMode, sandboxMode: defaults.sandboxMode })
      }
      if (worktreeCwd && session.cwd !== worktreeCwd && existsSync(worktreeCwd)) {
        await session.applyWorktreeSelection(worktreeCwd)
      }
      try { mgr.setActiveSession(projectPath, sessionId) } catch { /* belongs to another project */ }
      return {
        permissionMode: session.getCurrentPermissionMode(),
        sandboxInfo: session.getCurrentSandboxInfo(),
      }
    })

    windowIpc.handle(AgentIpcChannels.SET_SESSION_FOREGROUND, (event, sessionId: string, foreground: boolean, projectPath?: string) => {
      this.requireSessionManager().setSessionForeground(sessionId, foreground)
      const environmentId = (projectPath && parseRemoteProjectKey(projectPath)?.connectionId) || localSessionEnvironmentId()
      this.sessionForegroundListener?.(event.sender.id, { environmentId, sessionId }, foreground, event.sender)
    })

    windowIpc.handle(AgentIpcChannels.GET_LIVE_SNAPSHOTS, () => {
      return this.requireSessionManager().listLiveSnapshots()
    })

  }

  private emitSessionsChanged(): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(AgentIpcChannels.SESSIONS_CHANGED)
    }
  }

  async applyWorktreeSelection(projectPath: string, newCwd: string, gitBranch?: string | null): Promise<void> {
    const mgr = this.sessionManager
    if (!mgr) return
    const session = mgr.getActiveSession(projectPath)
    if (!session) return
    await session.applyWorktreeSelection(newCwd, gitBranch)
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

    ipcMain.removeHandler(AgentIpcChannels.PREWARM)
    ipcMain.removeHandler(AgentIpcChannels.START_REALTIME_VOICE)
    ipcMain.removeHandler(AgentIpcChannels.STOP_REALTIME_VOICE)
    ipcMain.removeHandler(AgentIpcChannels.LOAD_REALTIME_TIMELINE)
    ipcMain.removeHandler(AgentIpcChannels.GET_REALTIME_TIMELINE)
    ipcMain.removeHandler(AgentIpcChannels.LAUNCH_SUGGESTED_TASK)
    ipcMain.removeHandler(AgentIpcChannels.SUGGESTED_TASK_LAUNCH_OPTIONS)
    ipcMain.removeHandler(AgentIpcChannels.PLUGINS_RELOAD)
    ipcMain.removeHandler(AgentIpcChannels.LIST_DIRECTORY)
    ipcMain.removeHandler(AgentIpcChannels.LIST_DIRECTORY_FOR_ADD_DIR)
    ipcMain.removeHandler(AgentIpcChannels.VALIDATE_ADD_DIR)
    ipcMain.removeHandler(AgentIpcChannels.FIND_LINE_NUMBER)
    ipcMain.removeHandler(AgentIpcChannels.SEARCH_FILES)
    ipcMain.removeHandler(AgentIpcChannels.SEARCH_MENTIONS)
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
    ipcMain.removeHandler(AgentIpcChannels.PLUGINS_GITHUB_QUERY_REPOS)
    ipcMain.removeHandler(AgentIpcChannels.PLUGINS_GITHUB_LIST_MY_REPOS)
    ipcMain.removeHandler(AgentIpcChannels.CACHE_IMAGE)
    ipcMain.removeHandler(AgentIpcChannels.SKILLS_LIST)
    ipcMain.removeHandler(AgentIpcChannels.SLASH_RESOURCES_LIST)
    ipcMain.removeHandler(AgentIpcChannels.SKILLS_READ)
    ipcMain.removeHandler(AgentIpcChannels.SKILLS_READ_FILE)
    ipcMain.removeHandler(AgentIpcChannels.SKILLS_INSTALL)
    ipcMain.removeHandler(AgentIpcChannels.SKILLS_DELETE)
    ipcMain.removeHandler(AgentIpcChannels.CODEX_SKILLS_LIST)
    ipcMain.removeHandler(AgentIpcChannels.CODEX_SKILLS_TOGGLE)
    ipcMain.removeHandler(AgentIpcChannels.CODEX_HOOKS_LIST)
    ipcMain.removeHandler(AgentIpcChannels.CODEX_MCP_STATUS)
    ipcMain.removeHandler(AgentIpcChannels.CODEX_SKILLS_READ)
    ipcMain.removeHandler(AgentIpcChannels.CODEX_SKILLS_READ_FILE)
    ipcMain.removeHandler(AgentIpcChannels.CODEX_SKILLS_DELETE)
    ipcMain.removeHandler(AgentIpcChannels.CODEX_MCP_LIST_CONFIG)
    ipcMain.removeHandler(AgentIpcChannels.DSH_MCP_LIST_CONFIG)
    ipcMain.removeHandler(AgentIpcChannels.DSH_MCP_SAVE_CONFIG)
    ipcMain.removeHandler(AgentIpcChannels.DSH_MCP_DELETE_CONFIG)
    ipcMain.removeHandler(AgentIpcChannels.DSH_MCP_TOGGLE_CONFIG)
    ipcMain.removeHandler(AgentIpcChannels.DSH_PLUGIN_LIST)
    ipcMain.removeHandler(AgentIpcChannels.DSH_PLUGIN_INSTALL)
    ipcMain.removeHandler(AgentIpcChannels.DSH_PLUGIN_SET_DISABLED)
    ipcMain.removeHandler(AgentIpcChannels.DSH_PLUGIN_UNINSTALL)
    ipcMain.removeHandler(AgentIpcChannels.AGENTS_LIST)
    ipcMain.removeHandler(AgentIpcChannels.AGENTS_READ_FILE)
    ipcMain.removeHandler(AgentIpcChannels.MCP_LIST_CONFIG)
    ipcMain.removeHandler(AgentIpcChannels.MCP_SAVE_CONFIG)
    ipcMain.removeHandler(AgentIpcChannels.MCP_DELETE_CONFIG)
    ipcMain.removeHandler(AgentIpcChannels.MCP_TOGGLE_CONFIG)
    ipcMain.removeHandler(AgentIpcChannels.MCP_CHECK_SERVERS)
    ipcMain.removeHandler(AgentIpcChannels.MCP_META_CACHE)
    ipcMain.removeHandler(AgentIpcChannels.MCP_PROBE_ICONS)
    ipcMain.removeHandler(AgentIpcChannels.MCP_OAUTH_AUTHORIZE)
    ipcMain.removeHandler(AgentIpcChannels.MCP_LIST_LIBRARY)
    ipcMain.removeHandler(AgentIpcChannels.MCP_DELETE_LIBRARY_ENTRY)
    ipcMain.removeHandler(AgentIpcChannels.HOOKS_LIST)
    ipcMain.removeHandler(AgentIpcChannels.HOOKS_SAVE)
    ipcMain.removeHandler(AgentIpcChannels.HOOKS_DELETE)
    unregisterAgentProfileManagementIpc(ipcMain)
    ipcMain.removeHandler(AgentIpcChannels.SESSION_PROVIDERS_LIST)
    ipcMain.removeHandler(AgentIpcChannels.SESSION_PROVIDERS_MENTION_TARGETS)
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
  }
}
