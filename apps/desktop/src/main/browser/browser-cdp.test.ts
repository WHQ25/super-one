import { describe, it, expect, vi, beforeEach } from 'vitest'

interface SentCommand {
  method: string
  params?: object
}

const sent: SentCommand[] = []
const failNext = new Set<string>()
let attachedFlag = false

const fakeDebugger = {
  isAttached: () => attachedFlag,
  attach: vi.fn(() => {
    attachedFlag = true
  }),
  detach: vi.fn(() => {
    attachedFlag = false
  }),
  on: vi.fn(),
  once: vi.fn(),
  off: vi.fn(),
  sendCommand: vi.fn((method: string, params?: object) => {
    sent.push({ method, params })
    if (failNext.has(method)) {
      failNext.delete(method)
      return Promise.reject(new Error(`CDP refused ${method}`))
    }
    if (method === 'Runtime.evaluate') return Promise.resolve({ result: { value: null } })
    return Promise.resolve({})
  }),
}

const fakeWc = {
  id: 42,
  isDestroyed: () => false,
  debugger: fakeDebugger,
  once: vi.fn(),
  focus: vi.fn(),
}

vi.mock('electron', () => ({
  webContents: { fromId: (id: number) => (id === 42 ? fakeWc : null) },
}))

vi.mock('../app-settings-service', () => ({ readAppSettings: () => ({ cdpEnabled: true }) }))

vi.mock('./browser-automation-bridge', () => ({ browserAutomationCall: vi.fn() }))

vi.mock('../logger', () => ({ default: { info: vi.fn(), warn: vi.fn() } }))

const { cdpPress, cdpType, acquireDomain, releaseDomain, detachAllCdp } = await import('./browser-cdp')

beforeEach(() => {
  detachAllCdp()
  sent.length = 0
  failNext.clear()
  attachedFlag = false
  fakeDebugger.attach.mockClear()
  fakeDebugger.detach.mockClear()
  fakeDebugger.sendCommand.mockClear()
  fakeWc.focus.mockClear()
})

// A CDP domain is process-wide per target, but several features enable the same
// one concurrently (network recording + perf measurement both need `Network`).
// Without a shared refcount, whichever feature stops first disables the domain
// under the other — and the survivor fails silently, still believing it is
// subscribed.
describe('cdp domain refcounting', () => {
  it('enables a domain only on the first acquire', async () => {
    await acquireDomain(42, 'Network', { maxTotalBufferSize: 1024 })
    await acquireDomain(42, 'Network')
    expect(sent.filter((c) => c.method === 'Network.enable')).toHaveLength(1)
  })

  it('passes the enable arguments from the first acquire', async () => {
    await acquireDomain(42, 'Network', { maxTotalBufferSize: 1024 })
    expect(sent.find((c) => c.method === 'Network.enable')?.params).toMatchObject({ maxTotalBufferSize: 1024 })
  })

  it('keeps the domain enabled while another holder remains', async () => {
    await acquireDomain(42, 'Network')
    await acquireDomain(42, 'Network')
    await releaseDomain(42, 'Network')
    expect(sent.some((c) => c.method === 'Network.disable')).toBe(false)
  })

  it('disables the domain when the last holder releases', async () => {
    await acquireDomain(42, 'Network')
    await acquireDomain(42, 'Network')
    await releaseDomain(42, 'Network')
    await releaseDomain(42, 'Network')
    expect(sent.filter((c) => c.method === 'Network.disable')).toHaveLength(1)
  })

  it('re-enables after the count drops to zero and a new holder acquires', async () => {
    await acquireDomain(42, 'Network')
    await releaseDomain(42, 'Network')
    await acquireDomain(42, 'Network')
    expect(sent.filter((c) => c.method === 'Network.enable')).toHaveLength(2)
  })

  it('tracks domains independently', async () => {
    await acquireDomain(42, 'Network')
    await acquireDomain(42, 'Profiler')
    await releaseDomain(42, 'Network')
    expect(sent.filter((c) => c.method === 'Network.disable')).toHaveLength(1)
    expect(sent.some((c) => c.method === 'Profiler.disable')).toBe(false)
  })

  // Network.enable carries buffer sizing. If a later holder needs a bigger buffer
  // than the first one asked for, skipping enable silently downgrades it — the
  // second holder runs with the first holder's (possibly default) limits.
  it('applies enable arguments from a later acquire so a richer config is not lost', async () => {
    await acquireDomain(42, 'Network')
    await acquireDomain(42, 'Network', { maxTotalBufferSize: 1024 })
    const enables = sent.filter((c) => c.method === 'Network.enable')
    expect(enables).toHaveLength(2)
    expect(enables[1].params).toMatchObject({ maxTotalBufferSize: 1024 })
  })

  it('does not re-enable when a later acquire repeats the same arguments', async () => {
    await acquireDomain(42, 'Network', { maxTotalBufferSize: 1024 })
    await acquireDomain(42, 'Network', { maxTotalBufferSize: 1024 })
    expect(sent.filter((c) => c.method === 'Network.enable')).toHaveLength(1)
  })

  // A count incremented before a failed enable is never released by anyone, so
  // every later acquire skips enable and its caller receives no events at all.
  it('rolls the count back when enable fails, so a retry still enables', async () => {
    failNext.add('Network.enable')
    await expect(acquireDomain(42, 'Network')).rejects.toThrow()
    sent.length = 0
    await acquireDomain(42, 'Network')
    expect(sent.filter((c) => c.method === 'Network.enable')).toHaveLength(1)
  })

  it('leaves no holder behind after a failed acquire, so a stray release stays a no-op', async () => {
    failNext.add('Network.enable')
    await expect(acquireDomain(42, 'Network')).rejects.toThrow()
    sent.length = 0
    await releaseDomain(42, 'Network')
    expect(sent.some((c) => c.method === 'Network.disable')).toBe(false)
  })

  it('ignores an unbalanced release instead of sending a stray disable', async () => {
    await releaseDomain(42, 'Network')
    expect(sent.some((c) => c.method === 'Network.disable')).toBe(false)
  })

  // Detaching drops every domain subscription on the target. If the refcount
  // survived, the next acquire would skip `enable` and the caller would receive
  // no events at all.
  it('clears counts on detach so the next acquire re-enables', async () => {
    await acquireDomain(42, 'Network')
    detachAllCdp()
    sent.length = 0
    await acquireDomain(42, 'Network')
    expect(sent.filter((c) => c.method === 'Network.enable')).toHaveLength(1)
  })
})

