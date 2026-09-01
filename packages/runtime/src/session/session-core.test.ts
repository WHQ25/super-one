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
import { SESSION_TITLE_MAX_CHARS } from '@superone/shared/session-title'

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
    permissionMode: null,
    sandboxMode: null,
    model: null,
    effort: null,
    apiProviderId: null,
    createdAt: 0,
    updatedAt: 0,
    isPinned: false,
    isHidden: false,
    isUserRenamed: false,
    tags: [],
    controllerClientSessionId: null,
    hostActionCapabilityVersion: 0,
    hostActionToolGroups: [],
    alwaysAllowedTools: [],
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
    expect(deriveSessionTitleFromUserText('x'.repeat(SESSION_TITLE_MAX_CHARS + 20))).toBe(
      `${'x'.repeat(SESSION_TITLE_MAX_CHARS)}…`,
    )
    expect(deriveSessionTitleFromUserText('   ')).toBeNull()
  })

  it('uses session title label, not raw superone-session markup', () => {
    const raw =
      ' <superone-session><title>测试 Seedream 首帧 + S</title><sessionId>uuid-1</sessionId></superone-session> 用这个测'
    expect(deriveSessionTitleFromUserText(raw)).toBe('@测试 Seedream 首帧 + S 用这个测')
  })
})

describe('forkSessionTitle', () => {
  it('appends (fork) once', () => {
    expect(forkSessionTitle('Chat')).toBe('Chat (fork)')
    expect(forkSessionTitle('Chat (fork)')).toBe('Chat (fork)')
    expect(forkSessionTitle(null)).toBe('Session (fork)')
  })
})

