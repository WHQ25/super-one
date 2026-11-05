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
import { openNodeDatabase } from '../db'
import { EventLog } from './event-log'
import { sessionReadModel } from './read-model'

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
    epoch: 'test', streamingAfter: () => [], streaming: () => [], onAppend: () => () => {},
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
  it('claude mid-stream composer sends stay in the host FIFO until the active turn ends', async () => {
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
    // The host keeps the second send editable until it runs or is steered.
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

  it.each(['now', 'next'] as const)('Claude queue cards support %s steering and withdrawal', async priority => {
    const gates: Array<() => void> = []
    const inputs: Array<{ text: string; steerPriority?: string }> = []
    const runner: TurnRunner = async input => {
      inputs.push(input as typeof inputs[number])
      input.onInputAccepted?.()
      await new Promise<void>(resolve => gates.push(resolve))
      return { finalText: input.text }
    }
    const { store, events, leases } = memoryPorts()
    const runtime = new SessionRuntime(store, events, leases, 'env-claude-steer', runner)
    const session = runtime.create({ projectId: 'p', harnessId: 'claude' })
    const send = (text: string) => runtime.send({ sessionId: session.sessionId, text, clientMessageId: text,
      client, ...lease, priority: 'later' })
    try {
      await send('first')
      await send('second')
      expect(inputs.map(input => input.text)).toEqual(['first'])
      expect(runtime.get(session.sessionId)?.transcript.find(row => row.id === 'second')).toMatchObject({ queuedInComposer: true })
      await runtime.callOperation(session.sessionId, 'session.steer', { clientMessageId: 'second', priority }, () => {})
      expect(inputs.map(input => [input.text, input.steerPriority])).toEqual([['first', undefined], ['second', priority]])
      await send('withdraw')
      expect(await runtime.callOperation(session.sessionId, 'session.dequeue', { clientMessageId: 'withdraw' }, () => {})).toEqual({ removed: true })
      expect(runtime.get(session.sessionId)?.transcript.some(row => row.id === 'withdraw')).toBe(false)
      gates.splice(0).forEach(resolve => resolve())
      await waitIdle(runtime, session.sessionId)
      expect(inputs).toHaveLength(2)
    } finally { gates.splice(0).forEach(resolve => resolve()) }
  })

  it('restores a refused Claude promotion without losing or failing the editable card', async () => {
    let finish!: () => void
    const runner: TurnRunner = async input => {
      if (input.steerPriority) throw new Error('handoff refused')
      input.onInputAccepted?.()
      await new Promise<void>(resolve => { finish = resolve })
      return { finalText: 'done' }
    }
    const { store, events, leases } = memoryPorts()
    const runtime = new SessionRuntime(store, events, leases, 'env-refusal', runner)
    const session = runtime.create({ projectId: 'p', harnessId: 'claude' })
    const send = (text: string) => runtime.send({ sessionId: session.sessionId, text, clientMessageId: text, client, ...lease })
    await send('first')
    await send('second')
    await expect(runtime.callOperation(session.sessionId, 'session.steer', { clientMessageId: 'second' }, () => {})).rejects.toThrow('handoff refused')
    const queued = runtime.get(session.sessionId)?.transcript.find(row => row.id === 'second')
    expect(queued).toMatchObject({ queuedInComposer: true, queued: true })
    expect(queued?.metadata?.sendFailure).toBeUndefined()
    expect(await runtime.callOperation(session.sessionId, 'session.dequeue', { clientMessageId: 'second' }, () => {})).toEqual({ removed: true })
    finish()
    await waitIdle(runtime, session.sessionId)
  })

  it('drains a restored Claude card if the active turn ended while steering was refused', async () => {
    let finish!: () => void
    let refuse!: (error: Error) => void
    const seen: string[] = []
    const runner: TurnRunner = async input => {
      if (input.steerPriority) return new Promise((_, reject) => { refuse = reject })
      seen.push(input.text)
      input.onInputAccepted?.()
      if (input.text === 'first') await new Promise<void>(resolve => { finish = resolve })
      return { finalText: input.text }
    }
    const { store, events, leases } = memoryPorts()
    const runtime = new SessionRuntime(store, events, leases, 'env-refusal-race', runner)
    const session = runtime.create({ projectId: 'p', harnessId: 'claude' })
    const send = (text: string) => runtime.send({ sessionId: session.sessionId, text, clientMessageId: text, client, ...lease })
    await send('first'); await send('second')
    const operation = runtime.callOperation(session.sessionId, 'session.steer', { clientMessageId: 'second' }, () => {})
    finish()
    await new Promise(resolve => setTimeout(resolve, 0))
    refuse(new Error('turn ended before handoff'))
    await expect(operation).rejects.toThrow('turn ended before handoff')
    await waitIdle(runtime, session.sessionId)
    expect(seen).toEqual(['first', 'second'])
  })

  it('keeps controller notification wakes hidden and separate from queued composer messages', async () => {
    const gates: Array<() => void> = []
    const inputs: Parameters<TurnRunner>[0][] = []
    const runner: TurnRunner = async input => {
      inputs.push(input)
      input.onInputAccepted?.()
      await new Promise<void>(resolve => gates.push(resolve))
      return { finalText: 'done' }
    }
    const { store, events, leases } = memoryPorts()
    const runtime = new SessionRuntime(store, events, leases, 'env-hidden-wake', runner)
    const session = runtime.create({ projectId: 'p', harnessId: 'claude' })
    await runtime.send({ sessionId: session.sessionId, text: 'first', clientMessageId: 'first', client, ...lease })
    await runtime.send({ sessionId: session.sessionId, text: 'queued', clientMessageId: 'queued', client, ...lease })
    try {
      const wake = { sessionId: session.sessionId, text: 'notification', clientMessageId: 'wake', source: 'task-notification' as const, client, ...lease }
      await runtime.send(wake)
      await runtime.send(wake)
      expect(inputs.map(input => [input.text, input.source])).toEqual([['first', undefined], ['notification', 'task-notification']])
      expect(runtime.get(session.sessionId)?.transcript.filter(row => row.role === 'user').map(row => row.id)).toEqual(['first', 'queued'])
      expect(runtime.get(session.sessionId)?.transcript.find(row => row.id === 'queued')).toMatchObject({ queuedInComposer: true })
      await runtime.callOperation(session.sessionId, 'session.dequeue', { clientMessageId: 'queued' }, () => {})
    } finally { gates.splice(0).forEach(resolve => resolve()) }
    await waitIdle(runtime, session.sessionId)
  })

  it('non-live-inject mid-stream send serializes via FIFO queue', async () => {
    // Ordinary sends serialize for every harness; explicit steer is separate.
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
    const { store, leases } = memoryPorts()
    const db = openNodeDatabase(':memory:')
    const events = new EventLog(db, 'env-retry')
    const runtime = new SessionRuntime(store, events, leases, 'env-retry', runner, { readModel: sessionReadModel(db, events) })
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
