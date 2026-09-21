import { afterEach, describe, expect, it, vi } from 'vitest'
import log from '../logger'
import { computerUseDiagnostic, diagnoseHelperCall, diagnosticRoot } from './diagnostics'

vi.mock('../logger', () => ({ default: { info: vi.fn() } }))
afterEach(() => { vi.clearAllMocks(); vi.useRealTimers() })
const output = () => JSON.stringify(vi.mocked(log.info).mock.calls)

describe('computer use diagnostics', () => {
  it('logs only metadata from capture and preserves the exact result', async () => {
    const result = { data: 'private-image', title: 'private-title', coordinateSpace: { width: 800, height: 600 } }
    await expect(diagnoseHelperCall('capture', {
      sessionId: 'privacy', windowId: 42, text: 'private-input', windowTitle: 'private-title',
    }, async () => result)).resolves.toBe(result)
    expect(output()).toContain('privacy')
    expect(output()).toContain('800')
    expect(output()).not.toContain('private-')
  })

  it('records native discovery and placement diagnostics without copying window rows', async () => {
    await diagnoseHelperCall('list_windows', { sessionId: 'native' }, async () => ({
      windows: [{ title: 'private-title' }], diagnostics: { axBudgetExceeded: true, returnedCount: 1 },
    }))
    await diagnoseHelperCall('display_place_window', { sessionId: 'native', displayId: '2', windowId: 1 }, async () => ({
      moved: true, diagnostics: { onTarget: false, readbackAvailable: true },
    }))
    expect(output()).toContain('axBudgetExceeded')
    expect(output()).toContain('onTarget')
    expect(output()).not.toContain('private-title')
  })

  it('preserves failures while logging code instead of message or input', async () => {
    const error = Object.assign(new Error('private-message'), { code: 'WINDOW_UNAVAILABLE' })
    await expect(diagnoseHelperCall('click', { sessionId: 'failure', text: 'private-input' }, async () => {
      throw error
    })).rejects.toBe(error)
    expect(output()).toContain('WINDOW_UNAVAILABLE')
    expect(output()).not.toContain('private-')
  })

  it('deduplicates polling, emits changes immediately and repeats after a minute', () => {
    vi.useFakeTimers()
    const fields = { sessionId: 'dedup', windowId: 123 }
    computerUseDiagnostic('test', fields)
    computerUseDiagnostic('test', fields)
    expect(log.info).toHaveBeenCalledTimes(1)
    computerUseDiagnostic('test', { ...fields, moved: true })
    expect(log.info).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(60_000)
    computerUseDiagnostic('test', { ...fields, moved: true })
    expect(log.info).toHaveBeenCalledTimes(3)
  })

  it('does not change helper success when logging fails', async () => {
    vi.mocked(log.info).mockImplementationOnce(() => { throw new Error('disk full') })
    const result = { diagnostics: {} }
    await expect(diagnoseHelperCall('list_windows', { sessionId: 'disk-failure' }, async () => result)).resolves.toBe(result)
  })

  it('omits app display name and window title from root metadata', () => {
    const result = diagnosticRoot({
      rootId: '@r1', windowId: 1, pid: 42, bundleId: 'com.test', kind: 'window',
      app: 'private-app-name', title: 'private-title', bounds: { x: -800, y: 0, width: 800, height: 600 },
      focused: false, visible: true, minimized: false, modal: false, resourceKey: 'pid:42',
    })
    expect(result.hasTitle).toBe(true)
    expect(result.bounds.x).toBe(-800)
    expect(JSON.stringify(result)).not.toContain('private-')
  })
})
