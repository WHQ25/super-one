import { describe, expect, it, vi } from 'vitest'
import type { AndroidDeviceManager } from './android-device-manager'
import type { ScrcpyConnection } from './scrcpy-server'
import { faultFromServerLog } from './scrcpy-server'
import { createAndroidSurface } from './surface'

function connectionWith(controlFault: string | null, send = vi.fn()): ScrcpyConnection {
  return {
    deviceName: 'phone',
    screen: { width: 576, height: 1280 },
    controlFault,
    send,
    onMedia: () => () => {},
    onSession: () => () => {},
    onClosed: () => () => {},
    close: async () => {},
  } as unknown as ScrcpyConnection
}

function managerWith(connection: ScrcpyConnection): AndroidDeviceManager {
  return {
    serialFor: () => 'serial',
    connection: async () => connection,
  } as unknown as AndroidDeviceManager
}

describe('touching a phone that refuses injected input', () => {
  // The regression: the control socket accepts every byte written to it and the
  // device throws the message away, so the panel reported success on a tap that did
  // nothing at all. A person could tap a Xiaomi for ten minutes learning nothing.
  it('says why the tap did nothing instead of reporting success', async () => {
    const send = vi.fn()
    const surface = createAndroidSurface(managerWith(connectionWith(
      faultFromServerLog('[server] ERROR: … INJECT_EVENTS permission.'),
      send,
    )), '/tmp/captures')

    const result = await surface.input('android:serial', { type: 'tap', xRatio: 0.5, yRatio: 0.5 })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('USB debugging (Security settings)')
    // Nothing is written either: the socket would swallow it, and a message the
    // device cannot act on is only noise on a link that is already the bottleneck.
    expect(send).not.toHaveBeenCalled()
  })

  it('still sends on the phones that take input', async () => {
    const send = vi.fn()
    const surface = createAndroidSurface(managerWith(connectionWith(null, send)), '/tmp/captures')

    const result = await surface.input('android:serial', { type: 'tap', xRatio: 0.5, yRatio: 0.5 })

    expect(result.ok).toBe(true)
    expect(send).toHaveBeenCalledOnce()
  })
})

describe('reading the scrcpy server log', () => {
  it('recognises the one refusal a person can do something about', () => {
    expect(faultFromServerLog(
      '[server] ERROR: Injecting input events requires the caller … INJECT_EVENTS permission.',
    )).toContain('USB debugging (Security settings)')
  })

  it('leaves every other line alone', () => {
    expect(faultFromServerLog('[server] INFO: Device: [Xiaomi] Xiaomi 2410DPN6CC (Android 16)')).toBeNull()
    expect(faultFromServerLog('[server] ERROR: Could not inject char u+4e2d')).toBeNull()
  })
})
