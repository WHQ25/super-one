import { describe, expect, it, vi } from 'vitest'
import type { DeviceUiNode } from '@superone/shared/device-agent'
import { DeviceAgentSession } from './execute'
import {
  DeviceAgentError,
} from './types'
import type {
  DeviceImage,
  DeviceObservation,
  ObserveOptions,
  PerformContext,
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
  /** Every observation this backend has handed out, newest last. */
  readonly observations: DeviceObservation[] = []
  /** Which observation each performed action was addressed through. */
  readonly addressed: Array<DeviceObservation | undefined> = []
  /** Each observe() consumes the next screen, repeating the last one forever. */
  private index = 0

  constructor(
    private readonly screens: DeviceUiNode[],
    readonly settled = true,
    /** Same hash on every observation: the pixels did not move, only the tree did. */
    private readonly frameHash?: string,
  ) {}

  async observe(_options?: ObserveOptions): Promise<DeviceObservation> {
    const root = this.screens[Math.min(this.index++, this.screens.length - 1)]!
    const observation: DeviceObservation = {
      root,
      orientation: 'portrait',
      screen: { width: 1320, height: 2868 },
      settled: this.settled,
      ...(this.frameHash ? { frameHash: this.frameHash } : {}),
    }
    this.observations.push(observation)
    return observation
  }

  async capture(): Promise<DeviceImage> {
    return { path: '/tmp/shot.png', width: 1320, height: 2868 }
  }

  async perform(action: ResolvedAction, context?: PerformContext): Promise<void> {
    this.performed.push(action)
    this.addressed.push(context?.observation)
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
    const startRecording = vi.fn(async () => {})
    const result = await session.act({
      stateId: String(first.stateId),
      actions: [{ type: 'tap', ref: '@e1' }],
    }, undefined, startRecording)
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('STALE_STATE')
    expect(backend.performed).toHaveLength(0)
    expect(startRecording).not.toHaveBeenCalled()
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

  it('does not call a hybrid screen changed when only its recognized text re-segmented', async () => {
    // The merged tree keeps a native root with OCR lines grafted under it, so asking
    // whether the ROOT came from pixels missed this entirely: "Sign In" coming back
    // as two lines made an action that did nothing report `worked`.
    const chrome = node('@e1', { label: 'Back' })
    const oneLine = screen([chrome, {
      ref: '@e2', role: 'text', label: 'Sign In', source: 'ocr', bounds: [0.1, 0.4, 0.5, 0.05],
    }])
    const twoLines = screen([chrome, {
      ref: '@e2', role: 'text', label: 'Sign', source: 'ocr', bounds: [0.1, 0.4, 0.2, 0.05],
    }, {
      ref: '@e3', role: 'text', label: 'In', source: 'ocr', bounds: [0.32, 0.4, 0.1, 0.05],
    }])
    const session = new DeviceAgentSession(new FakeBackend([oneLine, twoLines], true, 'unmoved'))

    const snap = parse(await session.snapshot({}))
    const result = parse(await session.act({
      stateId: String(snap.stateId),
      actions: [{ type: 'tap', ref: '@e1' }],
    }))

    expect(result.outcome).toBe('unknown')
  })

  it('still sees a change in the half the app described, on that same hybrid screen', async () => {
    const ocrLine = {
      ref: '@e2', role: 'text', label: 'Sign In', source: 'ocr' as const, bounds: [0.1, 0.4, 0.5, 0.05] as const,
    }
    const session = new DeviceAgentSession(new FakeBackend([
      screen([node('@e1', { label: 'Back' }), { ...ocrLine, bounds: [0.1, 0.4, 0.5, 0.05] }]),
      screen([node('@e1', { label: 'Done' }), { ...ocrLine, bounds: [0.1, 0.4, 0.5, 0.05] }]),
    ], true, 'unmoved'))

    const snap = parse(await session.snapshot({}))
    const result = parse(await session.act({
      stateId: String(snap.stateId),
      actions: [{ type: 'tap', ref: '@e1' }],
    }))

    expect(result.outcome).toBe('worked')
  })

  it('lets an explicit expect overrule a changed screen', async () => {
    const session = new DeviceAgentSession(new FakeBackend([before, after]))
    const snap = parse(await session.snapshot({}))
    const result = parse(await session.act({
      stateId: String(snap.stateId),
      actions: [{ type: 'tap', ref: '@e1' }],
      expect: { kind: 'exists', label: 'Never appears' },
      timeoutMs: 100,
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

  it('addresses each action through the snapshot the caller quoted', async () => {
    // Not "the newest observation": the two diverge whenever an observe() succeeds
    // and the call carrying it fails before the state store hears about it.
    const backend = new FakeBackend([screen([node('@e1')])])
    const session = new DeviceAgentSession(backend)
    const snap = parse(await session.snapshot({}))
    await session.act({ stateId: String(snap.stateId), actions: [{ type: 'press', ref: '@e1' }] })

    expect(backend.addressed[0]).toBe(backend.observations[0])
  })

  it('refuses a ref-targeted action queued after a rotate, before anything runs', async () => {
    // rotate relayouts the screen and rebuilds the guest's accessibility elements,
    // so every ref and coordinate from this snapshot stops naming what it named.
    // Refusing up front keeps device_act's "the full batch is validated first"
    // promise instead of half-applying and reporting an internal staleness message.
    const backend = new FakeBackend([screen([node('@e1')])])
    const session = new DeviceAgentSession(backend)
    const snap = parse(await session.snapshot({}))
    const result = await session.act({
      stateId: String(snap.stateId),
      actions: [{ type: 'rotate', orientation: 'landscape-left' }, { type: 'press', ref: '@e1' }],
    })

    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('INVALID_ACTION')
    expect(result.content[0]!.text).toContain('rotate')
    expect(backend.performed).toHaveLength(0)
  })

  it('refuses raw coordinates after a rotate too, since the content turned under them', async () => {
    const backend = new FakeBackend([screen([node('@e1')])])
    const session = new DeviceAgentSession(backend)
    const snap = parse(await session.snapshot({}))
    const result = await session.act({
      stateId: String(snap.stateId),
      actions: [{ type: 'rotate', orientation: 'landscape-left' }, { type: 'tap', x: 0.5, y: 0.5 }],
    })

    expect(result.isError).toBe(true)
    expect(backend.performed).toHaveLength(0)
  })

  it('still allows a rotate followed by input that does not read the snapshot', async () => {
    const backend = new FakeBackend([screen([node('@e1')])])
    const session = new DeviceAgentSession(backend)
    const snap = parse(await session.snapshot({}))
    const result = await session.act({
      stateId: String(snap.stateId),
      actions: [{ type: 'rotate', orientation: 'landscape-left' }, { type: 'type', text: 'hello' }],
    })

    expect(result.isError).toBeUndefined()
    expect(backend.performed).toHaveLength(2)
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

describe('snapshot bookkeeping', () => {
  it('does not keep handing out a stateId after a later observation reached the device', async () => {
    // device_snapshot mode=fused: observe() lands, the screenshot after it throws.
    // If the store never hears about that observation it keeps naming the previous
    // one as current, so device_act accepts refs the device has already renumbered.
    const backend = new FakeBackend([
      screen([node('@e1', { label: 'One' })]),
      screen([node('@e1', { label: 'Two' })]),
    ])
    backend.capture = async () => { throw new Error('simctl io screenshot failed') }
    const session = new DeviceAgentSession(backend)
    const first = parse(await session.snapshot({}))

    const failed = await session.snapshot({ mode: 'fused' })
    expect(failed.isError).toBe(true)

    const result = await session.act({
      stateId: String(first.stateId),
      actions: [{ type: 'press', ref: '@e1' }],
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('STALE_STATE')
    expect(backend.performed).toHaveLength(0)
  })
})

describe('condition validation', () => {
  it('refuses a condition that names no element instead of reporting it already true', async () => {
    // `text` is a sibling of `label` in the schema, so this is the shape a model
    // reaches for. Matching nothing must not read as "the spinner is gone" on a
    // screen device_wait_for never inspected.
    const session = new DeviceAgentSession(new FakeBackend([screen([node('@e1', { label: 'Loading' })])]))
    const result = await session.waitFor({
      condition: { kind: 'notExists', text: 'Loading' } as never,
    })

    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('INVALID_ACTION')
  })

  it('refuses textContains with no text rather than searching for the string "undefined"', async () => {
    const session = new DeviceAgentSession(
      new FakeBackend([screen([node('@e1', { label: 'Total undefined' })])]),
    )
    const result = await session.waitFor({
      condition: { kind: 'textContains', label: 'Total undefined' } as never,
    })

    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('INVALID_ACTION')
  })

  it('refuses an unsatisfiable expect before the batch runs, not after', async () => {
    const backend = new FakeBackend([screen([node('@e1', { label: 'One' })])])
    const session = new DeviceAgentSession(backend)
    const snap = parse(await session.snapshot({}))
    const result = await session.act({
      stateId: String(snap.stateId),
      actions: [{ type: 'tap', ref: '@e1' }],
      expect: { kind: 'exists' } as never,
    })

    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('INVALID_ACTION')
    expect(backend.performed).toHaveLength(0)
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

/**
 * A device whose tree can be read once and never again.
 *
 * The shape of a real screen that starts playing video: the first read gets a tree,
 * and from then on `uiautomator dump` cannot reach an idle UI, so every later read
 * comes back as pixels only. `observed` records what each call ASKED for, which is
 * the thing that used to be wrong.
 */
class GoesUnreadable implements TouchDeviceBackend {
  readonly label = 'Fake Phone'
  readonly performed: ResolvedAction[] = []
  readonly asked: Array<ObserveOptions['tree']> = []
  private reads = 0

  constructor(private readonly hash = 'a'.repeat(64)) {}

  async observe(options: ObserveOptions = {}): Promise<DeviceObservation> {
    this.asked.push(options.tree)
    const first = this.reads++ === 0
    if (first) {
      return {
        root: screen([node('@e1', { label: 'One' })]),
        orientation: 'portrait',
        screen: { width: 1320, height: 2868 },
        settled: true,
        frameHash: this.hash,
      }
    }
    if (options.tree !== 'optional') {
      throw new DeviceAgentError('UNSUPPORTED', 'This screen has no readable accessibility tree.')
    }
    return {
      root: { ref: '@e0', role: 'other' },
      orientation: 'portrait',
      screen: { width: 1320, height: 2868 },
      settled: false,
      frameHash: this.hash,
      treeUnavailable: true,
    }
  }

  async capture(): Promise<DeviceImage> {
    return { path: '/tmp/shot.png', width: 1320, height: 2868 }
  }

  async perform(action: ResolvedAction): Promise<void> {
    this.performed.push(action)
  }
}

describe('a screen whose accessibility tree cannot be read', () => {
  // The regression: the read-back AFTER the actions threw, so a tap that had already
  // landed on the device surfaced as a tool error. An agent reading that taps again.
  it('does not turn an action that already ran into a failure', async () => {
    const backend = new GoesUnreadable()
    const session = new DeviceAgentSession(backend)
    const first = parse(await session.snapshot({}))

    const result = parse(await session.act({
      stateId: first.stateId as string,
      actions: [{ type: 'tap', x: 0.5, y: 0.5 }],
    }))

    expect(backend.performed).toHaveLength(1)
    expect(result.isError).toBeUndefined()
    expect(result.outcome).toBe('unknown')
    expect(String(result.reason)).toContain('could not be read back')
    expect(result.note).toContain('The device is fine')
  })

  // The tree channel dropping out registers as a difference to the fingerprint, so
  // without the readable check every action on a video feed reported success.
  it('does not claim the action worked just because the tree vanished', async () => {
    const session = new DeviceAgentSession(new GoesUnreadable())
    const first = parse(await session.snapshot({}))
    const result = parse(await session.act({
      stateId: first.stateId as string,
      actions: [{ type: 'tap', x: 0.5, y: 0.5 }],
    }))
    expect(result.outcome).not.toBe('worked')
  })

  // A postcondition asks about the tree. With no tree the honest answer is "could not
  // tell", not "did not hold" — the latter reads as the action having failed.
  it('leaves an expect unanswered rather than failing it', async () => {
    const session = new DeviceAgentSession(new GoesUnreadable())
    const first = parse(await session.snapshot({}))
    const result = parse(await session.act({
      stateId: first.stateId as string,
      actions: [{ type: 'tap', x: 0.5, y: 0.5 }],
      expect: { kind: 'exists', label: 'Two' },
    }))
    expect(result.expectMet).toBeUndefined()
    expect(result.outcome).not.toBe('didnt')
  })

  // A visual snapshot is pixels. It discarded the tree anyway, so requiring one denied
  // the caller the reading that still worked on exactly these screens.
  it('still takes a visual snapshot, and asks not to be given a tree', async () => {
    const backend = new GoesUnreadable()
    const session = new DeviceAgentSession(backend)
    await session.snapshot({})
    const visual = parse(await session.snapshot({ mode: 'visual' }))

    expect(backend.asked.at(-1)).toBe('optional')
    expect(visual.image).toEqual({ path: '/tmp/shot.png', width: 1320, height: 2868 })
    expect(visual.tree).toBeUndefined()
    expect(visual.note).toContain('aim at coordinates')
  })

  // fused asks for both; the half that can be produced is worth more than an error.
  it('degrades fused to the half that could be read', async () => {
    const session = new DeviceAgentSession(new GoesUnreadable())
    await session.snapshot({})
    const fused = parse(await session.snapshot({ mode: 'fused' }))
    expect(fused.image).toBeDefined()
    expect(fused.tree).toBeUndefined()
    expect(fused.source).toBe('pixels-only')
  })

  // …and a semantic snapshot, which genuinely has nothing to return, still refuses.
  it('still refuses a semantic snapshot, since the tree IS what was asked for', async () => {
    const backend = new GoesUnreadable()
    const session = new DeviceAgentSession(backend)
    await session.snapshot({})
    const semantic = await session.snapshot({})
    expect(semantic.isError).toBe(true)
    expect(backend.asked.at(-1)).toBeUndefined()
  })
})
