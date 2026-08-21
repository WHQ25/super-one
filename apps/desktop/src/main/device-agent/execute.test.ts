import { describe, expect, it } from 'vitest'
import type { DeviceUiNode } from '@superone/shared/device-agent'
import { DeviceAgentSession } from './execute'
import type {
  DeviceImage,
  DeviceObservation,
  ObserveOptions,
  ResolvedAction,
  TouchDeviceBackend,
} from './types'

function node(ref: string, extra: Partial<DeviceUiNode> = {}): DeviceUiNode {
  return { ref, role: 'AXButton', bounds: [0.1, 0.2, 0.2, 0.1], ...extra }
}

function screen(children: DeviceUiNode[]): DeviceUiNode {
  return { ref: '@e0', role: 'AXApplication', bounds: [0, 0, 1, 1], children }
}

class FakeBackend implements TouchDeviceBackend {
  readonly label = 'Fake Phone'
  readonly performed: ResolvedAction[] = []
  /** Each observe() consumes the next screen, repeating the last one forever. */
  private index = 0

  constructor(private readonly screens: DeviceUiNode[], readonly settled = true) {}

  async observe(_options?: ObserveOptions): Promise<DeviceObservation> {
    const root = this.screens[Math.min(this.index++, this.screens.length - 1)]!
    return { root, orientation: 'portrait', screen: { width: 1320, height: 2868 }, settled: this.settled }
  }

  async capture(): Promise<DeviceImage> {
    return { path: '/tmp/shot.png', width: 1320, height: 2868 }
  }

  async perform(action: ResolvedAction): Promise<void> {
    this.performed.push(action)
  }
}

function parse(reply: { content: Array<{ text: string }> }): Record<string, unknown> {
  return JSON.parse(reply.content[0]!.text)
}

