import { vi } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import type { Session, SessionCreateOptions, SessionManager } from './types'

const TEST_CWD = process.cwd()

export function fakeSession(
  id: string,
  eventsOrOpts: AgentEvent[] | { events?: AgentEvent[]; cwd?: string; projectPath?: string } = [],
): Session {
  const opts = Array.isArray(eventsOrOpts) ? { events: eventsOrOpts } : eventsOrOpts
  const events = opts.events ?? []
  const listeners = new Set<(event: AgentEvent) => void>()
  return {
    id,
    projectPath: opts.projectPath ?? TEST_CWD,
    cwd: opts.cwd ?? TEST_CWD,
    snapshot: { id, providerId: 'claude-base', harnessId: 'claude', status: 'idle' } as never,
    emitHostEvent: vi.fn((event: AgentEvent) => events.push(event)),
    send: vi.fn(async () => {}),
    setTitle: vi.fn(),
    isStreaming: vi.fn(() => false),
    activityStatus: vi.fn(() => 'idle'),
    getPendingInteractions: vi.fn(() => []),
    lastRuntimeActivityAt: 0,
    admitTaskNotification: vi.fn(async () => {}),
    injectTaskNotification: vi.fn(async () => {}),
    appendTranscriptMessage: vi.fn(),
    on: vi.fn((handler: (event: AgentEvent) => void) => {
      listeners.add(handler)
      return () => { listeners.delete(handler) }
    }),
  } as unknown as Session
}

export function fakeHost(parent: Session, options: { activeSessionId?: string | null } = {}) {
  const sessions = new Map<string, Session>([[parent.id, parent]])
  const createSession = vi.fn((options: SessionCreateOptions) => {
    const child = fakeSession(options.id!)
    sessions.set(child.id, child)
    return child
  })
  // Active session is per project in the real manager — a child attributed to
  // another project must not disturb the parent project's routing, and vice versa.
  const activeByProject = new Map<string, string>()
  const initialActive = options.activeSessionId === undefined ? parent.id : options.activeSessionId
  if (initialActive) activeByProject.set(parent.projectPath, initialActive)
  const host = {
    getSession: (id: string) => sessions.get(id) ?? null,
    getActiveSession: (projectPath: string) => {
      const activeId = activeByProject.get(projectPath)
      return activeId ? sessions.get(activeId) ?? null : null
    },
    setActiveSession: (projectPath: string, sessionId: string) => {
      if (!sessions.has(sessionId)) throw new Error(`Session not found: ${sessionId}`)
      activeByProject.set(projectPath, sessionId)
    },
    clearActiveSession: (projectPath: string) => {
      activeByProject.delete(projectPath)
    },
    createSession: vi.fn((options: SessionCreateOptions) => {
      const child = createSession(options)
      activeByProject.set(options.projectPath, child.id)
      return child
    }),
    disposeSession: vi.fn(async (id: string) => { sessions.delete(id) }),
    resumeSession: vi.fn((id: string) => {
      const existing = sessions.get(id)
      if (existing) return existing
      throw new Error(`Session ${id} not found`)
    }),
  } as unknown as SessionManager
  return {
    host,
    sessions,
    createSession: host.createSession as ReturnType<typeof vi.fn>,
    activeIn: (projectPath: string) => activeByProject.get(projectPath) ?? null,
  }
}
