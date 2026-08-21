import { describe, expect, it, vi } from 'vitest'
import { IosSimulatorBackend } from './ios-backend'
import type { IosSimulatorManager } from '../ios-simulator/ios-simulator-manager'
import type { DeviceObservation } from './types'

/** A dump shaped like the helper's, with one named control in it. */
function namedTree() {
  return {
    generation: 7,
    nodes: 2,
    complete: true,
    tree: {
      uid: 1,
      role: 'window',
      frame: [0, 0, 100, 200] as [number, number, number, number],
      children: [
        { uid: 2, role: 'button', label: 'Sign in', frame: [10, 20, 30, 40] as [number, number, number, number] },
      ],
    },
  }
}

/** What a WebView or a game canvas hands back: valid shape, nothing named. */
function anonymousTree() {
  return {
    generation: 7,
    nodes: 1,
    complete: true,
    tree: { uid: 1, role: 'window', frame: [0, 0, 100, 200] as [number, number, number, number] },
  }
}

/** A gesture never consults the tree, so a bare observation is enough to drive one. */
function gestureObservation(): DeviceObservation {
  return {
    root: { ref: '@e0', role: 'window' },
    orientation: 'portrait',
    screen: { width: 1320, height: 2868 },
    settled: true,
  }
}

function managerWith(overrides: Record<string, unknown>): IosSimulatorManager {
  return {
    getSessionState: vi.fn(async () => ({
      device: { name: 'iPhone 17 Pro Max' },
      phase: 'ready',
      orientation: 'portrait',
      pixelWidth: 1320,
      pixelHeight: 2868,
    })),
    accessibilityDump: vi.fn(async () => namedTree()),
    frameHash: vi.fn(async () => ({ hash: '7141414d45554555', pixelWidth: 1320, pixelHeight: 2868 })),
    frameOcr: vi.fn(async () => ({ lines: [], rotationDegrees: 0, pixelWidth: 1320, pixelHeight: 2868 })),
    accessibilityPerform: vi.fn(async () => {}),
    ...overrides,
  } as unknown as IosSimulatorManager
}

describe('IosSimulatorBackend observation sources', () => {
  it('keeps the app\'s own tree and never pays for OCR when the app names its controls', async () => {
    const frameOcr = vi.fn()
    const backend = new IosSimulatorBackend(managerWith({ frameOcr }), 'session-1')

    const observation = await backend.observe({ immediate: true })

    expect(observation.root.children?.[0]?.label).toBe('Sign in')
    expect(observation.root.source).toBeUndefined()
    expect(frameOcr).not.toHaveBeenCalled()
  })

  it('recovers a tree from the pixels when the app names nothing', async () => {
    const frameOcr = vi.fn(async () => ({
      lines: [{ text: 'Sign in', confidence: 0.9, x: 0.1, y: 0.05, width: 0.3, height: 0.02 }],
      rotationDegrees: 0,
      pixelWidth: 1320,
      pixelHeight: 2868,
    }))
    const backend = new IosSimulatorBackend(
      managerWith({ accessibilityDump: vi.fn(async () => anonymousTree()), frameOcr }),
      'session-1',
    )

    const observation = await backend.observe({ immediate: true })

    expect(observation.root.children?.[0]?.label).toBe('Sign in')
    expect(observation.root.source).toBe('ocr')
  })

  it('recovers a tree from the pixels when the accessibility channel refuses entirely', async () => {
    const backend = new IosSimulatorBackend(
      managerWith({
        accessibilityDump: vi.fn(async () => { throw new Error('Guest accessibility is unavailable.') }),
        frameOcr: vi.fn(async () => ({
          lines: [{ text: 'Continue', confidence: 0.9, x: 0.1, y: 0.5, width: 0.3, height: 0.02 }],
          rotationDegrees: 0,
          pixelWidth: 1320,
          pixelHeight: 2868,
        })),
      }),
      'session-1',
    )

    const observation = await backend.observe({ immediate: true })

    expect(observation.root.children?.[0]?.label).toBe('Continue')
  })

  it('carries the pixel fingerprint so the act layer can see changes the tree misses', async () => {
    const backend = new IosSimulatorBackend(managerWith({}), 'session-1')

    const observation = await backend.observe({ immediate: true })

    expect(observation.frameHash).toBe('7141414d45554555')
  })

  it('still observes through the tree when the framebuffer cannot be read', async () => {
    const backend = new IosSimulatorBackend(
      managerWith({ frameHash: vi.fn(async () => { throw new Error('Framebuffer is not ready.') }) }),
      'session-1',
    )

    const observation = await backend.observe({ immediate: true })

    expect(observation.root.children?.[0]?.label).toBe('Sign in')
    expect(observation.frameHash).toBeUndefined()
  })

  it('reports both channels failing as no device, rather than as a blank screen', async () => {
    const backend = new IosSimulatorBackend(
      managerWith({
        accessibilityDump: vi.fn(async () => { throw new Error('unavailable') }),
        frameHash: vi.fn(async () => { throw new Error('unavailable') }),
      }),
      'session-1',
    )

    await expect(backend.observe({ immediate: true })).rejects.toMatchObject({ code: 'NO_DEVICE' })
  })

  it('tells the agent to tap instead of press on a screen read from pixels', async () => {
    const backend = new IosSimulatorBackend(
      managerWith({
        accessibilityDump: vi.fn(async () => anonymousTree()),
        frameOcr: vi.fn(async () => ({
          lines: [{ text: 'Sign in', confidence: 0.9, x: 0.1, y: 0.05, width: 0.3, height: 0.02 }],
          rotationDegrees: 0,
          pixelWidth: 1320,
          pixelHeight: 2868,
        })),
      }),
      'session-1',
    )
    const observation = await backend.observe({ immediate: true })

    // UNSUPPORTED, not UNKNOWN_REF: an unknown ref reads as a stale snapshot and
    // sends the agent re-snapshotting forever instead of switching to a tap.
    await expect(backend.perform({ kind: 'press', ref: '@e1' }, { observation })).rejects.toMatchObject({
      code: 'UNSUPPORTED',
    })
  })
})

