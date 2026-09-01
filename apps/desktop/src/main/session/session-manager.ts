import { randomUUID } from 'crypto'
import { existsSync } from 'fs'
import { homedir } from 'os'
import type {
  AgentEvent,
  ChatMessage,
  PermissionMode,
  RemoteActiveProvider,
  SandboxMode,
} from '@superone/shared/agent-types'
import type { HarnessId } from './types'
import log from '../logger'
import { discoverProjectAgents, discoverProjectCommands, discoverSkills } from '../agent/discover-resources'
import { harnessRegistry } from './harness-registry'
import { getSessionProvider } from './session-provider-repo'
import { ProjectResourceCache } from './project-resource-cache'
import { cancelMcpReload } from '../mcp/mcp-reload-scheduler'
import { closeSuperoneMcpHttpSessions } from '../mcp/superone-mcp-http-state'
import { Session } from './session'
import {
  getRuntimeIdleTimeoutMs,
  SESSION_RUNTIME_REAPER_INTERVAL_MS,
} from './session-runtime-policy'
import type {
  LiveSessionSnapshot,
  ProjectResources,
  Session as SessionContract,
  SessionCreateOptions,
  SessionManager as SessionManagerContract,
  SessionProvider,
  SessionSnapshot,
  SessionStateChange,
} from './types'

export interface LoadedSessionData {
  projectPath: string
  providerId: string
  providerSessionId: string | null
  messages: ChatMessage[]
  totalCostUsd: number
  contextTokens: number
  title?: string | null
  worktreePath?: string | null
  gitBranch?: string | null
  apiProviderId?: string | null
  acpAgentId?: string | null
  selectedModel?: string | null
  selectedEffort?: import('@superone/shared/agent-types').EffortLevel | null
  codexServiceTier?: string | null
  /** Human-approved launch settings for collaboration children. */
  permissionMode?: PermissionMode
  sandboxMode?: SandboxMode
  systemPromptAppend?: string
}

export interface SessionManagerPersistence {
  onSessionCreated?: (session: { id: string; projectPath: string; providerId: string }) => void
  onSessionDisposed?: (sessionId: string) => void
  onSessionStateChange?: (snapshot: SessionStateChange) => void
  onProviderSessionIdChange?: (sid: string, providerSessionId: string) => void
  loadSession?: (sessionId: string) => LoadedSessionData | null
  resolveProviderConfig?: (provider: SessionProvider, apiProviderId?: string | null) => unknown
  getActiveProvider?: (harnessId: HarnessId, apiProviderId: string | null) => RemoteActiveProvider | null
  getActiveDefaultApiProviderId?: (harnessId: HarnessId) => string | null
  onBeforeInterrupt?: (sessionId: string) => void
  /**
   * Project-level workspace folders (Edit Project).
   *
   * Injected rather than imported so the manager stays hermetic in tests, and
   * read here because automations, mobile-initiated and remote-control turns
   * reach `createSession` with no renderer to compose the directory set.
   */
  getProjectExtraDirs?: (projectPath: string) => string[]
}

function resolveResumedCwd(data: LoadedSessionData): { cwd: string; missingWorktreePath: string | null } {
  if (!data.worktreePath) return { cwd: data.projectPath, missingWorktreePath: null }
  if (existsSync(data.worktreePath)) return { cwd: data.worktreePath, missingWorktreePath: null }
  return { cwd: data.projectPath, missingWorktreePath: data.worktreePath }
}

export class SessionManagerImpl implements SessionManagerContract {
  private sessions = new Map<string, Session>()
  private sessionProjects = new Map<string, string>()
  private activeByProject = new Map<string, string>()
  private projectResources: ProjectResourceCache
  private scopedListeners = new Map<string, Set<(e: AgentEvent) => void>>()
  private anyListeners = new Set<(sessionId: string, e: AgentEvent) => void>()
  private sessionListeners = new Set<(session: SessionContract) => void>()
  private perSessionUnsub = new Map<string, () => void>()
  private persistence: SessionManagerPersistence
  private runtimeReleases = new Set<string>()
  private runtimeReaperTimer: ReturnType<typeof setInterval> | null = null

