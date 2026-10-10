
import { codexAccountStore } from '../codex/codex-account-store'
import { resolveProjectExtraDirs } from '@superone/shared/project-extra-dirs'
import { findAttachment } from '../remote/attachment-thumbnail'
import { readPhoneFile, readPhoneVideoPoster, type PhoneFileInput, type PhoneFileSource } from '../remote/phone-files'
import type { SessionActivity } from '@superone/shared/session-activity'
import { liveSessionActivity } from '../remote/live-session-activity'
import { spawnParentOf } from '../session/collaboration-mailbox'
import { enqueueSessionQueueOp, queuedSteerCommand } from '../session/session-queue'
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
import { AgentIpcChannels, type AgentEvent, type AgentPrewarmHint, type CodexPermissionPreset, type CodexReasoningEffort, type ModelOption, type PermissionMode, type QuestionAnnotations, type ResourceScope, type SandboxMode, type SendMessageRequest } from '@superone/shared/agent-types';
import { baseSessionProviderId } from '@superone/shared/session-provider-definitions'
import { parseRemoteProjectKey } from '@superone/shared/remote-resource-key'
import { localSessionEnvironmentId } from '../environment/session-identity'
import type { RemoteControlService } from '../remote-control-service'
import { trace } from './event-trace'
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
import { worktreeExists } from '../git/worktree-alive'
import { coerceSandboxModeForCapability, getSandboxCapability } from '../sandbox-platform'
import { searchFiles, searchMentions, EXCLUDED_DIRS, type AgentEntry } from './fuzzy-file-search'
import { type Session as SessionContract } from '../session/types';
import { installAcpRecapFocus } from '../acp/acp-recap-focus';
import { harnessProviderCatalog } from './remote-selector-catalog'
import { claudeAccountStore } from './claude-account-store'
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
import { listSessionsForFolder, createSession, createAutomationSession, renameSession as dbRenameSession, loadSessionState, loadSessionMessage, deleteSession as dbDeleteSession, deleteSessionsOlderThan as dbDeleteSessionsOlderThan, pinSession as dbPinSession, hideSession as dbHideSession, listPinnedSessions, readSessionHarnessId } from '../db-sessions';
import { loadSessionMessages } from '../session-history'
import { listMcpConfigs, saveMcpConfig, deleteMcpConfig, toggleMcpConfig } from '../mcp-config-service'
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
import type { PluginModReview, HookSavePayload, SessionForkRequest, SideChatStartRequest, HarnessId, DshPluginInstallSource, ClaudeSteerPriority } from '@superone/shared/agent-types'
import { tryResolveHarnessRuntime } from '../harness/resolve-runtime'
import { forkSession } from '../session/session-fork'
import { closeSideChat, startSideChat } from '../session/side-chat'
import { composerOpenResult, InputRequestOpenError, openWidgetInputRequest, type OpenedInputRequest } from '../session/input-requests';
import { awaitComposerForm, cancelComposerForms, openComposerForm, releaseComposerClient, type ComposerClient } from '../session/composer-delivery';
import type { MiniAppInputRequest } from '../miniapp/miniapp-input-requests'
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
  private codexConsumeRateLimitReset?: (projectPath: string, apiProviderId: string | null, creditId: string | null) => Promise<import('@superone/shared/agent-types').CodexRateLimitResetOutcome | null>
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

  setCodexConsumeRateLimitReset(fn: NonNullable<typeof this.codexConsumeRateLimitReset>): void {
    this.codexConsumeRateLimitReset = fn
  }

  setRemoteControlService(svc: RemoteControlService): void {
    this.remoteControlService = svc
  }

  private openMiniAppForm?: (request: MiniAppInputRequest) => OpenedInputRequest
  /** Opens a mini-app WebView's form with the same rules as its MiniApp Host. */
  setMiniAppFormOpener(open: (request: MiniAppInputRequest) => OpenedInputRequest): void {
    this.openMiniAppForm = open
  }

  private readonly composerWindows = new Set<number>()

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

  /** A window's forms close with its page (reload or close): their answers have nowhere else to go. */
  private composerWindow(sender: Electron.WebContents): ComposerClient {
    const client: ComposerClient = { kind: 'window', id: sender.id }
    if (!this.composerWindows.has(sender.id)) {
      this.composerWindows.add(sender.id)
      const release = () => releaseComposerClient(client)
      sender.on('did-navigate', release)
      sender.once('destroyed', () => {
        this.composerWindows.delete(client.id)
        release()
      })
    }
    return client
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
          selectedProviderId: resolveChatService(harnessId, null, options)?.credentialId ?? (harnessId === 'codex' ? codexAccountStore().defaultProviderId() : claudeAccountStore().defaultProviderId()),
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

  /** `@` mention candidates in a project, from its active session's checkout and roots. */
  async remoteSearchMentions(projectPath: string, query: string, opts: { scopeDir?: string; additionalDirs?: string[]; iconsById?: boolean }): Promise<unknown> {
    const session = this.sessionManager?.getActiveSession(projectPath)
    const cwd = session?.cwd ?? projectPath
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

  async remoteConsumeRateLimitReset(projectPath: string, apiProviderId: string | null, creditId: string | null): Promise<{ outcome: import('@superone/shared/agent-types').CodexRateLimitResetOutcome | null }> {
    return { outcome: this.codexConsumeRateLimitReset ? await this.codexConsumeRateLimitReset(projectPath, apiProviderId, creditId) : null }
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

  private async forkSessionControlled(request: SessionForkRequest) {
    const manager = this.requireSessionManager()
    const source = manager.getSession(request.sessionId) ?? manager.resumeSession(request.sessionId, { passive: true })
    source.lease.assertMutation()
    return forkSession(request, () => source.lease.assertMutation())
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
  private reloadLiveClaudePlugins(): void {
    this.sessionManager?.forEachSession((session) => {
      if (session.snapshot.harnessId === 'claude' && session.hasActiveRuntime()) void session.reloadPlugins()
    })
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
        await session.applyWorktreeSelection(wt, branch)
      }
      return
    }
    await session.applyWorktreeSelection(wt, branch ?? undefined)
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
    const activeCwd = mgr.getActiveSession(projectPath)?.cwd
    const cwd = hint?.worktreePath ?? activeCwd
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
          acpAgentId: acpAgentHint,
        })
      }
    }
    const active = mgr.getActiveSession(projectPath)
    if (active) {
      if (shouldApplyHint(active)) active.setApiProviderId(apiProviderHint)
      if (acpAgentHint) active.setAcpAgentId(acpAgentHint)
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
    const activeCwd = mgr.getActiveSession(projectPath)?.cwd
    const cwd = hint?.worktreePath ?? activeCwd
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
          await this.applyWorktreeCwdHint(existing, {
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
    const { agentPreference } = readAppSettings()
    const defaults = sessionDefaultsForHarness(agentPreference, harnessId)
    return {
      permissionMode: defaults.permissionMode,
      sandboxMode: coerceSandboxModeForCapability(defaults.sandboxMode ?? undefined),
    }
  }

  setup(): void {
    const windowIpc = windowControlIpc(ipcMain)

    // --- Session-scoped handlers (projectPath as first arg) ---

    windowIpc.handle(AgentIpcChannels.SEND_MESSAGE, async (_event, projectPath: string, request: SendMessageRequest) => {
      // A node session runs on its node, sent through the environment gateway;
      // the key is not a local project path to resume or create a Session in.
      if (parseRemoteProjectKey(projectPath)) {
        throw new Error(`send_message: ${projectPath} is a remote project; send through the environment gateway`)
      }
      const session = await this.getOrCreateActiveSession(projectPath, request.sessionId, {
        worktreePath: request.worktreePath,
        gitBranch: request.gitBranch,
        ...(request.apiProviderId !== undefined ? { apiProviderId: request.apiProviderId } : {}),
        ...(request.provider ? { provider: request.provider } : {}),
        ...(request.acpAgentId !== undefined ? { acpAgentId: request.acpAgentId } : {}),
      })
      trace('session.lifecycle', 'ipc_sendMessage', {
        projectPath,
        sessionId: session.snapshot.id,
        providerSessionId: session.snapshot.providerSessionId ?? '(none)',
        status: session.snapshot.status,
        cwd: session.cwd,
        worktreePath: request.worktreePath ?? null,
      })
      if (request.priority === 'next' || request.priority === 'later') {
        session.lease.assertMutation()
        return enqueueSessionQueueOp(session.id, () => { session.lease.assertMutation(); return session.send(request) })
      }
      return session.send(request)
    })

    windowIpc.handle(AgentIpcChannels.DEQUEUE_MESSAGE, async (_event, projectPath: string, clientMessageId: string) => {
      const session = this.sessionManager?.getActiveSession(projectPath)
      if (!session) return false
      session.lease.assertMutation()
      return enqueueSessionQueueOp(session.id, () => { session.lease.assertMutation(); return session.dequeueMessage(clientMessageId) })
    })

    windowIpc.handle(AgentIpcChannels.STEER_QUEUED_MESSAGE, async (_event, projectPath: string, clientMessageId: string, sessionId?: string, priority?: ClaudeSteerPriority) => {
      const session = sessionId
        ? this.sessionManager?.getSession(sessionId)
        : this.sessionManager?.getActiveSession(projectPath)
      if (!session || session.snapshot.projectPath !== projectPath) return false
      const steer = queuedSteerCommand(session.snapshot.harnessId, clientMessageId, priority ?? 'now')
      if (!steer) return false
      session.lease.assertMutation()
      await enqueueSessionQueueOp(session.id, () => { session.lease.assertMutation(); return session.dispatchBackendCommand(steer) })
      return true
    })

    windowIpc.handle(AgentIpcChannels.START_QUEUED_MESSAGES, async (_event, projectPath: string, sessionId?: string) => {
      const session = sessionId
        ? this.sessionManager?.getSession(sessionId)
        : this.sessionManager?.getActiveSession(projectPath)
      if (!session || session.snapshot.projectPath !== projectPath) return false
      session.lease.assertMutation()
      return enqueueSessionQueueOp(session.id, () => { session.lease.assertMutation(); return session.startQueuedMessages() })
    })

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

    windowIpc.handle(AgentIpcChannels.INTERRUPT, async (_event, sessionId: string) => {
      const session = this.sessionManager?.getSession(sessionId)
      if (!session) return false
      session.lease.assertMutation()
      return session.interrupt()
    })

    windowIpc.handle(AgentIpcChannels.WORKTREE_REMOVED, async (_event, sessionId: string) => {
      const session = this.sessionManager?.getSession(sessionId)
      const { worktreePath, projectPath } = session?.snapshot ?? {}
      // Re-check here: the renderer only reports what it saw, main decides.
      if (!session || !worktreePath || !projectPath || worktreeExists(worktreePath, projectPath)) return
      await session.markWorktreeRemoved()
    })

    windowIpc.handle(AgentIpcChannels.START_REALTIME_VOICE, async (_event, projectPath: string, sessionId: string, request: import('@superone/shared/agent-types').RealtimeVoiceStartRequest) => {
      this.sessionManager?.getSession(sessionId)?.lease.assertMutation()
      // Realtime voice forces the session onto codex. Record the harness it had first:
      // if it was not codex, resolving below recreates the session, which reads in the
      // UI as the call "jumping to a new session".
      const harnessBefore = this.sessionManager?.getSession(sessionId)?.snapshot.harnessId ?? '(none)'
      const session = await this.getOrCreateActiveSession(projectPath, sessionId, { provider: 'codex' })
      log.info('[agent-service] realtime voice start sid=%s harnessBefore=%s thread=%s', session.id, harnessBefore, session.snapshot.providerSessionId ?? '(none)')
      const preferredVoice = readAppSettings().agentPreference.codex.realtimeVoice
      await session.startRealtimeVoice(
        request.voice || !preferredVoice
          ? request
          : { ...request, voice: preferredVoice },
      )
    })

    windowIpc.handle(AgentIpcChannels.STOP_REALTIME_VOICE, async (_event, projectPath: string, sessionId: string) => {
      const session = this.sessionManager?.getSession(sessionId)
      if (!session) return
      if (session.snapshot.projectPath !== projectPath) return
      session.lease.assertMutation()
      await session.stopRealtimeVoice()
    })

    windowIpc.handle(AgentIpcChannels.LOAD_REALTIME_TIMELINE, (_event, sessionId: string) => {
      return loadRealtimeTimeline(sessionId)
    })

    windowIpc.handle(AgentIpcChannels.GET_REALTIME_TIMELINE, async (_event, projectPath: string, sessionId: string) => {
      this.sessionManager?.getSession(sessionId)?.lease.assertMutation()
      const session = await this.getOrCreateActiveSession(projectPath, sessionId, { provider: 'codex' })
      const timeline = await session.getRealtimeTimeline()
      return reconcileRealtimeTimeline(sessionId, timeline)
    })

    windowIpc.handle(AgentIpcChannels.STOP_TASK, async (_event, sessionId: string, taskId: string) => {
      const session = this.sessionManager?.getSession(sessionId)
      if (!session) return false
      session.lease.assertMutation()
      await session.dispatchBackendCommand({ kind: 'claude.stop_task', taskId })
      return true
    })

    windowIpc.handle(AgentIpcChannels.OPEN_WIDGET_INPUT_REQUEST, (_event, input: { projectPath: string; sessionId: string; messageId: string; spec: unknown }) => {
      const session = this.sessionManager?.getSession(input.sessionId)
      if (session) session.lease.assertMutation()
      return composerOpenResult(() => openWidgetInputRequest(session, { ...input, output: 'agent' }))
    })

    // The trusted container names the source; the frame supplies only the spec and output.
    windowIpc.handle(AgentIpcChannels.COMPOSER_OPEN, (event, request: import('@superone/shared/agent-types').ComposerOpenRequest) => {
      const client = this.composerWindow(event.sender)
      const source = request.source
      return openComposerForm(client, request, (output) => {
        if (source.kind === 'widget') {
          return openWidgetInputRequest(this.sessionManager?.getSession(source.sessionId), {
            projectPath: source.projectPath, sessionId: source.sessionId, messageId: source.messageId, spec: request.spec, output,
          })
        }
        if (!this.openMiniAppForm) throw new InputRequestOpenError('unsupported', 'Mini-app forms are unavailable')
        return this.openMiniAppForm({
          appId: source.appId,
          projectDir: source.projectDir,
          ...(source.sessionId ? { sessionId: source.sessionId } : {}),
          spec: request.spec,
          output,
        })
      })
    })
    windowIpc.handle(AgentIpcChannels.COMPOSER_AWAIT, (event, requestId: string) =>
      awaitComposerForm({ kind: 'window', id: event.sender.id }, requestId))
    windowIpc.handle(AgentIpcChannels.COMPOSER_CANCEL, (event, viewId: string, localId?: string) => {
      cancelComposerForms({ kind: 'window', id: event.sender.id }, viewId, localId)
    })

    windowIpc.handle(AgentIpcChannels.PERMISSION_RESPONSE, (_event, sessionId: string, requestId: string, allow: boolean, alwaysAllow?: boolean, reason?: string, selectedSuggestions?: number[], decision?: 'cancel', formAnswers?: Record<string, unknown>) => {
      const session = this.sessionManager?.getSession(sessionId)
      if (!session) return false
      session.lease.assertMutation()
      trace('agent.emit', 'permission_responded', { requestId, allow, reason, sessionId })
      trace('permission.flow', 'ipc_response', { projectPath: session.snapshot.projectPath, sessionId, allow, alwaysAllow, reason, decision, formAnswers }, requestId)
      return session.respondToPermission(requestId, allow, alwaysAllow, reason, selectedSuggestions, decision, formAnswers)
    })

    windowIpc.handle(AgentIpcChannels.SET_PERMISSION_MODE, async (
      _event,
      projectPath: string,
      sessionId: string,
      mode: PermissionMode,
    ) => {
      const session = this.sessionManager?.getSession(sessionId)
      // Read one snapshot for the guard: `snapshot` is a live getter, so keeping
      // the post-failure re-check on a separate read is what makes it meaningful.
      const snapshot = session?.snapshot
      if (
        !session
        || !snapshot
        || snapshot.projectPath !== projectPath
        || snapshot.status === 'disposed'
      ) {
        trace('permission.flow', 'ipc_setMode_stale', { projectPath, sessionId, mode })
        return false
      }
      this.throwIfRemoteLocked(projectPath)
      trace('permission.flow', 'ipc_setMode', { projectPath, mode, sid: session.id, status: session.snapshot.status })
      try {
        await session.setPermissionMode(mode)
        return true
      } catch (error) {
        // Session disposal can win after getSession() but before setPermissionMode().
        // A stale renderer effect must not reject or mutate a replacement session.
        if (session.snapshot.status === 'disposed') {
          trace('permission.flow', 'ipc_setMode_disposed', { projectPath, sessionId, mode })
          return false
        }
        throw error
      }
    })

    windowIpc.handle(AgentIpcChannels.SET_SANDBOX_MODE, async (_event, projectPath: string, mode: SandboxMode, sessionId?: string) => {
      if (!sessionId) this.throwIfRemoteLocked(projectPath)
      const capability = getSandboxCapability()
      if (mode !== 'off' && capability.supportLevel === 'unsupported') {
        throw new Error(capability.unsupportedReason ?? '当前平台不支持沙盒')
      }
      // Same rule as SET_SESSION_SETTINGS: an explicit id is a scoped write from
      // a pane that is not the project's active chat, and both guards must read
      // the session being written rather than whichever one is in the foreground.
      if (sessionId) {
        const scoped = this.sessionManager?.getSession(sessionId) ?? null
        if (!scoped) return
        if (scoped.snapshot.projectPath !== projectPath) return
        if (this.isSessionRemoteLocked(scoped)) return
        return scoped.setSandboxMode(mode)
      }
      const session = await this.getOrCreateActiveSession(projectPath)
      return session.setSandboxMode(mode)
    })

    windowIpc.handle(AgentIpcChannels.SET_SESSION_SETTINGS, (_event, projectPath: string, settings: { model?: string | null; effort?: SendMessageRequest['effort'] | null; ultracode?: boolean; mode?: string | null; agentPreset?: string | null; contextWindow?: number | null }, sessionId?: string) => {
      // An explicit id is a scoped write from a pane that is not the project's
      // active chat — a mosaic tile, or a side chat, whose picker would
      // otherwise re-configure the conversation it was forked from.
      const session = sessionId
        ? this.sessionManager?.getSession(sessionId) ?? null
        : this.sessionManager?.getActiveSession(projectPath)
      if (!session) return
      // Both guards read the session being WRITTEN. Checking the project's
      // active session instead would let a scoped write into a remote-owned
      // session through, and would let a stale scope address a session that
      // belongs to an entirely different project.
      if (session.snapshot.projectPath !== projectPath) return
      if (this.isSessionRemoteLocked(session)) return
      const applied = session.setSelectedSettings(settings)
      if (settings.agentPreset !== undefined) session.setAgentPreset(settings.agentPreset)
      return applied
    })

    windowIpc.handle(AgentIpcChannels.SET_SESSION_API_PROVIDER, (_event, sessionId: string, apiProviderId: string | null) => {
      const session = this.sessionManager?.getSession(sessionId)
      if (!session) return
      session.lease.assertMutation()
      session.setApiProviderId(apiProviderId)
    })

    windowIpc.handle(AgentIpcChannels.ANSWER_QUESTION, (_event, sessionId: string, requestId: string, answers: Record<string, string>, annotations?: QuestionAnnotations) => {
      const session = this.sessionManager?.getSession(sessionId)
      if (!session) return
      session.lease.assertMutation()
      trace('agent.emit', 'question_answered', { requestId, answers, sessionId })
      session.respondToQuestion(requestId, answers, annotations)
    })

    windowIpc.handle(AgentIpcChannels.DISMISS_QUESTION, (_event, sessionId: string, requestId: string) => {
      const session = this.sessionManager?.getSession(sessionId)
      if (!session) return
      session.lease.assertMutation()
      trace('agent.emit', 'question_dismissed', { requestId, sessionId })
      session.dismissQuestion(requestId)
    })

    windowIpc.handle(AgentIpcChannels.RESPOND_PLAN_APPROVAL, (_event, sessionId: string, requestId: string, approved: boolean, feedback?: string) => {
      const session = this.sessionManager?.getSession(sessionId)
      if (!session) return
      session.lease.assertMutation()
      trace('agent.emit', 'plan_approval_responded', { requestId, approved, feedback, sessionId })
      session.respondToPlanApproval(requestId, approved, feedback)
    })

    windowIpc.handle(AgentIpcChannels.CREATE_SESSION, async (_event, projectPath: string) => {
      const mgr = this.requireSessionManager()
      const { permissionMode, sandboxMode } = this.readDefaultSessionPrefs()
      const session = mgr.createSession({ projectPath, providerId: 'claude-base', permissionMode, sandboxMode })
      return session.snapshot.id
    })

    windowIpc.handle(AgentIpcChannels.RESET_SESSION, async (_event, sessionId: string, newSessionId?: string) => {
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
      const prefs = this.readDefaultSessionPrefs(harnessId)
      const fresh = mgr.createSession({ projectPath, providerId, ...prefs, id: newSessionId })
      return { permissionMode: fresh.getCurrentPermissionMode(), sandboxInfo: fresh.getCurrentSandboxInfo() }
    })

    // Manual `/recap` (Grok ACP) — fire-and-forget x.ai/recap; result is session_recap event.
    windowIpc.handle(AgentIpcChannels.REQUEST_SESSION_RECAP, async (_event, sessionId: string) => {
      const session = this.sessionManager?.getSession(sessionId)
      if (!session?.requestSessionRecap) return false
      return session.requestSessionRecap(false)
    })

    windowIpc.handle(AgentIpcChannels.TRUNCATE_AT_CHECKPOINT, (_event, projectPath: string, checkpointId: string) => {
      const session = this.sessionManager?.getActiveSession(projectPath)
      if (!session) return false
      session.truncateMessagesAt(checkpointId)
      return true
    })

    windowIpc.handle(AgentIpcChannels.REWIND_FILES, async (_event, projectPath: string, userMessageId: string) => {
      const session = this.sessionManager?.getActiveSession(projectPath)
      if (!session) return { canRewind: false, error: 'No active session' }
      return session.rewindFiles(userMessageId)
    })

    windowIpc.handle(AgentIpcChannels.REWIND_FILES_PREVIEW, async (_event, projectPath: string, userMessageId: string) => {
      const session = this.sessionManager?.getActiveSession(projectPath)
      if (!session) return { canRewind: false, error: 'No active session' }
      return session.rewindFiles(userMessageId, { dryRun: true })
    })

    windowIpc.handle(AgentIpcChannels.REWIND_CODE_AND_CHAT, async (_event, projectPath: string, userMessageId: string) => {
      const session = this.sessionManager?.getActiveSession(projectPath)
      if (!session) return { canRewind: false, error: 'No active session' }
      return session.rewindFiles(userMessageId, { includeConversation: true })
    })

    windowIpc.handle(AgentIpcChannels.REWIND_CONVERSATION, async (_event, projectPath: string, userMessageId: string) => {
      const session = this.sessionManager?.getActiveSession(projectPath)
      if (!session) return { canRewind: false, error: 'No active session' }
      return session.rewindConversation(userMessageId)
    })

    windowIpc.handle(AgentIpcChannels.GET_SESSION_ID, (_event, projectPath: string) => {
      return this.sessionManager?.getActiveSession(projectPath)?.snapshot.providerSessionId ?? null
    })

    windowIpc.handle(AgentIpcChannels.MCP_SERVER_STATUS, async (_event, projectPath: string) => {
      const session = this.sessionManager?.getActiveSession(projectPath)
      if (!session) return []
      return session.getMcpServerStatus()
    })

    windowIpc.handle(AgentIpcChannels.MCP_SERVER_AUTHENTICATE, async (_event, projectPath: string, serverName: string) => {
      const session = this.sessionManager?.getActiveSession(projectPath)
      if (!session) throw new Error('No active session')
      await session.authenticateMcp(serverName)
    })

    windowIpc.handle(AgentIpcChannels.GET_CONTEXT_USAGE, async (_event, projectPath: string, sessionId?: string) => {
      const session = sessionId
        ? this.sessionManager?.getSession(sessionId)
        : this.sessionManager?.getActiveSession(projectPath)
      if (!session) return null
      if (sessionId && session.snapshot.projectPath !== projectPath) return null
      return session.getContextUsage()
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

    windowIpc.handle(AgentIpcChannels.DISCONNECT_REMOTE_SESSION, async (_event, sessionId?: string) => {
      const targets: import('../session/types').Session[] = []
      if (sessionId) {
        const s = this.sessionManager?.getSession(sessionId)
        if (s) targets.push(s)
      } else {
        this.sessionManager?.forEachSession((s) => {
          if (s.lease.isExternal) targets.push(s)
        })
      }
      for (const session of targets) {
        if (session.lease.isExternal) session.lease.revoke()
      }
      // A phone this desktop routes to a node session.
      await this.releaseRoutedSessions?.(sessionId)
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

    windowIpc.handle(AgentIpcChannels.MCP_DELETE_CONFIG, async (_event, projectPath: string, name: string, scope: ResourceScope) => {
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
      try { await this.sessionManager?.getActiveSession(projectPath)?.toggleMcpServer(name, !disabled) } catch (err) { log.debug('[agent] MCP toggle skipped:', err) }
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
      this.broadcastProviderConfigChanged()
      return ok
    })

    windowIpc.handle(AgentIpcChannels.CREDENTIALS_LIST, () => listCredentials())
    windowIpc.handle(AgentIpcChannels.CREDENTIALS_CREATE, (_event, input: CreateCredentialInput) => createCredential(input))
    windowIpc.handle(AgentIpcChannels.CREDENTIALS_UPDATE, (_event, id: string, patch: UpdateCredentialInput) => {
      const result = updateCredential(id, patch)
      this.broadcastProviderConfigChanged()
      return result
    })
    windowIpc.handle(AgentIpcChannels.CREDENTIALS_DELETE, (_event, id: string) => {
      const ok = deleteCredential(id)
      this.broadcastProviderConfigChanged()
      return ok
    })

    windowIpc.handle(AgentIpcChannels.BINDINGS_GET, () => listBindings())
    windowIpc.handle(AgentIpcChannels.BINDINGS_SET, (_event, binding: ConsumerBinding) => {
      log.info('[bindings] set consumer=%s credential=%s', binding.consumer, binding.credentialId)
      setBinding(binding)
      const harness = binding.consumer === 'chat:codex' ? 'codex' : 'claude'
      this.markAllNeedsRebuild()
      if (harness === 'codex') this.codexProviderChanged?.(false)
      this.broadcastProviderChanged(harness)
    })
    windowIpc.handle(AgentIpcChannels.BINDINGS_CLEAR, (_event, consumer: ConsumerId) => {
      log.info('[bindings] clear consumer=%s', consumer)
      deleteBinding(consumer)
      const harness = consumer === 'chat:codex' ? 'codex' : 'claude'
      this.markAllNeedsRebuild()
      if (harness === 'codex') this.codexProviderChanged?.(false)
      this.broadcastProviderChanged(harness)
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
      return listSessionProviders()
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

    windowIpc.handle(AgentIpcChannels.SESSIONS_LIST, (_event, projectPath: string) => {
      return listSessionsForFolder(projectPath)
    })

    windowIpc.handle(AgentIpcChannels.SESSIONS_LIST_FOR_FOLDER, (_event, folderPath: string) => {
      return listSessionsForFolder(folderPath)
    })

    windowIpc.handle(AgentIpcChannels.SESSIONS_LIST_FOR_FOLDER_PAGE, (_event, folderPath: string, limit: number, offset: number) => {
      return listSessionsForFolder(folderPath, limit, offset)
    })

    windowIpc.handle(AgentIpcChannels.SESSIONS_RESUME, async (_event, projectPath: string, sessionId: string, worktreeCwd?: string, permissionMode?: PermissionMode) => {
      const mgr = this.requireSessionManager()
      // A stored session resumes on its own harness, so its defaults must come
      // from there — not from whichever harness happens to be the fallback.
      const defaults = this.readDefaultSessionPrefs(readSessionHarnessId(sessionId) ?? 'claude')
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
        await session.applyWorktreeSelection(worktreeCwd)
      }
      try { mgr.setActiveSession(projectPath, sessionId) } catch { /* session from another project, skip */ }
      return {
        permissionMode: session.getCurrentPermissionMode(),
        sandboxInfo: session.getCurrentSandboxInfo(),
      }
    })

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

    windowIpc.handle(AgentIpcChannels.ACTIVATE_SESSION, async (_event, projectPath: string, sessionId: string) => {
      const mgr = this.requireSessionManager()
      let session = mgr.getSession(sessionId)
      if (!session) {
        try { session = mgr.resumeSession(sessionId) } catch { return }
      }
      try { mgr.setActiveSession(projectPath, sessionId) } catch { /* belongs to another project */ }
    })

    windowIpc.handle(AgentIpcChannels.SET_SESSION_FOREGROUND, (event, sessionId: string, foreground: boolean, projectPath?: string) => {
      this.requireSessionManager().setSessionForeground(sessionId, foreground)
      const environmentId = (projectPath && parseRemoteProjectKey(projectPath)?.connectionId) || localSessionEnvironmentId()
      this.sessionForegroundListener?.(event.sender.id, { environmentId, sessionId }, foreground, event.sender)
    })

    windowIpc.handle(AgentIpcChannels.GET_LIVE_SNAPSHOTS, () => {
      return this.requireSessionManager().listLiveSnapshots()
    })

    windowIpc.handle(AgentIpcChannels.SESSIONS_LOAD_MESSAGES, (_event, projectPath: string, sessionId: string, limit: number, cursor?: number) => {
      return loadSessionMessages(projectPath, sessionId, limit, cursor)
    })

    windowIpc.handle(AgentIpcChannels.SESSIONS_RENAME, (_event, sessionId: string, title: string) => {
      const session = this.requireSessionManager().getSession(sessionId)
      if (session) {
        session.setTitle(title, 'user')
      } else {
        dbRenameSession(sessionId, title, 'user')
      }
      this.emitSessionsChanged()
    })

    windowIpc.handle(AgentIpcChannels.SESSIONS_LOAD_STATE, (_event, sessionId: string) => {
      return loadSessionState(sessionId)
    })

    windowIpc.handle(AgentIpcChannels.SESSIONS_DELETE, async (_event, sessionId: string) => {
      // Tear the runtime down first: session state is persisted with an upsert, so a
      // session still alive after the row is gone — a realtime call keeps streaming
      // transcript and titles — would INSERT itself straight back. Disposing also
      // stops that call instead of leaving it talking to a deleted session.
      if (this.sessionManager?.getSession(sessionId)) {
        try {
          await this.sessionManager.disposeSession(sessionId)
        } catch (err) {
          log.warn('[agent-service] dispose before delete failed sid=%s: %s', sessionId, err instanceof Error ? err.message : String(err))
        }
      }
      // The sync zone and transfer jobs are reclaimed off the db-layer delete
      // signal (session-list-watch.ts), the same for every delete entry point.
      dbDeleteSession(sessionId)
      this.emitSessionsChanged()
    })

    windowIpc.handle(AgentIpcChannels.SESSIONS_DELETE_OLDER, (_event, folderPath: string, cutoffDate: string) => {
      const deleted = dbDeleteSessionsOlderThan(folderPath, cutoffDate)
      if (deleted.length > 0) {
        this.emitSessionsChanged()
      }
      return deleted
    })

    windowIpc.handle(AgentIpcChannels.SESSIONS_FORK, async (_event, request: SessionForkRequest) => {
      const result = await this.forkSessionControlled(request)
      if (result.ok) {
        this.emitSessionsChanged()
      }
      return result
    })

    // Side chat deliberately does NOT emitSessionsChanged: an ephemeral session
    // is absent from the database, so refreshing the sidebar would show nothing
    // and only cost a re-query.
    windowIpc.handle(AgentIpcChannels.SESSIONS_SIDE_CHAT_START, async (_event, request: SideChatStartRequest) => {
      return startSideChat(this.requireSessionManager(), request)
    })

    windowIpc.handle(AgentIpcChannels.SESSIONS_SIDE_CHAT_CLOSE, async (_event, sessionId: string) => {
      if (!this.sessionManager) return false
      return closeSideChat(this.sessionManager, sessionId)
    })

    windowIpc.handle(AgentIpcChannels.SESSIONS_PIN, (_event, sessionId: string, pinned: boolean) => {
      dbPinSession(sessionId, pinned)
      this.emitSessionsChanged()
    })

    windowIpc.handle(AgentIpcChannels.SESSIONS_HIDE, (_event, sessionId: string, hidden: boolean) =>
      this.setSessionHidden(sessionId, hidden))

    windowIpc.handle(AgentIpcChannels.SESSIONS_LIST_PINNED, () => {
      return listPinnedSessions()
    })
  }

  /**
   * Archive or unarchive a session. Archiving keeps the session's runtime, so
   * its background tasks are stopped here rather than left running unseen.
   */
  private async setSessionHidden(sessionId: string, hidden: boolean): Promise<void> {
    dbHideSession(sessionId, hidden)
    this.emitSessionsChanged()
    if (hidden) await this.sessionManager?.stopBackgroundTasks(sessionId)
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

    ipcMain.removeHandler(AgentIpcChannels.SEND_MESSAGE)
    ipcMain.removeHandler(AgentIpcChannels.DEQUEUE_MESSAGE)
    ipcMain.removeHandler(AgentIpcChannels.STEER_QUEUED_MESSAGE)
    ipcMain.removeHandler(AgentIpcChannels.START_QUEUED_MESSAGES)
    ipcMain.removeHandler(AgentIpcChannels.PREWARM)
    ipcMain.removeHandler(AgentIpcChannels.INTERRUPT)
    ipcMain.removeHandler(AgentIpcChannels.WORKTREE_REMOVED)
    ipcMain.removeHandler(AgentIpcChannels.START_REALTIME_VOICE)
    ipcMain.removeHandler(AgentIpcChannels.STOP_REALTIME_VOICE)
    ipcMain.removeHandler(AgentIpcChannels.LOAD_REALTIME_TIMELINE)
    ipcMain.removeHandler(AgentIpcChannels.GET_REALTIME_TIMELINE)
    ipcMain.removeHandler(AgentIpcChannels.STOP_TASK)
    ipcMain.removeHandler(AgentIpcChannels.PERMISSION_RESPONSE)
    ipcMain.removeHandler(AgentIpcChannels.OPEN_WIDGET_INPUT_REQUEST)
    ipcMain.removeHandler(AgentIpcChannels.COMPOSER_OPEN)
    ipcMain.removeHandler(AgentIpcChannels.COMPOSER_AWAIT)
    ipcMain.removeHandler(AgentIpcChannels.COMPOSER_CANCEL)
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
    ipcMain.removeHandler(AgentIpcChannels.SESSIONS_SIDE_CHAT_START)
    ipcMain.removeHandler(AgentIpcChannels.SESSIONS_SIDE_CHAT_CLOSE)
    ipcMain.removeHandler(AgentIpcChannels.SESSIONS_PIN)
    ipcMain.removeHandler(AgentIpcChannels.SESSIONS_HIDE)
    ipcMain.removeHandler(AgentIpcChannels.SESSIONS_LIST_PINNED)
  }
}
