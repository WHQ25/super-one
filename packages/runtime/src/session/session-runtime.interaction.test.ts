/**
 * Question / plan interaction waiters (P0 remote node).
 */
import { describe, expect, it } from 'vitest'
import {
  SessionRuntime,
  createSimulatedTurnRunner,
  type LeaseGuard,
  type NodeSessionRecord,
  type SessionEventLog,
  type SessionStore,
  type TurnRunner,
} from './session-runtime'

function memoryPorts(leases?: LeaseGuard) {
  const rows = new Map<string, NodeSessionRecord>()
  const store: SessionStore = {
    loadAll: () =>
      [...rows.values()].map((s) => ({
        ...s,
        transcript: s.transcript.map((t) => ({ ...t })),
      })),
    save: (s) => {
      rows.set(s.sessionId, {
        ...s,
        transcript: s.transcript.map((t) => ({ ...t })),
      })
    },
    delete: (id) => {
      rows.delete(id)
    },
  }
  const eventTypes: string[] = []
  const events: SessionEventLog = {
    headSequence: () => String(eventTypes.length),
    epoch: 'test', streamingAfter: () => [], streaming: () => [], onAppend: () => () => {},
    listAfter: () => [],
    appendSession: (input) => {
      eventTypes.push(input.eventType)
    },
  }
  const defaultLeases: LeaseGuard = {
    assertValid: () => {},
  }
  return { store, events, leases: leases ?? defaultLeases, eventTypes }
}