  constructor(persistence: SessionManagerPersistence = {}) {
    this.persistence = persistence
    this.projectResources = new ProjectResourceCache({
      discoverSkills,
      discoverProjectCommands,
      discoverProjectAgents,
    })
  }

  openProject(projectPath: string): void {
    this.projectResources.get(projectPath)
  }

  async closeProject(projectPath: string): Promise<void> {
    const targets: Array<{ sid: string; cwd: string }> = []
    for (const [sid, pp] of this.sessionProjects) {
      if (pp !== projectPath) continue
      const session = this.sessions.get(sid)
      if (session) targets.push({ sid, cwd: session.cwd })
    }
    await Promise.all(targets.map(({ sid }) => this.disposeSession(sid)))
    const cwds = new Set(targets.map((t) => t.cwd))
    cwds.add(projectPath)
    for (const cwd of cwds) this.projectResources.invalidate(cwd)
    const { disposeSuperoneMcpServer } = await import('../mcp/superone-mcp-server')
    for (const { sid } of targets) disposeSuperoneMcpServer(sid)
  }

  forEachSession(fn: (session: SessionContract) => void): void {
    for (const session of this.sessions.values()) fn(session)
  }

  listProjectSessions(projectPath: string): SessionSnapshot[] {
    const out: SessionSnapshot[] = []
    for (const [sid, pp] of this.sessionProjects) {
      if (pp !== projectPath) continue
      const s = this.sessions.get(sid)
      if (s) out.push(s.snapshot)
    }
    return out
  }

  listLiveSnapshots(): LiveSessionSnapshot[] {
    const out: LiveSessionSnapshot[] = []
    for (const [sid, projectPath] of this.sessionProjects) {
      const session = this.sessions.get(sid)
      if (!session) continue
      // A side chat is owned by the renderer panel that opened it. Replaying it
      // through the boot-time snapshot sync would resurrect it as an ordinary
      // session row — with no panel to render it and no database row behind it.
      if (session.ephemeral) continue
      out.push({
        sid,
        projectPath,
        isActive: this.activeByProject.get(projectPath) === sid,
        isStreaming: session.isStreaming(),
        permissionMode: session.getCurrentPermissionMode(),
        sandboxInfo: session.getCurrentSandboxInfo(),
        uiSettings: session.getUiSettings(),
        snapshot: session.snapshot,
        pendingInteractions: session.getPendingInteractions(),
        replayEvents: session.getReplayEvents(),
      })
    }
    return out
  }

  getProjectResources(cwd: string): ProjectResources {
    return this.projectResources.get(cwd)
  }

  invalidateProjectResources(cwd: string): void {
    this.projectResources.invalidate(cwd)
  }

