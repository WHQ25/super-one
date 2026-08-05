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
  kind: 'question' | 'plan',
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
  it('respondQuestion continues the turn', async () => {
    const { store, events, leases, eventTypes } = memoryPorts()
    const runtime = new SessionRuntime(
      store,
      events,
      leases,
      'env-q',
      createSimulatedTurnRunner({ delayMs: 5, chunks: ['ok'], requestQuestion: true }),
      { permissionTimeoutMs: 10_000 },
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
      { permissionTimeoutMs: 10_000 },
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
      { permissionTimeoutMs: 30_000 },
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
      { permissionTimeoutMs: 30_000 },
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
