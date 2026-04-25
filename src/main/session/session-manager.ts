import { randomUUID } from 'crypto'
import { existsSync } from 'fs'
import { homedir } from 'os'
import type { AgentEvent, ChatMessage, RemoteActiveProvider } from '../../shared/agent-types'
import type { HarnessId } from './types'
import log from '../logger'
import { discoverProjectAgents, discoverProjectCommands, discoverSkills } from '../agent/discover-resources'
import { readProjectAdditionalDirs } from '../agent/project-additional-dirs'
import { harnessRegistry } from './harness-registry'
import { getSessionProvider } from './session-provider-repo'
import { ProjectResourceCache } from './project-resource-cache'
import { Session } from './session'
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
  worktreePath?: string | null
  gitBranch?: string | null
}

export interface SessionManagerPersistence {
  onSessionCreated?: (session: { id: string; projectPath: string; providerId: string }) => void
  onSessionDisposed?: (sessionId: string) => void
  onSessionStateChange?: (snapshot: SessionStateChange) => void
  onProviderSessionIdChange?: (sid: string, providerSessionId: string) => void
  loadSession?: (sessionId: string) => LoadedSessionData | null
  resolveProviderConfig?: (provider: SessionProvider) => unknown
  getActiveProvider?: (harnessId: HarnessId) => RemoteActiveProvider | null
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
  private perSessionUnsub = new Map<string, () => void>()
  private persistence: SessionManagerPersistence

  constructor(persistence: SessionManagerPersistence = {}) {
    this.persistence = persistence
    this.projectResources = new ProjectResourceCache({
      discoverSkills,
      discoverProjectCommands,
      discoverProjectAgents,
      discoverAdditionalDirectories: readProjectAdditionalDirs,
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
      out.push({
        sid,
        projectPath,
        isActive: this.activeByProject.get(projectPath) === sid,
        isStreaming: session.isStreaming(),
        permissionMode: session.getCurrentPermissionMode(),
        sandboxInfo: session.getCurrentSandboxInfo(),
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
    const providerConfig = this.persistence.resolveProviderConfig
      ? this.persistence.resolveProviderConfig(provider)
      : provider.config
    const sandboxInfo = opts.sandboxMode !== undefined
      ? { enabled: opts.sandboxMode !== 'off', autoAllowBash: opts.sandboxMode === 'auto' }
      : undefined
    const session = new Session({
      id: sessionId,
      projectPath: opts.projectPath,
      cwd,
      providerId: provider.id,
      harnessId: provider.harnessId,
      providerConfig,
      backend,
      permissionMode: opts.permissionMode,
      sandboxInfo,
      effort: opts.effort,
      model: opts.model ?? undefined,
      additionalDirectories: opts.additionalDirectories,
      gitBranch: opts.gitBranch ?? null,
      homedir: homedir(),
      getProjectResources: (c) => this.projectResources.get(c),
      invalidateProjectResources: (c) => this.projectResources.invalidate(c),
      onStateChange: this.persistence.onSessionStateChange
        ? (snapshot) => this.persistence.onSessionStateChange!(snapshot)
        : undefined,
      onProviderSessionIdChange: this.persistence.onProviderSessionIdChange
        ? (sid, providerSessionId) => this.persistence.onProviderSessionIdChange!(sid, providerSessionId)
        : undefined,
      getActiveProvider: this.persistence.getActiveProvider
        ? (h) => this.persistence.getActiveProvider!(h)
        : undefined,
    })

    this.registerSession(session, opts.projectPath)
    this.activeByProject.set(opts.projectPath, sessionId)
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
    this.activeByProject.set(projectPath, sessionId)
  }

  clearActiveSession(projectPath: string): void {
    this.activeByProject.delete(projectPath)
  }

  resumeSession(sessionId: string, opts?: { permissionMode?: import('../../shared/agent-types').PermissionMode; sandboxMode?: import('../../shared/agent-types').SandboxMode }): SessionContract {
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
    const providerConfig = this.persistence.resolveProviderConfig
      ? this.persistence.resolveProviderConfig(provider)
      : provider.config
    const { cwd: resumedCwd, missingWorktreePath } = resolveResumedCwd(data)
    const sandboxInfo = opts?.sandboxMode !== undefined
      ? { enabled: opts.sandboxMode !== 'off', autoAllowBash: opts.sandboxMode === 'auto' }
      : undefined
    const session = new Session({
      id: sessionId,
      projectPath: data.projectPath,
      cwd: resumedCwd,
      providerId: provider.id,
      harnessId: provider.harnessId,
      providerConfig,
      backend,
      permissionMode: opts?.permissionMode,
      sandboxInfo,
      resumedProviderSessionId: data.providerSessionId ?? undefined,
      initialMessages: data.messages,
      initialTotalCostUsd: data.totalCostUsd,
      initialContextTokens: data.contextTokens,
      gitBranch: data.gitBranch ?? null,
      missingWorktreePath,
      homedir: homedir(),
      getProjectResources: (c) => this.projectResources.get(c),
      invalidateProjectResources: (c) => this.projectResources.invalidate(c),
      onStateChange: this.persistence.onSessionStateChange
        ? (snapshot) => this.persistence.onSessionStateChange!(snapshot)
        : undefined,
      onProviderSessionIdChange: this.persistence.onProviderSessionIdChange
        ? (sid, providerSessionId) => this.persistence.onProviderSessionIdChange!(sid, providerSessionId)
        : undefined,
      getActiveProvider: this.persistence.getActiveProvider
        ? (h) => this.persistence.getActiveProvider!(h)
        : undefined,
    })

    this.registerSession(session, data.projectPath)
    this.activeByProject.set(data.projectPath, sessionId)
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
    const resolver = this.persistence.resolveProviderConfig
    for (const session of this.sessions.values()) {
      if (harnessId && session.snapshot.harnessId !== harnessId) continue
      const provider = getSessionProvider(session.snapshot.providerId)
      if (!provider) continue
      const nextConfig = resolver ? resolver(provider) : provider.config
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
    const projectPath = this.sessionProjects.get(sessionId)
    this.sessions.delete(sessionId)
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

  private registerSession(session: Session, projectPath: string): void {
    this.sessions.set(session.id, session)
    this.sessionProjects.set(session.id, projectPath)
    const unsub = session.on((event) => this.dispatch(session.id, event))
    this.perSessionUnsub.set(session.id, unsub)
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
