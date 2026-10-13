import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import type { NodeSessionRecord } from '@superone/runtime/session'
import type { OpenCodeRuntimeEvent, OpenCodeRuntimeOptions } from './runtime-types'
import type { OpenCodeV2Event } from './opencode-v2-types'
import { createManagedOpenCodeTurnRunner } from './managed-runner'

const fixture = vi.hoisted(() => ({ onEvent: null as null | ((event: OpenCodeRuntimeEvent) => void),
  admission: null as null | (() => void), hanging: false, signal: null as AbortSignal | null,
  close: vi.fn(async () => {}), runtimeClose: vi.fn(async () => {}) }))
vi.mock('./server', () => ({ isOpenCodeBinaryRunnable: () => true,
  startOpenCodeServer: async () => ({ url: 'http://native.invalid', protocol: 'v2', password: 'fixture', exited: null, close: fixture.close }) }))
const native = (type: string, data: Record<string, unknown>) => fixture.onEvent!({ type: 'v2', event: { id: type, type, data: { sessionID: 'ses_native', ...data } } as OpenCodeV2Event })
vi.mock('./native-runtime', () => ({ createOpenCodeV2Runtime: async (_server: unknown, opts: OpenCodeRuntimeOptions) => {
  fixture.onEvent = opts.onEvent
  const started = (id: string, text: string, clientMessageId: string) => {
    native('session.inbox.enqueued', { inboxID: id, item: { type: 'user', payload: { metadata: { superoneClientMessageId: clientMessageId } } } })
    native('session.execution.started', {})
    native('session.inbox.delivered', { inboxID: id })
    native('session.step.started', { assistantMessageID: id, agent: 'build', model: { providerID: 'p', id: 'm' } })
    native('session.text.ended', { assistantMessageID: id, ordinal: 0, text })
  }
  return { sessionId: 'ses_native', agent: 'build', models: [], agents: [], commands: [], snapshotEvents: [],
    prepareTurn: async (_id: string, delivery: { onInputAccepted?: () => void; signal?: AbortSignal }) => {
      fixture.admission = delivery.onInputAccepted ?? null; fixture.signal = delivery.signal ?? null
    },
    prompt: async () => { fixture.admission?.(); started('first', 'first ', 'user-first'); if (fixture.hanging) return new Promise<void>(() => {}) },
    steer: async (request: { clientMessageId: string }, accepted: () => void, guard: () => void) => {
      guard(); accepted()
      native('session.execution.succeeded', {})
      await Promise.resolve()
      started('second', 'second', request.clientMessageId)
      native('session.execution.succeeded', {})
      return 'second'
    },
    permissionReply: async () => {}, questionReply: async () => {}, questionReject: async () => {},
    cancel: async () => {}, finishTurn: () => {}, close: fixture.runtimeClose,
  }
} }))

const session: NodeSessionRecord = { sessionId: 'host', projectId: 'p', harnessId: 'opencode', providerId: 'opencode', title: null,
  status: 'streaming', transcript: [], pendingInteraction: null, providerResume: null, cwd: '/tmp', createdAt: 0, updatedAt: 0,
  isPinned: false, isHidden: false, isUserRenamed: false, controllerClientSessionId: null, hostActionCapabilityVersion: 0,
  hostActionToolGroups: [], alwaysAllowedTools: [] }
const cleanup: Array<() => Promise<void>> = []
beforeEach(() => { vi.clearAllMocks(); fixture.onEvent = fixture.admission = null; fixture.hanging = false; fixture.signal = null })
afterEach(async () => { for (const close of cleanup.splice(0)) await close() })
function start() {
  const runner = createManagedOpenCodeTurnRunner(() => '/tmp')
  cleanup.push(async () => { await runner.disposeAll!() })
  const events: AgentEvent[] = []
  const result = runner({ session, text: 'first', messageId: 'assistant', clientMessageId: 'user-first',
    onAgentEvent: event => events.push(event), onAmbientEvent: event => events.push(event), onDelta: () => {}, signal: new AbortController().signal })
  return { runner, events, result }
}
describe('managed native node lifecycle', () => {
  it('settles native success and cancels the transport when its HTTP receipt never returns', async () => {
    fixture.hanging = true
    const { events, result } = start()
    await vi.waitFor(() => expect(events.some(event => event.type === 'checkpoint_captured')).toBe(true))
    native('session.execution.succeeded', {})
    expect(await Promise.race([result, new Promise(resolve => setTimeout(() => resolve('still waiting for HTTP'), 200))]))
      .toEqual({ finalText: 'first ', providerResume: 'opencode:ses_native' })
    expect(fixture.signal?.aborted).toBe(true)
  })
  it('admits steering from native acceptance without waiting for the first HTTP receipt', async () => {
    fixture.hanging = true
    const { runner, events, result } = start()
    await vi.waitFor(() => expect(events.some(event => event.type === 'checkpoint_captured')).toBe(true))
    const consumed = vi.fn()
    const steer = runner.steer!(session, { text: 'second', clientMessageId: 'user-second' }, {
      assertControl: () => {}, onInputAccepted: () => {}, onConsumed: consumed,
    })
    expect(await Promise.race([steer.then(() => 'admitted'), new Promise(resolve => setTimeout(() => resolve('still waiting for HTTP'), 200))])).toBe('admitted')
    expect(await result).toEqual({ finalText: 'first second', providerResume: 'opencode:ses_native' })
    expect(consumed).toHaveBeenCalledOnce()
    expect(fixture.signal?.aborted).toBe(true)
  })
  it('retains one turn through completion-before-steer-receipt and scopes checkpoints after consumption', async () => {
    const { runner, events, result } = start()
    await vi.waitFor(() => expect(events.some(event => event.type === 'checkpoint_captured')).toBe(true))
    const order: string[] = []
    const consumed = vi.fn(() => order.push('consumed'))
    await runner.steer!(session, { text: 'second', clientMessageId: 'user-second' }, {
      assertControl: () => {}, onInputAccepted: () => {}, onConsumed: consumed,
    })
    expect(await result).toEqual({ finalText: 'first second', providerResume: 'opencode:ses_native' })
    expect(consumed).toHaveBeenCalledOnce()
    expect(events.filter(event => event.type === 'message_complete')).toHaveLength(1)
    expect(events).toContainEqual(expect.objectContaining({ type: 'checkpoint_captured', userMessageId: 'user-second' }))
    expect(fixture.close).not.toHaveBeenCalled()
    await runner.disposeAll!()
    expect(fixture.runtimeClose).toHaveBeenCalledOnce()
  })
  it('rejects a stale mutation proof without consuming the parked user input', async () => {
    const { runner, events, result } = start()
    await vi.waitFor(() => expect(events.some(event => event.type === 'checkpoint_captured')).toBe(true))
    const consumed = vi.fn()
    await expect(runner.steer!(session, { text: 'second', clientMessageId: 'user-second' }, {
      assertControl: () => { throw new Error('stale lease') }, onInputAccepted: () => {}, onConsumed: consumed,
    })).rejects.toThrow('stale lease')
    expect(consumed).not.toHaveBeenCalled()
    native('session.execution.succeeded', {})
    expect((await result).finalText).toBe('first ')
  })
  it('does not start a server to read an unconnected inbox', async () => {
    const runner = createManagedOpenCodeTurnRunner(() => '/tmp')
    expect(await runner.callOperation!(session, 'session.inbox.list', {}, {
      assertControl: () => {}, onEvent: () => {}, onQuestion: async () => ({}), onPermission: async () => 'deny',
    })).toEqual([])
    expect(fixture.onEvent).toBeNull()
  })
})
