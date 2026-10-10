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
    onAppend: () => () => {},
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

  it('non-live-inject mid-stream send serializes via FIFO queue', async () => {
    // Codex mid-stream auto-steers (concurrent beginTurn), same family as Claude
    // live inject. FIFO applies to harnesses without live inject (e.g. opencode).
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
    const session = runtime.create({ projectId: 'p', harnessId: 'opencode' })

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

  it('codex normal mid-stream send serializes through the FIFO queue', async () => {
    let active = 0
    let maxActive = 0
    const order: string[] = []
    const runner: TurnRunner = async ({ text, onDelta, turnKind }) => {
      active++
      maxActive = Math.max(maxActive, active)
      order.push(`start:${text}:${turnKind ?? 'null'}`)
      await new Promise((r) => setTimeout(r, 40))
      onDelta(text)
      order.push(`end:${text}`)
      active--
      return { finalText: text, providerResume: null }
    }
    const { store, events, leases } = memoryPorts()
    const runtime = new SessionRuntime(store, events, leases, 'env-q-codex', runner)
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
    expect(order[0]).toBe('start:first:null')
    expect(order[1]).toBe('end:first')
    expect(order[2]).toBe('start:second:null')
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
    const runtime = new SessionRuntime(store, events, leases, 'env-p', runner)
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

  it('holds a send of a message id it already took, queued or answered', async () => {
    const texts: string[] = []
    const runner: TurnRunner = async ({ text }) => {
      texts.push(text)
      await new Promise((r) => setTimeout(r, 20))
      return { finalText: text, providerResume: null }
    }
    const { store, events, leases } = memoryPorts()
    const runtime = new SessionRuntime(store, events, leases, 'env-q-dup', runner)
    const session = runtime.create({ projectId: 'p', harnessId: 'opencode' })
    const send = (text: string, clientMessageId: string) =>
      runtime.send({ sessionId: session.sessionId, text, clientMessageId, client, ...lease })

    await send('first', 'u1')
    await send('second', 'u2')
    // A Resend of each under a new attempt key: one running, one queued.
    await send('first', 'u1')
    await send('second', 'u2')
    await waitIdle(runtime, session.sessionId)
    await send('first', 'u1')

    const done = await waitIdle(runtime, session.sessionId)
    expect(texts).toEqual(['first', 'second'])
    expect(done.transcript.filter((t) => t.role === 'user').map((t) => t.id)).toEqual(['u1', 'u2'])
  })
})

describe('SessionRuntime send of a message that never ran', () => {
  const userIds = (s: NodeSessionRecord) => s.transcript.filter((t) => t.role === 'user').map((t) => t.id)
  const failureOf = (s: NodeSessionRecord, id: string) => s.transcript.find((t) => t.id === id)?.metadata?.sendFailure

  it('runs a message whose runner failed to start again under its id, then holds it once answered', async () => {
    const texts: string[] = []
    let spawnable = false
    const runner: TurnRunner = async ({ text }) => {
      texts.push(text)
      if (!spawnable) throw new Error('spawn claude ENOENT')
      return { finalText: `re: ${text}`, providerResume: null }
    }
    const { store, events, leases } = memoryPorts()
    const runtime = new SessionRuntime(store, events, leases, 'env-retry', runner)
    const session = runtime.create({ projectId: 'p', harnessId: 'claude' })
    const send = () => runtime.send({ sessionId: session.sessionId, text: 'task', clientMessageId: 'u1', client, ...lease })

    await send()
    const failed = await waitIdle(runtime, session.sessionId)
    expect(failed.status).toBe('idle')
    expect(failureOf(failed, 'u1')).toEqual({ error: 'spawn claude ENOENT' })
    expect(store.loadAll()[0] && failureOf(store.loadAll()[0]!, 'u1')).toEqual({ error: 'spawn claude ENOENT' })
    expect(runtime.listMessages({ sessionId: session.sessionId }).messages[0]?.metadata).toEqual({ sendFailure: { error: 'spawn claude ENOENT' } })

    spawnable = true
    await send()
    const answered = await waitIdle(runtime, session.sessionId)
    expect(texts).toEqual(['task', 'task'])
    expect(userIds(answered)).toEqual(['u1'])
    expect(failureOf(answered, 'u1')).toBeUndefined()
    expect(answered.transcript.at(-1)).toMatchObject({ role: 'assistant', text: 're: task' })

    await send()
    await waitIdle(runtime, session.sessionId)
    expect(texts).toHaveLength(2)
  })

  it('decides on the runner accepting the input, not on lifecycle events it emits itself', async () => {
    let accepts = false
    const runner: TurnRunner = async ({ onAgentEvent, onEvent, onInputAccepted }) => {
      onAgentEvent?.({ type: 'message_start', message: { id: 'a1', role: 'assistant', status: 'streaming', content: [], createdAt: '', providerId: 'opencode' } })
      onAgentEvent?.({ type: 'status_change', status: 'streaming' })
      onAgentEvent?.({ type: 'provider_session_id', providerSessionId: 'p1' })
      onEvent?.({ kind: 'status', status: 'streaming' })
      if (accepts) onInputAccepted?.()
      throw new Error('disconnected')
    }
    const { store, events, leases } = memoryPorts()
    const runtime = new SessionRuntime(store, events, leases, 'env-accept', runner)
    const session = runtime.create({ projectId: 'p', harnessId: 'opencode' })
    const send = (id: string) => runtime.send({ sessionId: session.sessionId, text: 'task', clientMessageId: id, client, ...lease })

    await send('u1')
    expect(failureOf(await waitIdle(runtime, session.sessionId), 'u1')).toEqual({ error: 'disconnected' })

    accepts = true
    await send('u2')
    const held = await waitIdle(runtime, session.sessionId)
    expect(held.status).toBe('error')
    expect(failureOf(held, 'u2')).toBeUndefined()
  })

  it('holds a message whose reply started and then failed, and fails the one queued behind it', async () => {
    const texts: string[] = []
    const runner: TurnRunner = async ({ text, onDelta }) => {
      texts.push(text)
      onDelta('working')
      await new Promise((r) => setTimeout(r, 20))
      throw new Error('provider overloaded')
    }
    const { store, events, leases } = memoryPorts()
    const runtime = new SessionRuntime(store, events, leases, 'env-retry-err', runner)
    const session = runtime.create({ projectId: 'p', harnessId: 'opencode' })
    const send = (text: string, id: string) => runtime.send({ sessionId: session.sessionId, text, clientMessageId: id, client, ...lease })

    await send('first', 'u1')
    await send('second', 'u2')
    const done = await waitIdle(runtime, session.sessionId)
    expect(done.status).toBe('error')
    expect(failureOf(done, 'u1')).toBeUndefined()
    expect(failureOf(done, 'u2')?.error).toMatch(/did not run/)

    // The session error belongs to u1's reply: its resend is held.
    await send('first', 'u1')
    expect(texts).toEqual(['first'])
  })

  it('turns a queued message into a failed row across a node restart, and runs its resend', async () => {
    const texts: string[] = []
    const runner: TurnRunner = async ({ text, onDelta }) => {
      texts.push(text)
      onDelta('working')
      return new Promise(() => {})
    }
    const { store, events, leases } = memoryPorts()
    const before = new SessionRuntime(store, events, leases, 'env-restart', runner)
    const session = before.create({ projectId: 'p', harnessId: 'opencode' })
    await before.send({ sessionId: session.sessionId, text: 'first', clientMessageId: 'u1', client, ...lease })
    await before.send({ sessionId: session.sessionId, text: 'second', clientMessageId: 'u2', client, ...lease })
    // Running: a resend is held.
    await before.send({ sessionId: session.sessionId, text: 'first', clientMessageId: 'u1', client, ...lease })
    expect(texts).toEqual(['first'])

    const afterTexts: string[] = []
    const after = new SessionRuntime(store, events, leases, 'env-restart', async ({ text }) => {
      afterTexts.push(text)
      return { finalText: text, providerResume: null }
    })
    const restored = after.get(session.sessionId)!
    expect(restored.status).toBe('interrupted')
    expect(failureOf(restored, 'u1')).toBeUndefined()
    expect(failureOf(restored, 'u2')?.error).toMatch(/restarted/)

    await after.send({ sessionId: session.sessionId, text: 'first', clientMessageId: 'u1', client, ...lease })
    await after.send({ sessionId: session.sessionId, text: 'second', clientMessageId: 'u2', client, ...lease })
    const done = await waitIdle(after, session.sessionId)
    expect(afterTexts).toEqual(['second'])
    expect(userIds(done)).toEqual(['u1', 'u2'])
    expect(failureOf(done, 'u2')).toBeUndefined()
  })
})