  createSession(opts: SessionCreateOptions): SessionContract {
    const provider = getSessionProvider(opts.providerId)
    if (!provider) throw new Error(`SessionProvider not found: ${opts.providerId}`)
    const harness = harnessRegistry.get(provider.harnessId)
    if (!harness) throw new Error(`Harness not registered: ${provider.harnessId}`)

    if (opts.id && this.sessions.has(opts.id)) {
      throw new Error(`Session id already active: ${opts.id}`)
    }
    const sessionId = opts.id ?? randomUUID()
    const cwd = opts.cwd ?? opts.projectPath
    const backend = harness.createBackend()
    const apiProviderId = opts.apiProviderId ?? null
    const resolveProviderConfig = this.persistence.resolveProviderConfig
    const providerConfig = resolveProviderConfig
      ? resolveProviderConfig(provider, apiProviderId)
      : provider.config
    let permissionMode = opts.permissionMode
    let sandboxMode = opts.sandboxMode
    // Cold create with a known SuperOne session id (prewarm / send fallback) must
    // still carry the stored provider session id so ACP agents can session/load.
    // Only hydrate when the DB row is the same provider — harness switches must not
    // resume a Claude/Codex thread id into Grok (or vice versa).
    let resumedProviderSessionId = opts.providerSessionId?.trim() || null
    let selectedModel = opts.model
    let selectedEffort = opts.effort
    if (opts.id && this.persistence.loadSession) {
      try {
        const prior = this.persistence.loadSession(opts.id)
        if (prior?.providerId === opts.providerId) {
          if (!resumedProviderSessionId && prior.providerSessionId?.trim()) {
            resumedProviderSessionId = prior.providerSessionId.trim()
            log.info(
              '[SessionManager] createSession hydrated providerSessionId sid=%s provider=%s',
              opts.id,
              opts.providerId,
            )
          }
          selectedModel ??= prior.selectedModel ?? undefined
          selectedEffort ??= prior.selectedEffort ?? undefined
          permissionMode = prior.permissionMode ?? permissionMode
          sandboxMode = prior.sandboxMode ?? sandboxMode
        }
      } catch (err) {
        log.debug('[SessionManager] createSession loadSession hydrate skipped:', err)
      }
    }
    const sandboxInfo = sandboxMode !== undefined
      ? { enabled: sandboxMode !== 'off', autoAllowBash: sandboxMode === 'auto' }
      : undefined
    const session = new Session({
      id: sessionId,
      projectPath: opts.projectPath,
      cwd,
      providerId: provider.id,
      harnessId: provider.harnessId,
      providerConfig,
      backend,
      permissionMode,
      sandboxInfo,
      effort: selectedEffort,
      model: selectedModel,
      codexServiceTier: opts.codexServiceTier,
      // Caller scope only. `Session` owns the union with the project's folders
      // and recomputes it every turn; pre-mixing them here would bake project
      // folders into the caller half, so a later removal could never propagate.
      additionalDirectories: opts.additionalDirectories,
      gitBranch: opts.gitBranch ?? null,
      apiProviderId,
      acpAgentId: opts.acpAgentId ?? null,
      systemPromptAppend: opts.systemPromptAppend,
      firstTurnPreamble: opts.firstTurnPreamble,
      resumedProviderSessionId: resumedProviderSessionId ?? undefined,
      homedir: homedir(),
      getProjectResources: (c) => this.projectResources.get(c),
      getProjectExtraDirs: this.persistence.getProjectExtraDirs,
      invalidateProjectResources: (c) => this.projectResources.invalidate(c),
      ephemeral: opts.ephemeral,
      // Ephemeral sessions withhold both persistence hooks rather than adding a
      // branch inside Session: `notifyStateChange` already no-ops without
      // `onStateChange`, so exactly one place decides whether a session writes.
      onStateChange: !opts.ephemeral && this.persistence.onSessionStateChange
        ? (snapshot) => this.persistence.onSessionStateChange!(snapshot)
        : undefined,
      onProviderSessionIdChange: !opts.ephemeral && this.persistence.onProviderSessionIdChange
        ? (sid, providerSessionId) => this.persistence.onProviderSessionIdChange!(sid, providerSessionId)
        : undefined,
      getActiveProvider: this.persistence.getActiveProvider,
      // Re-read provider from DB so credential/config updates after create are visible.
      resolveProviderConfigForApiProvider: resolveProviderConfig
        ? (id) => resolveProviderConfig(getSessionProvider(provider.id) ?? provider, id)
        : undefined,
      getActiveDefaultApiProviderId: this.persistence.getActiveDefaultApiProviderId,
      onBeforeInterrupt: this.persistence.onBeforeInterrupt
        ? () => this.persistence.onBeforeInterrupt!(sessionId)
        : undefined,
    })

    this.registerSession(session, opts.projectPath)
    // A side chat opens next to the chat the user is reading, not instead of it.
    if (!opts.ephemeral) this.activeByProject.set(opts.projectPath, sessionId)
    try {
      this.persistence.onSessionCreated?.({
        id: sessionId,
        projectPath: opts.projectPath,
        providerId: provider.id,
      })
    } catch (err) {
      log.warn('[SessionManager] onSessionCreated hook failed:', err)
    }
    return session
  }

  getActiveSession(projectPath: string): SessionContract | null {
    const sid = this.activeByProject.get(projectPath)
    if (!sid) return null
    return this.sessions.get(sid) ?? null
  }