describe('SessionRuntime.list pagination', () => {
  it('sorts newest-first then applies limit/offset', () => {
    const { store, events, leases, rows } = memoryPorts()
    for (let i = 0; i < 5; i++) {
      const id = `s${i}`
      rows.set(
        id,
        session({
          sessionId: id,
          projectId: 'p1',
          title: `t${i}`,
          createdAt: i * 1000,
          updatedAt: i * 1000,
        }),
      )
    }
    rows.set(
      'other',
      session({
        sessionId: 'other',
        projectId: 'p2',
        title: 'other',
        updatedAt: 99_000,
      }),
    )
    const rt = new SessionRuntime(
      store,
      events,
      leases,
      'env-list',
      createSimulatedTurnRunner(),
    )
    const page0 = rt.list('p1', { limit: 2, offset: 0 })
    expect(page0.map((s) => s.sessionId)).toEqual(['s4', 's3'])
    const page1 = rt.list('p1', { limit: 2, offset: 2 })
    expect(page1.map((s) => s.sessionId)).toEqual(['s2', 's1'])
    const rest = rt.list('p1', { limit: 2, offset: 4 })
    expect(rest.map((s) => s.sessionId)).toEqual(['s0'])
    expect(rt.list('p1').map((s) => s.sessionId)).toEqual(['s4', 's3', 's2', 's1', 's0'])
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

describe('SessionRuntime.patchSettings + send fallbacks', () => {
  it('persists settings and uses stored model when send omits model', async () => {
    const { store, events, leases, rows } = memoryPorts()
    let seenModel: string | null | undefined
    const runner: import('./types').TurnRunner = async (input) => {
      seenModel = input.model
      input.onDelta('ok')
      return { finalText: 'ok', providerResume: 'resume-1' }
    }
    const rt = new SessionRuntime(store, events, leases, 'env-1', runner)
    const created = rt.create({ projectId: 'p1', harnessId: 'claude' })
    expect(created.model).toBeNull()

    const patched = rt.patchSettings(created.sessionId, {
      model: 'claude-opus-4',
      effort: 'high',
      permissionMode: 'acceptEdits',
      sandboxMode: 'workspace-write',
      apiProviderId: 'cred-1',
    })
    expect(patched.model).toBe('claude-opus-4')
    expect(patched.effort).toBe('high')
    expect(patched.permissionMode).toBe('acceptEdits')
    expect(patched.sandboxMode).toBe('workspace-write')
    expect(patched.apiProviderId).toBe('cred-1')
    // Durable row updated
    expect(rows.get(created.sessionId)?.model).toBe('claude-opus-4')

    await rt.send({
      sessionId: created.sessionId,
      text: 'hi',
      client: { clientSessionId: 'c1' },
      leaseId: 'l1',
      generation: '1',
      // no model — must fall back to stored
    })
    for (let i = 0; i < 40; i++) {
      if (rt.get(created.sessionId)?.status === 'idle') break
      await new Promise((r) => setTimeout(r, 5))
    }
    expect(seenModel).toBe('claude-opus-4')
    expect(rt.get(created.sessionId)?.providerResume).toBe('resume-1')
  })

  it('lets send options override stored settings', async () => {
    const { store, events, leases } = memoryPorts()
    let seenModel: string | null | undefined
    const runner: import('./types').TurnRunner = async (input) => {
      seenModel = input.model
      input.onDelta('x')
      return { finalText: 'x', providerResume: null }
    }
    const rt = new SessionRuntime(store, events, leases, 'env-1', runner)
    const created = rt.create({ projectId: 'p1' })
    rt.patchSettings(created.sessionId, { model: 'stored-model' })
    await rt.send({
      sessionId: created.sessionId,
      text: 'hi',
      client: { clientSessionId: 'c1' },
      leaseId: 'l1',
      generation: '1',
      model: 'override-model',
    })
    for (let i = 0; i < 40; i++) {
      if (rt.get(created.sessionId)?.status === 'idle') break
      await new Promise((r) => setTimeout(r, 5))
    }
    expect(seenModel).toBe('override-model')
  })

  it('null patch clears a stored default', () => {
    const { store, events, leases } = memoryPorts()
    const rt = new SessionRuntime(store, events, leases, 'env-1', createSimulatedTurnRunner({ delayMs: 0 }))
    const created = rt.create({ projectId: 'p1' })
    rt.patchSettings(created.sessionId, { model: 'm1' })
    const cleared = rt.patchSettings(created.sessionId, { model: null })
    expect(cleared.model).toBeNull()
  })
})

describe('SessionRuntime.setTags', () => {
  it('persists tags on the live record', () => {
    const { store, events, leases } = memoryPorts()
    const rt = new SessionRuntime(store, events, leases, 'env-1', createSimulatedTurnRunner({ delayMs: 0 }))
    const created = rt.create({ projectId: 'p1', title: 'Auto' })
    const out = rt.setTags(created.sessionId, ['oauth', 'auth'])
    expect(out.tags).toEqual(['oauth', 'auth'])
    expect(rt.get(created.sessionId)!.tags).toEqual(['oauth', 'auth'])
  })
})

describe('SessionRuntime.rename', () => {
  it('allows agent rename when unlocked and stamps source on the event', () => {
    const { store, events, leases } = memoryPorts()
    const appended: Array<{ eventType: string; payload: unknown }> = []
    events.appendSession = (e) => {
      appended.push({ eventType: e.eventType, payload: e.payload })
    }
    const rt = new SessionRuntime(store, events, leases, 'env-1', createSimulatedTurnRunner({ delayMs: 0 }))
    const created = rt.create({ projectId: 'p1', title: 'Auto' })
    const out = rt.rename(created.sessionId, 'Agent Title', 'agent')
    expect(out.title).toBe('Agent Title')
    expect(out.isUserRenamed).toBe(false)
    expect(rt.get(created.sessionId)!.title).toBe('Agent Title')
    const renamed = appended.find((e) => e.eventType === 'session.renamed')
    expect(renamed?.payload).toEqual({ title: 'Agent Title', source: 'agent' })
  })

  it('user rename locks the title and always wins', () => {
    const { store, events, leases } = memoryPorts()
    const rt = new SessionRuntime(store, events, leases, 'env-1', createSimulatedTurnRunner({ delayMs: 0 }))
    const created = rt.create({ projectId: 'p1', title: 'Auto' })
    const out = rt.rename(created.sessionId, 'My Name', 'user')
    expect(out.title).toBe('My Name')
    expect(out.isUserRenamed).toBe(true)
    // Second user rename still succeeds.
    const again = rt.rename(created.sessionId, 'New User Name', 'user')
    expect(again.title).toBe('New User Name')
    expect(again.isUserRenamed).toBe(true)
  })

  it('rejects agent rename after a user rename (user_locked), leaving title unchanged', () => {
    const { store, events, leases } = memoryPorts()
    const rt = new SessionRuntime(store, events, leases, 'env-1', createSimulatedTurnRunner({ delayMs: 0 }))
    const created = rt.create({ projectId: 'p1', title: 'Auto' })
    rt.rename(created.sessionId, 'User Locked', 'user')
    try {
      rt.rename(created.sessionId, 'Agent Overwrite', 'agent')
      expect.unreachable('agent rename should throw')
    } catch (err) {
      expect((err as { code?: string }).code).toBe('user_locked')
      expect((err as Error).message).toBe('user_locked')
    }
    const got = rt.get(created.sessionId)!
    expect(got.title).toBe('User Locked')
    expect(got.isUserRenamed).toBe(true)
  })
})