describe('cdpPress focus routing', () => {
  it('enables focus emulation on attach so keys reach an unfocused page', async () => {
    await cdpPress(42, 'r')
    const focusIdx = sent.findIndex(
      (c) => c.method === 'Emulation.setFocusEmulationEnabled' && (c.params as { enabled?: boolean })?.enabled === true,
    )
    const keyIdx = sent.findIndex((c) => c.method === 'Input.dispatchKeyEvent')
    expect(focusIdx).toBeGreaterThanOrEqual(0)
    expect(keyIdx).toBeGreaterThan(focusIdx)
  })

  it('does not rely on webContents.focus() for key delivery', async () => {
    await cdpPress(42, 'r')
    expect(fakeWc.focus).not.toHaveBeenCalled()
  })

  it('dispatches keyDown/keyUp for a character key with code and text', async () => {
    await cdpPress(42, 'r')
    const keyEvents = sent.filter((c) => c.method === 'Input.dispatchKeyEvent').map((c) => c.params as Record<string, unknown>)
    expect(keyEvents).toHaveLength(2)
    expect(keyEvents[0]).toMatchObject({ type: 'keyDown', key: 'r', code: 'KeyR', text: 'r' })
    expect(keyEvents[1]).toMatchObject({ type: 'keyUp', key: 'r', code: 'KeyR' })
  })
})

describe('cdpType focus routing', () => {
  it('does not call webContents.focus() (would steal host composer focus)', async () => {
    fakeDebugger.sendCommand.mockImplementation((method: string, params?: object) => {
      sent.push({ method, params })
      if (method === 'Runtime.evaluate') return Promise.resolve({ result: { value: true } })
      return Promise.resolve({})
    })
    await cdpType(42, 'hello')
    expect(fakeWc.focus).not.toHaveBeenCalled()
  })

  it('inserts text via CDP after page-level focus emulation attach', async () => {
    fakeDebugger.sendCommand.mockImplementation((method: string, params?: object) => {
      sent.push({ method, params })
      if (method === 'Runtime.evaluate') return Promise.resolve({ result: { value: true } })
      return Promise.resolve({})
    })
    await cdpType(42, 'hello')
    const focusEmu = sent.findIndex(
      (c) => c.method === 'Emulation.setFocusEmulationEnabled' && (c.params as { enabled?: boolean })?.enabled === true,
    )
    const insertIdx = sent.findIndex((c) => c.method === 'Input.insertText')
    expect(focusEmu).toBeGreaterThanOrEqual(0)
    expect(insertIdx).toBeGreaterThan(focusEmu)
    expect(sent[insertIdx]?.params).toMatchObject({ text: 'hello' })
  })
})
