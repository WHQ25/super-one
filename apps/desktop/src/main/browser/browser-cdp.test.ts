import { describe, it, expect, vi, beforeEach } from 'vitest'

interface SentCommand {
  method: string
  params?: object
}

const sent: SentCommand[] = []
let attachedFlag = false

const fakeDebugger = {
  isAttached: () => attachedFlag,
  attach: vi.fn(() => {
    attachedFlag = true
  }),
  on: vi.fn(),
  once: vi.fn(),
  off: vi.fn(),
  sendCommand: vi.fn((method: string, params?: object) => {
    sent.push({ method, params })
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

const { cdpPress } = await import('./browser-cdp')

beforeEach(() => {
  sent.length = 0
  attachedFlag = false
  fakeDebugger.attach.mockClear()
  fakeDebugger.sendCommand.mockClear()
  fakeWc.focus.mockClear()
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