async function waitForPending(
  runtime: SessionRuntime,
  sessionId: string,
  kind: 'question' | 'plan' | 'permission',
  attempts = 80,
): Promise<string> {
  for (let i = 0; i < attempts; i++) {
    const s = runtime.get(sessionId)
    if (s?.pendingInteraction?.interactionId && s.pendingInteraction.kind === kind) {
      return s.pendingInteraction.interactionId
    }
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error(`pending ${kind} not observed`)
}

async function waitIdle(runtime: SessionRuntime, sessionId: string, attempts = 120) {
  for (let i = 0; i < attempts; i++) {
    const s = runtime.get(sessionId)
    if (s && s.status !== 'streaming') return s
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error('session never left streaming')
}

const client = { clientSessionId: 'client-1' }
const lease = { leaseId: 'lease-1', generation: 'gen-1' }

describe('SessionRuntime question / plan', () => {
  it('interrupts an ambient native execution even when no ordinary turn owns an abort', async () => {
    const { store, events, leases } = memoryPorts()
    const runner: TurnRunner = async () => ({ finalText: '' })
    let interrupted = false
    runner.callOperation = async (_session, _method, _input, host) => {
      host.onEvent({ type: 'message_start', message: { id: 'ambient', role: 'assistant', providerId: 'opencode', status: 'streaming', content: [], createdAt: new Date().toISOString() } })
      runner.interruptSession = async () => {
        interrupted = true
        host.onEvent({ type: 'message_interrupted', messageId: 'ambient' })
      }
      return { ok: true }
    }
    const runtime = new SessionRuntime(store, events, leases, 'env', runner)
    const session = runtime.create({ projectId: 'p', harnessId: 'opencode' })
    try {
      await runtime.callOperation(session.sessionId, 'session.inbox.update', { inboxId: 'native', delivery: 'steer' })
      expect(runtime.get(session.sessionId)?.status).toBe('streaming')
      runtime.interrupt(session.sessionId, { clientSessionId: 'client' }, 'lease', 'generation')
      expect(interrupted).toBe(true)
      expect(runtime.get(session.sessionId)?.status).toBe('interrupted')
    } finally { await runtime.dispose() }
  })
  it('captures each queued OpenCode agent choice independently of later selections', async () => {
    const { store, events, leases } = memoryPorts()
    const agents: Array<string | null | undefined> = []
    let release!: () => void
    const hold = new Promise<void>(resolve => { release = resolve })
    const runtime = new SessionRuntime(store, events, leases, 'env-q', async input => {
      agents.push(input.agent)
      if (input.text === 'first') await hold
      return { finalText: 'done', providerResume: null }
    })
    const session = runtime.create({ projectId: 'p', harnessId: 'opencode' })
    try {
      for (const [text, agent] of [['first', 'build'], ['second', 'plan'], ['third', 'review']])
        await runtime.send({ sessionId: session.sessionId, text, agent, client, ...lease })
      release()
      await waitIdle(runtime, session.sessionId)
      expect(agents).toEqual(['build', 'plan', 'review'])
      expect(store.loadAll()[0]?.agent).toBe('review')
    } finally { release(); await runtime.dispose() }
  })

  it('keeps native OpenCode permission requests interactive despite legacy bypass presets', async () => {
    const { store, events, leases } = memoryPorts()
    let decision: string | undefined
    const runtime = new SessionRuntime(store, events, leases, 'env-q', async input => {
      decision = await input.onPermission?.({ interactionId: 'native-permission', kind: 'permission',
        toolName: 'Edit', input: { file: '/protected' }, createdAt: Date.now(),
        permissionDetails: { action: 'edit', resources: ['/protected'] }, allowAlwaysAllow: false })
      return { finalText: '', providerResume: null }
    })
    const session = runtime.create({ projectId: 'p', harnessId: 'opencode', permissionMode: 'bypassPermissions' })
    try {
      await runtime.send({ sessionId: session.sessionId, text: 'edit', client, ...lease })
      const interactionId = await waitForPending(runtime, session.sessionId, 'permission')
      expect(decision).toBeUndefined()
      expect(() => runtime.respondPermission({ sessionId: session.sessionId, interactionId, decision: 'allow_always', client, ...lease })).toThrow('allow once or deny')
      runtime.respondPermission({ sessionId: session.sessionId, interactionId, decision: 'deny', client, ...lease })
      await waitIdle(runtime, session.sessionId)
      expect(decision).toBe('deny')
    } finally { await runtime.dispose() }
  })

  it('refuses unsupported native composer options before appending a user turn', async () => {
    const { store, events, leases, eventTypes } = memoryPorts()
    const runtime = new SessionRuntime(store, events, leases, 'env-q', createSimulatedTurnRunner())
    const session = runtime.create({ projectId: 'p1', harnessId: 'claude' })
    await expect(runtime.send({ sessionId: session.sessionId, text: 'queued', priority: 'later', client, ...lease })).rejects.toThrow('does not support desktop composer send selections')
    expect(runtime.get(session.sessionId)?.transcript).toEqual([])
    expect(eventTypes).not.toContain('session.turn_started')
    await runtime.dispose()
  })

  it('dismisses a question through the fenced response without recording an answer', async () => {
    const { store, events, leases, eventTypes } = memoryPorts()
    const runtime = new SessionRuntime(store, events, leases, 'env-q', createSimulatedTurnRunner({ delayMs: 5, chunks: ['ok'], requestQuestion: true }))
    const session = runtime.create({ projectId: 'p1', harnessId: 'codex' })
    await runtime.send({ sessionId: session.sessionId, text: 'ask me', client, ...lease })
    const interactionId = await waitForPending(runtime, session.sessionId, 'question')
    runtime.respondQuestion({ sessionId: session.sessionId, interactionId, answers: {}, dismiss: true, client, ...lease })
    await waitIdle(runtime, session.sessionId)
    expect(eventTypes).toContain('session.question_aborted')
    expect(eventTypes).not.toContain('session.question_responded')
    await runtime.dispose()
  })

  it('refuses unsupported desktop settings before changing any node defaults', () => {
    const { store, events, leases } = memoryPorts()
    const runtime = new SessionRuntime(store, events, leases, 'env-q', createSimulatedTurnRunner())
    const session = runtime.create({ projectId: 'p1', harnessId: 'claude', model: 'original' })
    for (const field of ['mode', 'serviceTier', 'permissionPreset', 'collaborationMode', 'agent']) {
      expect(() => runtime.patchSettings(session.sessionId, { model: 'new', [field]: 'unsupported' })).toThrow('does not support desktop harness settings')
    }
    expect(runtime.get(session.sessionId)?.model).toBe('original')
  })

  it('persists OpenCode agent selection and an early native resume id even when preparation later fails', async () => {
    const { store, events, leases } = memoryPorts()
    const runtime = new SessionRuntime(store, events, leases, 'env-q', async (input) => {
      expect(input.session.agent).toBe('plan')
      input.onProviderResume?.('opencode:native')
      throw new Error('preparation failed')
    })
    const session = runtime.create({ projectId: 'p1', harnessId: 'opencode' })
    runtime.patchSettings(session.sessionId, { agent: 'plan' })
    await runtime.send({ sessionId: session.sessionId, text: 'go', clientMessageId: 'user', client: { clientSessionId: 'client' }, leaseId: 'lease', generation: '1' })
    await waitIdle(runtime, session.sessionId)
    expect(runtime.get(session.sessionId)?.providerResume).toBe('opencode:native')
    expect(store.loadAll()[0]).toMatchObject({ agent: 'plan', providerResume: 'opencode:native' })
    await runtime.dispose()
  })

  it('respondQuestion continues the turn', async () => {
    const { store, events, leases, eventTypes } = memoryPorts()
    const runtime = new SessionRuntime(
      store,
      events,
      leases,
      'env-q',
      createSimulatedTurnRunner({ delayMs: 5, chunks: ['ok'], requestQuestion: true }),
    )
    const session = runtime.create({ projectId: 'p1', harnessId: 'codex' })
    runtime.send({
      sessionId: session.sessionId,
      text: 'ask me',
      client,
      leaseId: lease.leaseId,
      generation: lease.generation,
    })

    const interactionId = await waitForPending(runtime, session.sessionId, 'question')
    runtime.respondQuestion({
      sessionId: session.sessionId,
      interactionId,
      answers: { Continue: 'Yes' },
      client,
      leaseId: lease.leaseId,
      generation: lease.generation,
    })

    const done = await waitIdle(runtime, session.sessionId)
    expect(done.status).toBe('idle')
    expect(done.transcript.some((t) => t.role === 'assistant' && t.text.includes('ok'))).toBe(true)
    expect(eventTypes).toContain('session.question_requested')
    expect(eventTypes).toContain('session.question_responded')
  })

  it('respondPlan reject ends turn with Plan rejected', async () => {
    const { store, events, leases } = memoryPorts()
    const runtime = new SessionRuntime(
      store,
      events,
      leases,
      'env-p',
      createSimulatedTurnRunner({ delayMs: 5, chunks: ['done'], requestPlan: true }),
    )
    const session = runtime.create({ projectId: 'p1', harnessId: 'codex' })
    runtime.send({
      sessionId: session.sessionId,
      text: 'plan',
      client,
      leaseId: lease.leaseId,
      generation: lease.generation,
    })

    const interactionId = await waitForPending(runtime, session.sessionId, 'plan')
    runtime.respondPlan({
      sessionId: session.sessionId,
      interactionId,
      decision: 'reject',
      client,
      leaseId: lease.leaseId,
      generation: lease.generation,
    })

    const done = await waitIdle(runtime, session.sessionId)
    expect(done.status).toBe('idle')
    expect(done.transcript.some((t) => t.text.includes('Plan rejected'))).toBe(true)
  })

  it('respondPermission rejects when pending kind is question', async () => {
    const { store, events, leases } = memoryPorts()
    const runtime = new SessionRuntime(
      store,
      events,
      leases,
      'env-m',
      createSimulatedTurnRunner({ delayMs: 5, chunks: ['ok'], requestQuestion: true }),
    )
    const session = runtime.create({ projectId: 'p1', harnessId: 'codex' })
    runtime.send({
      sessionId: session.sessionId,
      text: 'ask',
      client,
      leaseId: lease.leaseId,
      generation: lease.generation,
    })
    const interactionId = await waitForPending(runtime, session.sessionId, 'question')

    expect(() =>
      runtime.respondPermission({
        sessionId: session.sessionId,
        interactionId,
        decision: 'allow',
        client,
        leaseId: lease.leaseId,
        generation: lease.generation,
      }),
    ).toThrow(/no matching pending permission/)

    runtime.respondQuestion({
      sessionId: session.sessionId,
      interactionId,
      answers: {},
      client,
      leaseId: lease.leaseId,
      generation: lease.generation,
    })
    await waitIdle(runtime, session.sessionId)
  })

  it('unauthorized client cannot respondQuestion (lease assert)', async () => {
    let allowLease = true
    const leases: LeaseGuard = {
      assertValid: () => {
        if (!allowLease) {
          throw Object.assign(new Error('lease not held'), { code: 'forbidden' })
        }
      },
    }
    const { store, events } = memoryPorts(leases)
    const runtime = new SessionRuntime(
      store,
      events,
      leases,
      'env-f',
      createSimulatedTurnRunner({ delayMs: 5, chunks: ['ok'], requestQuestion: true }),
    )
    const session = runtime.create({ projectId: 'p1', harnessId: 'codex' })
    runtime.send({
      sessionId: session.sessionId,
      text: 'ask',
      client,
      leaseId: lease.leaseId,
      generation: lease.generation,
    })
    const interactionId = await waitForPending(runtime, session.sessionId, 'question')

    allowLease = false
    expect(() =>
      runtime.respondQuestion({
        sessionId: session.sessionId,
        interactionId,
        answers: {},
        client,
        leaseId: lease.leaseId,
        generation: lease.generation,
      }),
    ).toThrow(/lease not held/)

    allowLease = true
    runtime.respondQuestion({
      sessionId: session.sessionId,
      interactionId,
      answers: {},
      client,
      leaseId: lease.leaseId,
      generation: lease.generation,
    })
    await waitIdle(runtime, session.sessionId)
  })
})


describe('Codex per-conversation accounts', () => {
  it('pins new defaults, preserves null turn selections, and rejects a cross-account continuation', async () => {
    const { store, events, leases } = memoryPorts()
    const a = 'codex-account:11111111-1111-4111-8111-111111111111'
    const b = 'codex-account:22222222-2222-4222-8222-222222222222'
    let defaultId = a
    const runtime = new SessionRuntime(store, events, leases, 'accounts', createSimulatedTurnRunner({ delayMs: 1, chunks: ['ok'] }), { defaultApiProviderId: () => defaultId })
    const first = runtime.create({ projectId: 'p', harnessId: 'codex' })
    defaultId = b
    const second = runtime.create({ projectId: 'p', harnessId: 'codex' })
    expect(first.apiProviderId).toBe(a)
    expect(second.apiProviderId).toBe(b)
    await runtime.send({ sessionId: first.sessionId, text: 'hello', apiProviderId: null, client, ...lease })
    await waitIdle(runtime, first.sessionId)
    expect(runtime.get(first.sessionId)?.apiProviderId).toBe(a)
    const count = runtime.get(first.sessionId)!.transcript.length
    await expect(runtime.send({ sessionId: first.sessionId, text: 'wrong account', apiProviderId: b, client, ...lease })).rejects.toThrow(/new conversation/)
    expect(runtime.get(first.sessionId)?.transcript.length).toBe(count)
    await runtime.dispose()
  })
})
