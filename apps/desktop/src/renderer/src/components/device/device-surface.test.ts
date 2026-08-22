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
function show(
  deviceId: string,
  quality = QUALITY,
  onFrameState: (hasFrame: boolean) => void = () => {},
): HTMLCanvasElement | null {
  const host = document.createElement('div')
  let seen: HTMLCanvasElement | null = null
  attachDeviceSurface(
    deviceId,
    host,
    { quality, framed: false },
    onFrameState,
    (canvas) => { seen = canvas ?? seen },
  )()
  return seen
}

describe('attachDeviceSurface', () => {
  beforeEach(() => {
    clearRect.mockClear()
    stubEnvironment()
  })
  afterEach(() => { resetDeviceSurfaces() })

  /**
   * A different phone is not a stale version of this one, so it cannot inherit its
   * picture — a simulator that repaints only when something happens would hold the
   * wrong device's last frame indefinitely.
   *
   * This used to be enforced by wiping the shared canvas on a device switch. It is
   * now structural: the picture is keyed by device, so a second device is a second
   * surface with its own blank canvas and its own stream, and there is nothing to
   * inherit. That is also what lets two devices be watched at once.
   */
  it('gives a second device its own canvas and stream rather than the first one\'s', () => {
    const first = show('ios-sim:a')
    const started: boolean[] = []

    const second = show('android:emulator-5554', QUALITY, (hasFrame) => started.push(hasFrame))

    expect(second).not.toBe(first)
    expect(started).toEqual([false])
    expect(window.environment.openDeviceStream).toHaveBeenCalledTimes(2)
    // The first device's stream is untouched: both are being watched.
    expect(window.environment.closeDeviceStream).not.toHaveBeenCalled()
  })

  it('keeps the picture across a quality change, which is the same device resized', () => {
    const first = show('ios-sim:a')

    const again = show('ios-sim:a', { scale: 0.5, maxFrameRate: 30 })

    // Blanking here would flash black every time preview quality changes, and the
    // old resolution on screen is a perfectly good stand-in until the new one lands.
    expect(again).toBe(first)
    expect(clearRect).not.toHaveBeenCalled()
    expect(window.environment.closeDeviceStream).toHaveBeenCalledWith('ios-sim:a')
    expect(window.environment.openDeviceStream).toHaveBeenCalledTimes(2)
  })

  it('leaves a re-attach of the same device and quality entirely alone', () => {
    show('ios-sim:a')
    clearRect.mockClear()

    show('ios-sim:a')

    expect(clearRect).not.toHaveBeenCalled()
    // No renegotiation at all: moving the picture between surfaces must not cost a
    // stream restart, which is the whole reason the canvas is reused.
    expect(window.environment.openDeviceStream).toHaveBeenCalledTimes(1)
  })
})
