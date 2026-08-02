import { describe, expect, it } from 'vitest'
import {
  createSimulatedTurnRunner,
  deriveSessionTitleFromUserText,
  forkSessionTitle,
  SessionRuntime,
  type LeaseGuard,
  type NodeSessionRecord,
  type SessionEventLog,
  type SessionStore,
} from './session-runtime'

function session(overrides?: Partial<NodeSessionRecord>): NodeSessionRecord {
  return {
    sessionId: 's1',
    projectId: 'p1',
    harnessId: 'codex',
    providerId: 'codex',
    title: null,
    status: 'idle',
    transcript: [],
    pendingInteraction: null,
    providerResume: null,
    cwd: null,
    createdAt: 0,
    updatedAt: 0,
    isPinned: false,
    isHidden: false,
    ...overrides,
  }
}

function memoryPorts() {
  const rows = new Map<string, NodeSessionRecord>()
  const store: SessionStore = {
    loadAll: () => [...rows.values()].map((s) => ({ ...s, transcript: s.transcript.map((t) => ({ ...t })) })),
    save: (s) => {
      rows.set(s.sessionId, { ...s, transcript: s.transcript.map((t) => ({ ...t })) })
    },
    delete: (id) => {
      rows.delete(id)
    },
  }
  const events: SessionEventLog = {
    headSequence: () => '0',
    listAfter: () => [],
    appendSession: () => {},
  }
  const leases: LeaseGuard = {
    assertValid: () => {},
  }
  return { store, events, leases, rows }
}

describe('deriveSessionTitleFromUserText', () => {
  it('trims and truncates like desktop extractClaudeTitle', () => {
    expect(deriveSessionTitleFromUserText('  hello world  ')).toBe('hello world')
    expect(deriveSessionTitleFromUserText('x'.repeat(120))).toBe(`${'x'.repeat(100)}…`)
    expect(deriveSessionTitleFromUserText('   ')).toBeNull()
  })
})

describe('forkSessionTitle', () => {
  it('appends (fork) once', () => {
    expect(forkSessionTitle('Chat')).toBe('Chat (fork)')
    expect(forkSessionTitle('Chat (fork)')).toBe('Chat (fork)')
    expect(forkSessionTitle(null)).toBe('Session (fork)')
  })
})

describe('SessionRuntime.fork', () => {
  it('clones transcript and sets cwd without sharing providerResume', () => {
    const { store, events, leases } = memoryPorts()
    const rt = new SessionRuntime(store, events, leases, 'env-1', createSimulatedTurnRunner({ delayMs: 0, chunks: ['x'] }))
    const created = rt.create({ projectId: 'p1', harnessId: 'claude', title: 'Orig' })
    // Seed transcript via store mutation path used by create + manual send simulation
    const live = (rt as unknown as { live: Map<string, NodeSessionRecord> }).live.get(created.sessionId)!
    live.transcript = [
      { id: 'u1', role: 'user', text: 'hi', createdAt: 1 },
      { id: 'a1', role: 'assistant', text: 'yo', createdAt: 2 },
    ]
    live.providerResume = 'claude-session:src'
    live.cwd = '/work/app'
    store.save(live)

    const forked = rt.fork({
      sourceSessionId: created.sessionId,
      cwd: '/work/app/.worktrees/abc',
    })
    expect(forked.sessionId).not.toBe(created.sessionId)
    expect(forked.title).toBe('Orig (fork)')
    expect(forked.transcript).toHaveLength(2)
    expect(forked.cwd).toBe('/work/app/.worktrees/abc')
    expect(forked.providerResume).toBeNull()
    expect(forked.projectId).toBe('p1')
    expect(forked.harnessId).toBe('claude')
    // Source untouched
    const src = rt.get(created.sessionId)!
    expect(src.providerResume).toBe('claude-session:src')
    expect(src.cwd).toBe('/work/app')
  })

  it('accepts a new providerResume from harness fork (not the source token)', () => {
    const { store, events, leases } = memoryPorts()
    const rt = new SessionRuntime(store, events, leases, 'env-1', createSimulatedTurnRunner({ delayMs: 0 }))
    const created = rt.create({ projectId: 'p1', title: 'Orig' })
    const live = (rt as unknown as { live: Map<string, NodeSessionRecord> }).live.get(created.sessionId)!
    live.transcript = [{ id: 'u1', role: 'user', text: 'hi', createdAt: 1 }]
    live.providerResume = 'claude-session:src'
    store.save(live)

    const forked = rt.fork({
      sourceSessionId: created.sessionId,
      providerResume: 'claude-session:forked-sdk',
    })
    expect(forked.providerResume).toBe('claude-session:forked-sdk')
    expect(rt.get(created.sessionId)!.providerResume).toBe('claude-session:src')
  })

  it('truncates at forkFromMessageId', () => {
    const { store, events, leases } = memoryPorts()
    const rt = new SessionRuntime(store, events, leases, 'env-1', createSimulatedTurnRunner({ delayMs: 0 }))
    const created = rt.create({ projectId: 'p1', title: 'T' })
    const live = (rt as unknown as { live: Map<string, NodeSessionRecord> }).live.get(created.sessionId)!
    live.transcript = [
      { id: 'u1', role: 'user', text: 'a', createdAt: 1 },
      { id: 'a1', role: 'assistant', text: 'b', createdAt: 2 },
      { id: 'u2', role: 'user', text: 'c', createdAt: 3 },
    ]
    store.save(live)
    const forked = rt.fork({ sourceSessionId: created.sessionId, forkFromMessageId: 'a1' })
    expect(forked.transcript.map((t) => t.id)).toEqual(['u1', 'a1'])
  })

  it('rejects empty session with no resume', () => {
    const { store, events, leases } = memoryPorts()
    const rt = new SessionRuntime(store, events, leases, 'env-1', createSimulatedTurnRunner({ delayMs: 0 }))
    const created = rt.create({ projectId: 'p1' })
    expect(() => rt.fork({ sourceSessionId: created.sessionId })).toThrow(/no conversation/)
  })
})

describe('createSimulatedTurnRunner', () => {
  it('streams chunks via onDelta', async () => {
    const runner = createSimulatedTurnRunner({
      delayMs: 0,
      chunks: ['a', 'b'],
    })
    const deltas: string[] = []
    const result = await runner({
      session: session(),
      text: 'hi',
      onDelta: (d) => deltas.push(d),
      signal: new AbortController().signal,
    })
    expect(result.finalText).toBe('ab')
    expect(deltas).toEqual(['a', 'b'])
  })
})