describe('device_act staleness', () => {
  it('refuses a superseded snapshot before performing anything', async () => {
    const backend = new FakeBackend([screen([node('@e1', { label: 'One' })])])
    const session = new DeviceAgentSession(backend)
    const first = parse(await session.snapshot({}))
    await session.snapshot({})

    // The whole point of stateId: after the screen moved on, @e1 may name a
    // different control, so acting on the old snapshot must fail loudly rather than
    // tap whatever now occupies that slot.
    const result = await session.act({
      stateId: String(first.stateId),
      actions: [{ type: 'tap', ref: '@e1' }],
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('STALE_STATE')
    expect(backend.performed).toHaveLength(0)
  })

  it('accepts the newest snapshot', async () => {
    const backend = new FakeBackend([screen([node('@e1', { label: 'One' })])])
    const session = new DeviceAgentSession(backend)
    const snap = parse(await session.snapshot({}))
    const result = await session.act({
      stateId: String(snap.stateId),
      actions: [{ type: 'tap', ref: '@e1' }],
    })
    expect(result.isError).toBeUndefined()
    expect(backend.performed[0]).toEqual({ kind: 'tap', x: 0.2, y: 0.25 })
  })
})

describe('device_act outcome', () => {
  const before = screen([node('@e1', { label: 'Before' })])
  const after = screen([node('@e1', { label: 'After' })])

  it('reports worked when the screen changed', async () => {
    const session = new DeviceAgentSession(new FakeBackend([before, after]))
    const snap = parse(await session.snapshot({}))
    const result = parse(await session.act({
      stateId: String(snap.stateId),
      actions: [{ type: 'tap', ref: '@e1' }],
    }))
    expect(result.outcome).toBe('worked')
  })

  it('reports unknown — not didnt — when nothing visibly changed', async () => {
    // Collapsing this into a failure sends the agent into a retry loop against a
    // device that already did what was asked.
    const session = new DeviceAgentSession(new FakeBackend([before]))
    const snap = parse(await session.snapshot({}))
    const result = parse(await session.act({
      stateId: String(snap.stateId),
      actions: [{ type: 'tap', ref: '@e1' }],
    }))
    expect(result.outcome).toBe('unknown')
  })

  it('lets an explicit expect overrule a changed screen', async () => {
    const session = new DeviceAgentSession(new FakeBackend([before, after]))
    const snap = parse(await session.snapshot({}))
    const result = parse(await session.act({
      stateId: String(snap.stateId),
      actions: [{ type: 'tap', ref: '@e1' }],
      expect: { kind: 'exists', label: 'Never appears' },
    }))
    expect(result.outcome).toBe('didnt')
    expect(result.expectMet).toBe(false)
  })

  it('reports didnt when the backend refused, without claiming the screen changed', async () => {
    const backend = new FakeBackend([before, after])
    backend.perform = async () => { throw new Error('device is asleep') }
    const session = new DeviceAgentSession(backend)
    const snap = parse(await session.snapshot({}))
    const result = parse(await session.act({
      stateId: String(snap.stateId),
      actions: [{ type: 'tap', ref: '@e1' }],
    }))
    expect(result.outcome).toBe('didnt')
    expect(result.failure).toContain('asleep')
  })
})

describe('action resolution', () => {
  it('turns a direction into a destination', async () => {
    const backend = new FakeBackend([screen([])])
    const session = new DeviceAgentSession(backend)
    const snap = parse(await session.snapshot({}))
    await session.act({
      stateId: String(snap.stateId),
      actions: [{ type: 'swipe', direction: 'up', distance: 0.4 }],
    })
    const swipe = backend.performed[0] as { kind: string; fromY: number; toY: number }
    expect(swipe.kind).toBe('swipe')
    expect(swipe.fromY).toBe(0.5)
    expect(swipe.toY).toBeCloseTo(0.1, 6)
  })

  it('refuses press without a ref, because it addresses a control not a place', async () => {
    const backend = new FakeBackend([screen([node('@e1')])])
    const session = new DeviceAgentSession(backend)
    const snap = parse(await session.snapshot({}))
    const result = await session.act({
      stateId: String(snap.stateId),
      actions: [{ type: 'press', x: 0.5, y: 0.5 }],
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('INVALID_ACTION')
    expect(backend.performed).toHaveLength(0)
  })

  it('rejects an unknown ref before running any of the batch', async () => {
    const backend = new FakeBackend([screen([node('@e1')])])
    const session = new DeviceAgentSession(backend)
    const snap = parse(await session.snapshot({}))
    const result = await session.act({
      stateId: String(snap.stateId),
      actions: [{ type: 'tap', ref: '@e1' }, { type: 'tap', ref: '@e999' }],
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('UNKNOWN_REF')
    expect(backend.performed).toHaveLength(0)
  })

  it('stops between actions when the request is aborted', async () => {
    const backend = new FakeBackend([screen([node('@e1'), node('@e2')])])
    const controller = new AbortController()
    const perform = backend.perform.bind(backend)
    backend.perform = async (action) => {
      await perform(action)
      controller.abort()
    }
    const session = new DeviceAgentSession(backend)
    const snap = parse(await session.snapshot({}))
    const result = await session.act({
      stateId: String(snap.stateId),
      actions: [{ type: 'tap', ref: '@e1' }, { type: 'tap', ref: '@e2' }],
    }, controller.signal)

    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('ABORTED')
    expect(backend.performed).toHaveLength(1)
  })
})

describe('device_wait_for', () => {
  it('distinguishes a condition that was already true', async () => {
    const session = new DeviceAgentSession(new FakeBackend([screen([node('@e1', { label: 'Done' })])]))
    const result = parse(await session.waitFor({ condition: { kind: 'exists', label: 'Done' } }))
    expect(result.status).toBe('preexisting')
  })

  it('reports verified when it had to wait for the change', async () => {
    const session = new DeviceAgentSession(new FakeBackend([
      screen([node('@e1', { label: 'Loading' })]),
      screen([node('@e1', { label: 'Done' })]),
    ]))
    const result = parse(await session.waitFor({ condition: { kind: 'exists', label: 'Done' } }))
    expect(result.status).toBe('verified')
    expect(result.tree).toContain('Done')
    expect(result.settled).toBe(true)
  })

  it('times out with a hint instead of hanging or throwing', async () => {
    const session = new DeviceAgentSession(new FakeBackend([screen([node('@e1', { label: 'Spinner' })])]))
    const result = parse(await session.waitFor({
      condition: { kind: 'exists', label: 'Never' },
      timeoutMs: 300,
    }))
    expect(result.status).toBe('timeout')
    expect(result.hint).toBeTruthy()
    expect(result.tree).toContain('Spinner')
  })

  it('stops waiting when the request is aborted', async () => {
    const controller = new AbortController()
    const session = new DeviceAgentSession(new FakeBackend([screen([node('@e1', { label: 'Spinner' })])]))
    const waiting = session.waitFor({
      condition: { kind: 'exists', label: 'Never' },
      timeoutMs: 60_000,
    }, controller.signal)
    controller.abort()

    const result = await waiting
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('ABORTED')
  })
})

describe('device_query', () => {
  it('searches a cached snapshot without touching the device', async () => {
    const backend = new FakeBackend([screen([
      node('@e1', { label: 'Settings', identifier: 'Settings' }),
      node('@e2', { label: 'Safari' }),
    ])])
    const session = new DeviceAgentSession(backend)
    const snap = parse(await session.snapshot({}))
    const result = parse(await session.query({ stateId: String(snap.stateId), op: 'search', text: 'saf' }))
    expect(result.matches).toBe(1)
    expect(String((result.results as string[])[0])).toContain('Safari')
  })

  it('still reads a superseded snapshot, since queries have no effect', async () => {
    const session = new DeviceAgentSession(new FakeBackend([screen([node('@e1', { label: 'Old' })])]))
    const first = parse(await session.snapshot({}))
    await session.snapshot({})
    const result = parse(await session.query({ stateId: String(first.stateId), op: 'search', text: 'old' }))
    expect(result.matches).toBe(1)
  })
})

describe('device_snapshot', () => {
  it('omits the tree in visual mode so pixels are not paid for twice', async () => {
    const session = new DeviceAgentSession(new FakeBackend([screen([node('@e1')])]))
    const result = parse(await session.snapshot({ mode: 'visual' }))
    expect(result.image).toBeTruthy()
    expect(result.tree).toBeUndefined()
  })

  it('surfaces settled=false so the agent knows the geometry may be stale', async () => {
    const session = new DeviceAgentSession(new FakeBackend([screen([node('@e1')])], false))
    expect(parse(await session.snapshot({})).settled).toBe(false)
  })
})