describe('IosSimulatorBackend ref addressing', () => {
  /** Same shape, same refs, different uids and a later generation. */
  function treeAtGeneration(generation: number, rootUid: number, childUid: number) {
    return {
      generation,
      nodes: 2,
      complete: true,
      tree: {
        uid: rootUid,
        role: 'window',
        frame: [0, 0, 100, 200] as [number, number, number, number],
        children: [
          {
            uid: childUid,
            role: 'button',
            label: 'Sign in',
            frame: [10, 20, 30, 40] as [number, number, number, number],
          },
        ],
      },
    }
  }

  it('presses through the snapshot it was handed, not through whatever was observed last', async () => {
    // The divergence this guards: device_snapshot's observe() succeeds and the
    // helper renumbers its elements, then the screenshot after it throws, so the
    // state store never learns about that observation and keeps handing out the
    // previous stateId. Addressing must follow the snapshot, not the backend.
    const dumps = [treeAtGeneration(7, 1, 2), treeAtGeneration(8, 11, 22)]
    let call = 0
    const accessibilityPerform = vi.fn(async () => {})
    const backend = new IosSimulatorBackend(
      managerWith({
        accessibilityDump: vi.fn(async () => dumps[Math.min(call++, dumps.length - 1)]),
        accessibilityPerform,
      }),
      'session-1',
    )

    const quoted = await backend.observe({ immediate: true })
    await backend.observe({ immediate: true })

    await backend.perform({ kind: 'press', ref: '@e1' }, { observation: quoted })

    expect(accessibilityPerform).toHaveBeenCalledWith('session-1', 'press', 7, 2)
  })

  it('refuses an observation it never produced rather than guessing a uid', async () => {
    const backend = new IosSimulatorBackend(managerWith({}), 'session-1')
    await backend.observe({ immediate: true })

    await expect(backend.perform({ kind: 'press', ref: '@e1' }, {
      observation: {
        root: { ref: '@e0', role: 'window' },
        orientation: 'portrait',
        screen: { width: 1320, height: 2868 },
        settled: true,
      },
    })).rejects.toMatchObject({ code: 'STALE_STATE' })
  })
})

describe('IosSimulatorBackend', () => {
  it('cancels an in-flight gesture when the request is aborted', async () => {
    const controller = new AbortController()
    const inputs: Array<{ type: string; contacts?: Array<{ phase: string }> }> = []
    const manager = {
      input: vi.fn(async (_sessionId: string, input: { type: string; contacts?: Array<{ phase: string }> }) => {
        inputs.push(input)
        if (input.type === 'touch.update' && input.contacts?.[0]?.phase === 'began') {
          queueMicrotask(() => controller.abort())
        }
        return { ok: true }
      }),
    } as unknown as IosSimulatorManager
    const backend = new IosSimulatorBackend(manager, 'session-1')

    await expect(backend.perform({
      kind: 'longPress',
      x: 0.5,
      y: 0.5,
      durationMs: 1000,
    }, { observation: gestureObservation(), signal: controller.signal }))
      .rejects.toMatchObject({ code: 'ABORTED' })

    expect(inputs.map((input) => input.type)).toEqual(['touch.update', 'touch.cancel'])
  })
})
