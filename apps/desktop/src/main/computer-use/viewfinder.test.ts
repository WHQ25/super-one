import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  claimComputerUseViewfinder,
  forwardComputerUseViewfinderFrame,
  getComputerUseViewfinderTarget,
  releaseComputerUseViewfinder,
  setComputerUseViewfinderClaimSink,
  setComputerUseViewfinderFrameSink,
} from './viewfinder'

describe('Computer Use viewfinder bridge', () => {
  const onClaim = vi.fn()
  const onFrame = vi.fn()

  beforeEach(() => {
    onClaim.mockReset()
    onFrame.mockReset()
    releaseComputerUseViewfinder()
    onClaim.mockReset()
    setComputerUseViewfinderClaimSink(onClaim)
    setComputerUseViewfinderFrameSink(onFrame)
  })

  it('forwards only complete frame events', () => {
    expect(forwardComputerUseViewfinderFrame({
      event: 'computer_use_viewfinder_frame',
      sessionId: 'session-a', windowId: 42, width: 480, height: 320, data: 'jpeg',
    })).toBe(true)
    expect(onFrame).toHaveBeenCalledWith({
      sessionId: 'session-a', windowId: 42, width: 480, height: 320, data: 'jpeg',
    })

    expect(forwardComputerUseViewfinderFrame({
      event: 'computer_use_viewfinder_frame', sessionId: 'session-a', data: 'broken',
    })).toBe(false)
    expect(onFrame).toHaveBeenCalledTimes(1)
  })

  it('releases the renderer claim when the native stream fails', () => {
    expect(forwardComputerUseViewfinderFrame({
      event: 'computer_use_viewfinder_stopped', sessionId: 'session-a', windowId: 42,
    })).toBe(true)
    expect(onClaim).toHaveBeenCalledWith({ sessionId: 'session-a', active: false })
  })

  it('exposes only the active target for the requested session', () => {
    claimComputerUseViewfinder({
      sessionId: 'session-a', windowId: 42, pid: 123,
      bundleId: 'com.apple.TextEdit', title: 'Document',
    })

    expect(getComputerUseViewfinderTarget('session-a')).toMatchObject({
      sessionId: 'session-a', windowId: 42, pid: 123,
    })
    expect(getComputerUseViewfinderTarget('session-b')).toBeNull()

    releaseComputerUseViewfinder('session-a')
    expect(getComputerUseViewfinderTarget('session-a')).toBeNull()
  })
})
