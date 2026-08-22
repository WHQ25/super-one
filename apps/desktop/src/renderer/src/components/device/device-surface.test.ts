/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IosSimulatorPreviewQuality } from '@superone/shared/ios-simulator'
import { attachDeviceSurface, resetDeviceSurfaces } from './device-surface'

const QUALITY: IosSimulatorPreviewQuality = { scale: 1, maxFrameRate: 60 }

const clearRect = vi.fn()

function stubEnvironment() {
  // The setup file installs a get-trap Proxy that ignores its target, so the whole
  // object has to be replaced rather than assigned onto.
  Object.defineProperty(window, 'environment', {
    configurable: true,
    value: {
      onDeviceFrame: vi.fn(() => () => {}),
      openDeviceStream: vi.fn(),
      closeDeviceStream: vi.fn(),
    },
  })
  // jsdom has no 2D context at all, and wiping the old bitmap goes through one.
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ clearRect, drawImage: vi.fn() })) as never
}

/** Attach, then let go, leaving the surface parked for the next attach to adopt. */
function show(deviceId: string, quality = QUALITY, onFrameState = () => {}): void {
  const host = document.createElement('div')
  attachDeviceSurface(
    'session-1',
    host,
    { deviceId, quality, framed: false },
    onFrameState,
    () => {},
  )()
}

describe('attachDeviceSurface', () => {
  beforeEach(() => {
    clearRect.mockClear()
    stubEnvironment()
  })
  afterEach(() => { resetDeviceSurfaces() })

  it('drops the picture when the session changes device', () => {
    show('ios:a')
    clearRect.mockClear()
    const seen: boolean[] = []

    show('ios:b', QUALITY, () => seen.push(false))

    // A different phone is not a stale version of this one. Keeping its last frame
    // shows the wrong device — and a simulator that repaints only when something
    // happens can hold that frame indefinitely.
    expect(clearRect).toHaveBeenCalled()
    expect(window.environment.closeDeviceStream).toHaveBeenCalledWith('session-1')
    expect(window.environment.openDeviceStream).toHaveBeenCalledTimes(2)
  })

  it('keeps the picture across a quality change, which is the same device resized', () => {
    show('ios:a')
    clearRect.mockClear()

    show('ios:a', { scale: 0.5, maxFrameRate: 30 })

    // Blanking here would flash black every time preview quality changes, and the
    // old resolution on screen is a perfectly good stand-in until the new one lands.
    expect(clearRect).not.toHaveBeenCalled()
    expect(window.environment.openDeviceStream).toHaveBeenCalledTimes(2)
  })

  it('leaves a re-attach of the same device and quality entirely alone', () => {
    show('ios:a')
    clearRect.mockClear()

    show('ios:a')

    expect(clearRect).not.toHaveBeenCalled()
    // No renegotiation at all: moving the picture between surfaces must not cost a
    // stream restart, which is the whole reason the canvas is reused.
    expect(window.environment.openDeviceStream).toHaveBeenCalledTimes(1)
  })
})