  setActiveSession(projectPath: string, sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    if (this.sessionProjects.get(sessionId) !== projectPath) {
      throw new Error(`Session ${sessionId} does not belong to project ${projectPath}`)
    }
    // An ephemeral session (side chat) is docked beside the project's chat, never
    // instead of it. Guarding here rather than at each call site: prewarm and send
    // both route through this, and `activeByProject` decides where session-less
    // events land and what the next cold boot restores as foreground.
    if (session.ephemeral) return
    this.activeByProject.set(projectPath, sessionId)
  }

  clearActiveSession(projectPath: string): void {
    this.activeByProject.delete(projectPath)
  }

  resumeSession(sessionId: string, opts?: { permissionMode?: import('@superone/shared/agent-types').PermissionMode; sandboxMode?: import('@superone/shared/agent-types').SandboxMode; passive?: boolean }): SessionContract {
    const existing = this.sessions.get(sessionId)
    if (existing) return existing
    if (!this.persistence.loadSession) {
      throw new Error('resumeSession requires loadSession hook on SessionManagerPersistence')
    }
    const data = this.persistence.loadSession(sessionId)
    if (!data) throw new Error(`Session not found: ${sessionId}`)
    const provider = getSessionProvider(data.providerId)
    if (!provider) throw new Error(`SessionProvider not found: ${data.providerId}`)
    const harness = harnessRegistry.get(provider.harnessId)
    if (!harness) throw new Error(`Harness not registered: ${provider.harnessId}`)

    const backend = harness.createBackend()
    const apiProviderId = data.apiProviderId ?? null
    const resolveProviderConfig = this.persistence.resolveProviderConfig
    const providerConfig = resolveProviderConfig
      ? resolveProviderConfig(provider, apiProviderId)
      : provider.config
    const { cwd: resumedCwd, missingWorktreePath } = resolveResumedCwd(data)
    const permissionMode = data.permissionMode ?? opts?.permissionMode
    const sandboxMode = data.sandboxMode ?? opts?.sandboxMode
    const sandboxInfo = sandboxMode !== undefined
      ? { enabled: sandboxMode !== 'off', autoAllowBash: sandboxMode === 'auto' }
      : undefined
    const session = new Session({
      id: sessionId,
      projectPath: data.projectPath,
      cwd: resumedCwd,
      providerId: provider.id,
      harnessId: provider.harnessId,
      providerConfig,
      backend,
      permissionMode,
      sandboxInfo,
      resumedProviderSessionId: data.providerSessionId ?? undefined,
      initialMessages: data.messages,
      initialTotalCostUsd: data.totalCostUsd,
      initialContextTokens: data.contextTokens,
      title: data.title ?? null,
      gitBranch: data.gitBranch ?? null,
      missingWorktreePath,
      apiProviderId,
      acpAgentId: data.acpAgentId ?? null,
      effort: data.selectedEffort ?? undefined,
      model: data.selectedModel ?? undefined,
      codexServiceTier: data.codexServiceTier,
      systemPromptAppend: data.systemPromptAppend,
      homedir: homedir(),
      getProjectResources: (c) => this.projectResources.get(c),
      invalidateProjectResources: (c) => this.projectResources.invalidate(c),
      onStateChange: this.persistence.onSessionStateChange
        ? (snapshot) => this.persistence.onSessionStateChange!(snapshot)
        : undefined,
      onProviderSessionIdChange: this.persistence.onProviderSessionIdChange
        ? (sid, providerSessionId) => this.persistence.onProviderSessionIdChange!(sid, providerSessionId)
        : undefined,
      getActiveProvider: this.persistence.getActiveProvider,
      // Re-read provider from DB so credential/config updates after create are visible.
      resolveProviderConfigForApiProvider: resolveProviderConfig
        ? (id) => resolveProviderConfig(getSessionProvider(provider.id) ?? provider, id)
        : undefined,
      getActiveDefaultApiProviderId: this.persistence.getActiveDefaultApiProviderId,
      onBeforeInterrupt: this.persistence.onBeforeInterrupt
        ? () => this.persistence.onBeforeInterrupt!(sessionId)
        : undefined,
    })

    this.registerSession(session, data.projectPath)
    if (!opts?.passive) {
      this.activeByProject.set(data.projectPath, sessionId)
    }
    return session
  }

  getSession(sessionId: string): SessionContract | null {
    return this.sessions.get(sessionId) ?? null
  }

