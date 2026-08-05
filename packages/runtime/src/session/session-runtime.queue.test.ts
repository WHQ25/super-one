/**
 * Node-side turn queue (desktop Claude priority=next parity).
 */
import { describe, expect, it } from 'vitest'
import {
  SessionRuntime,
  type LeaseGuard,
  type NodeSessionRecord,
  type SessionEventLog,
  type SessionStore,
  type TurnRunner,
} from './session-runtime'

function memoryPorts() {
  const rows = new Map<string, NodeSessionRecord>()
  const store: SessionStore = {
    loadAll: () =>
      [...rows.values()].map((s) => ({
        ...s,
        transcript: s.transcript.map((t) => ({ ...t })),
        alwaysAllowedTools: [...(s.alwaysAllowedTools ?? [])],
        hostActionToolGroups: [...(s.hostActionToolGroups ?? [])],
      })),
    save: (s) => {
      rows.set(s.sessionId, {
        ...s,
        transcript: s.transcript.map((t) => ({ ...t })),
        alwaysAllowedTools: [...(s.alwaysAllowedTools ?? [])],
        hostActionToolGroups: [...(s.hostActionToolGroups ?? [])],
      })
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
  const leases: LeaseGuard = { assertValid: () => {} }
  return { store, events, leases }
}

async function waitIdle(runtime: SessionRuntime, sessionId: string, attempts = 200) {
  for (let i = 0; i < attempts; i++) {
    const s = runtime.get(sessionId)
    if (s && s.status !== 'streaming') return s
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error('never idle')
}

const client = { clientSessionId: 'c1' }
const lease = { leaseId: 'l1', generation: 'g1' }

describe('SessionRuntime send queue', () => {
  it('claude mid-stream send starts concurrent turnRunner (live inject path)', async () => {
    let active = 0
    let maxActive = 0
    const order: string[] = []
    const runner: TurnRunner = async ({ text, onDelta }) => {
      active++
      maxActive = Math.max(maxActive, active)
      order.push(`start:${text}`)
      await new Promise((r) => setTimeout(r, 40))
      onDelta(text)
      order.push(`end:${text}`)
      active--
      return { finalText: text, providerResume: null }
    }
    const { store, events, leases } = memoryPorts()
    const runtime = new SessionRuntime(store, events, leases, 'env-q', runner)
    const session = runtime.create({ projectId: 'p', harnessId: 'claude' })

    await runtime.send({
      sessionId: session.sessionId,
      text: 'first',
      client,
      leaseId: lease.leaseId,
      generation: lease.generation,
    })
    // Second send while first is still running — concurrent beginTurn (SDK
    // live session serializes with priority=next inside the harness).
    await runtime.send({
      sessionId: session.sessionId,
      text: 'second',
      client,
      leaseId: lease.leaseId,
      generation: lease.generation,
    })

    const done = await waitIdle(runtime, session.sessionId)
    expect(done.status).toBe('idle')
    expect(maxActive).toBe(2)
    expect(order).toEqual(['start:first', 'start:second', 'end:first', 'end:second'])
    const users = done.transcript.filter((t) => t.role === 'user').map((t) => t.text)
    expect(users).toEqual(['first', 'second'])
  })

  it('non-claude mid-stream send serializes via FIFO queue', async () => {
    let active = 0
    let maxActive = 0
    const order: string[] = []
    const runner: TurnRunner = async ({ text, onDelta }) => {
      active++
      maxActive = Math.max(maxActive, active)
      order.push(`start:${text}`)
      await new Promise((r) => setTimeout(r, 40))
      onDelta(text)
      order.push(`end:${text}`)
      active--
      return { finalText: text, providerResume: null }
    }
    const { store, events, leases } = memoryPorts()
    const runtime = new SessionRuntime(store, events, leases, 'env-q-fifo', runner)
    const session = runtime.create({ projectId: 'p', harnessId: 'codex' })

    await runtime.send({
      sessionId: session.sessionId,
      text: 'first',
      client,
      leaseId: lease.leaseId,
      generation: lease.generation,
    })
    await runtime.send({
      sessionId: session.sessionId,
      text: 'second',
      client,
      leaseId: lease.leaseId,
      generation: lease.generation,
    })

    const done = await waitIdle(runtime, session.sessionId)
    expect(done.status).toBe('idle')
    expect(maxActive).toBe(1)
    expect(order).toEqual(['start:first', 'end:first', 'start:second', 'end:second'])
    const users = done.transcript.filter((t) => t.role === 'user').map((t) => t.text)
    expect(users).toEqual(['first', 'second'])
  })

  it('auto-allows tools when permissionMode is bypassPermissions', async () => {
    let waiterHit = false
    const runner: TurnRunner = async ({ onPermission, onDelta, permissionMode }) => {
      expect(permissionMode).toBe('bypassPermissions')
      if (onPermission) {
        // SessionRuntime wraps onPermission — if mode is bypass, it never parks.
        const d = await onPermission({
          interactionId: 'p1',
          kind: 'permission',
          toolName: 'Bash',
          createdAt: Date.now(),
        })
        expect(d).toBe('allow')
        waiterHit = true
      }
      onDelta('ok')
      return { finalText: 'ok', providerResume: null }
    }
    const { store, events, leases } = memoryPorts()
    const runtime = new SessionRuntime(store, events, leases, 'env-p', runner, {
      permissionTimeoutMs: 5_000,
    })
    const session = runtime.create({ projectId: 'p', harnessId: 'claude' })
    await runtime.send({
      sessionId: session.sessionId,
      text: 'go',
      client,
      leaseId: lease.leaseId,
      generation: lease.generation,
      permissionMode: 'bypassPermissions',
    })
    const done = await waitIdle(runtime, session.sessionId)
    expect(done.status).toBe('idle')
    expect(waiterHit).toBe(true)
    expect(done.pendingInteraction).toBeNull()
  })
})
