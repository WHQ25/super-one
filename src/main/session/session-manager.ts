import { randomUUID } from 'crypto'
import type { AgentEvent } from '../../shared/agent-types'
import log from '../logger'
import { discoverProjectAgents, discoverProjectCommands, discoverSkills } from '../agent/discover-resources'
import { harnessRegistry } from './harness-registry'
import { getSessionProvider } from './session-provider-repo'
import { ProjectResourceCache } from './project-resource-cache'
import { Session } from './session'
import type {
  ProjectResources,
  Session as SessionContract,
  SessionCreateOptions,
  SessionManager as SessionManagerContract,
  SessionSnapshot,
  SessionStateChange,
} from './types'

export interface SessionManagerPersistence {
  onSessionCreated?: (session: { id: string; projectPath: string; providerId: string }) => void
  onSessionDisposed?: (sessionId: string) => void
  onSessionStateChange?: (snapshot: SessionStateChange) => void
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
    })
  }

  openProject(projectPath: string): void {
    this.projectResources.get(projectPath)
  }

  async closeProject(projectPath: string): Promise<void> {
    const targets: string[] = []
    for (const [sid, pp] of this.sessionProjects) {
      if (pp === projectPath) targets.push(sid)
    }
    for (const sid of targets) {
      await this.disposeSession(sid)
    }
    this.projectResources.invalidate(projectPath)
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

  getProjectResources(projectPath: string): ProjectResources {
    return this.projectResources.get(projectPath)
  }

  invalidateProjectResources(projectPath: string): void {
    this.projectResources.invalidate(projectPath)
  }

  createSession(opts: SessionCreateOptions): SessionContract {
    const provider = getSessionProvider(opts.providerId)
    if (!provider) throw new Error(`SessionProvider not found: ${opts.providerId}`)
    const harness = harnessRegistry.get(provider.harnessId)
    if (!harness) throw new Error(`Harness not registered: ${provider.harnessId}`)

    const sessionId = randomUUID()
    const cwd = opts.cwd ?? opts.projectPath
    const backend = harness.createBackend()
    const session = new Session({
      id: sessionId,
      projectPath: opts.projectPath,
      cwd,
      providerId: provider.id,
      harnessId: provider.harnessId,
      providerConfig: provider.config,
      backend,
      permissionMode: opts.permissionMode,
      effort: opts.effort,
      model: opts.model ?? undefined,
      additionalDirectories: opts.additionalDirectories,
      onStateChange: this.persistence.onSessionStateChange
        ? (snapshot) => this.persistence.onSessionStateChange!(snapshot)
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

  resumeSession(sessionId: string): SessionContract {
    const existing = this.sessions.get(sessionId)
    if (existing) return existing
    throw new Error(`resumeSession from DB not yet implemented: ${sessionId}`)
  }

  getSession(sessionId: string): SessionContract | null {
    return this.sessions.get(sessionId) ?? null
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
    return () => { set!.delete(handler) }
  }

  onAny(handler: (sessionId: string, e: AgentEvent) => void): () => void {
    this.anyListeners.add(handler)
    return () => { this.anyListeners.delete(handler) }
  }

  private registerSession(session: Session, projectPath: string): void {
    this.sessions.set(session.id, session)
    this.sessionProjects.set(session.id, projectPath)
    const unsub = session.on((event) => this.dispatch(session.id, event))
    this.perSessionUnsub.set(session.id, unsub)
  }

  private dispatch(sessionId: string, event: AgentEvent): void {
    const scoped = this.scopedListeners.get(sessionId)
    if (scoped) {
      for (const cb of scoped) {
        try { cb(event) } catch (err) { log.warn('[SessionManager] scoped listener error:', err) }
      }
    }
    for (const cb of this.anyListeners) {
      try { cb(sessionId, event) } catch (err) { log.warn('[SessionManager] anyListener error:', err) }
    }
  }
}