  hasAnyStreaming(): boolean {
    for (const s of this.sessions.values()) {
      if (s.isStreaming()) return true
    }
    return false
  }

  markAllNeedsRebuild(harnessId?: SessionProvider['harnessId']): void {
    this._markNeedsRebuild((session) => {
      if (harnessId && session.snapshot.harnessId !== harnessId) return false
      return true
    })
  }

  markProjectNeedsRebuild(projectPath: string, harnessId?: SessionProvider['harnessId']): void {
    this._markNeedsRebuild((session) => {
      if (session.projectPath !== projectPath) return false
      if (harnessId && session.snapshot.harnessId !== harnessId) return false
      return true
    })
  }

  markSessionNeedsRebuild(sessionId: string, harnessId?: SessionProvider['harnessId']): void {
    this._markNeedsRebuild((session) => {
      if (session.snapshot.id !== sessionId) return false
      if (harnessId && session.snapshot.harnessId !== harnessId) return false
      return true
    })
  }

  private _markNeedsRebuild(filter: (session: Session) => boolean): void {
    const resolver = this.persistence.resolveProviderConfig
    for (const session of this.sessions.values()) {
      if (!filter(session)) continue
      const provider = getSessionProvider(session.snapshot.providerId)
      if (!provider) continue
      const nextConfig = resolver
        ? resolver(provider, session.snapshot.apiProviderId)
        : provider.config
      try { session.updateProviderConfig(nextConfig) } catch (err) {
        log.debug('[SessionManager] updateProviderConfig failed for sid=%s:', session.id, err)
      }
      try { session.markNeedsRebuild() } catch (err) {
        log.debug('[SessionManager] markNeedsRebuild failed for sid=%s:', session.id, err)
      }
    }
  }

  async disposeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) return
    const unsub = this.perSessionUnsub.get(sessionId)
    if (unsub) {
      try { unsub() } catch { /* ignore */ }
      this.perSessionUnsub.delete(sessionId)
    }
    try { await session.dispose() } catch (err) {
      log.debug('[SessionManager] dispose error:', err)
    }
    await closeSuperoneMcpHttpSessions(sessionId)
    try {
      const { disposeDeviceAgentSession } = await import('../device-agent')
      disposeDeviceAgentSession(sessionId)
    } catch (err) {
      log.debug('[SessionManager] device agent cleanup failed:', err)
    }
    const projectPath = this.sessionProjects.get(sessionId)
    this.sessions.delete(sessionId)
    this.runtimeReleases.delete(sessionId)
    this.sessionProjects.delete(sessionId)
    this.scopedListeners.delete(sessionId)
    if (projectPath && this.activeByProject.get(projectPath) === sessionId) {
      this.activeByProject.delete(projectPath)
    }
    try {
      this.persistence.onSessionDisposed?.(sessionId)
    } catch (err) {
      log.warn('[SessionManager] onSessionDisposed hook failed:', err)
    }
    try {
      const { unregisterSessionAllApps, isAppStillAuthorizedInProject, unregisterAppTemplates } = await import('../mcp/superone-mcp-server')
      const cleared = unregisterSessionAllApps(sessionId)
      if (cleared.length > 0) {
        const { clearAllowedMedia } = await import('../miniapp/miniapp-service')
        const { stopMiniAppHost } = await import('../miniapp/miniapp-host')
        for (const { projectDir, appId } of cleared) {
          if (!isAppStillAuthorizedInProject(projectDir, appId)) {
            stopMiniAppHost(projectDir, appId)
            unregisterAppTemplates(projectDir, appId)
            clearAllowedMedia(appId)
          }
        }
      }
    } catch (err) {
      log.warn('[SessionManager] miniapp tool cleanup failed:', err)
    }
    // unregisterSessionAllApps above emits tools-changed, which re-arms the debounced
    // MCP reload for this (now-disposed) session — cancel it last so it never fires.
    cancelMcpReload(sessionId)
    if (this.sessions.size === 0) this.stopRuntimeReaper()
  }

  async disposeAllSessions(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((sessionId) => this.disposeSession(sessionId)))
  }

  on(sessionId: string, handler: (e: AgentEvent) => void): () => void {
    let set = this.scopedListeners.get(sessionId)
    if (!set) {
      set = new Set()
      this.scopedListeners.set(sessionId, set)
    }
    set.add(handler)
    const session = this.sessions.get(sessionId)
    if (session) {
      for (const e of session.getReplayEvents()) {
        try { handler(e) } catch (err) { log.warn('[SessionManager] replay error:', err) }
      }
    }
    return () => { set!.delete(handler) }
  }

  onAny(handler: (sessionId: string, e: AgentEvent) => void): () => void {
    this.anyListeners.add(handler)
    for (const [sid, session] of this.sessions) {
      for (const e of session.getReplayEvents()) {
        try { handler(sid, e) } catch (err) { log.warn('[SessionManager] any-replay error:', err) }
      }
    }
    return () => { this.anyListeners.delete(handler) }
  }

  onSession(handler: (session: SessionContract) => void): () => void {
    this.sessionListeners.add(handler)
    for (const session of this.sessions.values()) {
      try { handler(session) } catch (err) { log.warn('[SessionManager] onSession replay error:', err) }
    }
    return () => { this.sessionListeners.delete(handler) }
  }

  private registerSession(session: Session, projectPath: string): void {
    this.sessions.set(session.id, session)
    this.sessionProjects.set(session.id, projectPath)
    const unsub = session.on((event) => this.dispatch(session.id, event))
    this.perSessionUnsub.set(session.id, unsub)
    this.startRuntimeReaper()
    for (const cb of this.sessionListeners) {
      try { cb(session) } catch (err) { log.warn('[SessionManager] sessionCreated handler error:', err) }
    }
  }

  async reapIdleRuntimes(now = Date.now()): Promise<void> {
    const activeRuntimeCount = Array.from(this.sessions.values())
      .filter((session) => session.hasActiveRuntime())
      .length
    if (activeRuntimeCount === 0) return

    const timeoutMs = getRuntimeIdleTimeoutMs(activeRuntimeCount)
    const releases: Promise<void>[] = []
    for (const session of this.sessions.values()) {
      if (this.runtimeReleases.has(session.id)) continue
      if (!session.isRuntimeIdle(now, timeoutMs)) continue
      this.runtimeReleases.add(session.id)
      releases.push(session.releaseRuntime(
        'idle',
        () => closeSuperoneMcpHttpSessions(session.id),
      )
        .then((released) => {
          if (!released) return
          log.info(
            '[SessionManager] released idle runtime sid=%s harness=%s activeRuntimeCount=%d timeoutMs=%d',
            session.id,
            session.snapshot.harnessId,
            activeRuntimeCount,
            timeoutMs,
          )
        })
        .catch((err) => {
          log.debug('[SessionManager] idle runtime release failed sid=%s:', session.id, err)
        })
        .finally(() => {
          this.runtimeReleases.delete(session.id)
        }))
    }
    await Promise.all(releases)
  }

  private startRuntimeReaper(): void {
    if (this.runtimeReaperTimer) return
    this.runtimeReaperTimer = setInterval(() => {
      void this.reapIdleRuntimes()
    }, SESSION_RUNTIME_REAPER_INTERVAL_MS)
    ;(this.runtimeReaperTimer as { unref?: () => void }).unref?.()
  }

  private stopRuntimeReaper(): void {
    if (!this.runtimeReaperTimer) return
    clearInterval(this.runtimeReaperTimer)
    this.runtimeReaperTimer = null
  }

  private dispatch(sessionId: string, event: AgentEvent): void {
    const projectPath = this.sessionProjects.get(sessionId)
    const enriched = projectPath && !(event as { projectPath?: string }).projectPath
      ? { ...event, projectPath }
      : event
    const scoped = this.scopedListeners.get(sessionId)
    if (scoped) {
      for (const cb of scoped) {
        try { cb(enriched) } catch (err) { log.warn('[SessionManager] scoped listener error:', err) }
      }
    }
    for (const cb of this.anyListeners) {
      try { cb(sessionId, enriched) } catch (err) { log.warn('[SessionManager] anyListener error:', err) }
    }
  }
}
