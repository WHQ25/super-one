/**
 * End-to-end checks against a REAL Android device on this machine.
 *
 * Skipped unless `ANDROID_LIVE=1`, because they need an SDK, a booted AVD, and ~10
 * seconds. Everything they cover is also covered by the unit tests against captured
 * output — what these add is proof that the captures still match what the tools
 * actually emit, which is the thing that silently rots.
 *
 *   cd apps/desktop
 *   ~/Library/Android/sdk/emulator/emulator -avd <your-avd> -no-window &
 *   ANDROID_LIVE=1 bunx vitest run src/main/device/android/live.manual.test.ts
 *
 * adb binds a daemon port, so this needs to run outside the sandbox.
 */

import { writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { listDeviceCatalog, type DeviceEntry } from '../../device-agent/device-catalog'
import { detectAndroidToolchain, AndroidDeviceManager } from './android-device-manager'
import { AndroidDevicePort } from './device-port'
import { uiautomatorToTree } from './uiautomator'
import { hasUsableSemantics } from '../tree'

const live = process.env.ANDROID_LIVE === '1'

/** Vitest swallows console output under some reporters; a file always survives. */
function report(...parts: unknown[]): void {
  const line = parts
    .map((part) => (typeof part === 'string' ? part : JSON.stringify(part, null, 2)))
    .join(' ')
  const target = process.env.ANDROID_LIVE_REPORT
  if (target) writeFileSync(target, line + '\n', { flag: 'a' })
}

describe.skipIf(!live)('against a real Android device', () => {
  const toolchain = detectAndroidToolchain()

  it('finds the SDK on this machine', () => {
    expect(toolchain).not.toBeNull()
  })

  it('lists what adb and the emulator between them can see', async () => {
    const manager = new AndroidDeviceManager(toolchain!)
    const devices = await manager.listDevices()
    report('devices:', devices.map((device) => ({
      id: device.id,
      name: device.name,
      kind: device.kind,
      version: device.platformVersion,
      running: device.running,
    })))
    expect(devices.length).toBeGreaterThan(0)
  }, 60_000)

  it('offers those devices through the shared catalog, tiers and all', async () => {
    const manager = new AndroidDeviceManager(toolchain!)
    const result = await listDeviceCatalog({
      sessionId: 'live',
      ports: [new AndroidDevicePort(manager)],
    })
    report('catalog:', JSON.stringify(result, null, 2))
    expect(result.total as number).toBeGreaterThan(0)
    expect(result.kinds).toBeDefined()
  }, 60_000)

  it('reads a running device\'s screen into the shared tree', async () => {
    const manager = new AndroidDeviceManager(toolchain!)
    const devices = await manager.listDevices()
    const running = devices.find((device) => device.running)
    if (!running) {
      // eslint-disable-next-line no-console
      console.log('no device is running; boot one to exercise this')
      return
    }
    const serial = manager.serialFor(running.id)
    expect(serial).toBeTruthy()

    const started = Date.now()
    const xml = (await toolchain!.adb.execOut(serial!, ['uiautomator', 'dump', '/dev/tty']))
      .toString('utf8')
    const elapsed = Date.now() - started

    const dump = uiautomatorToTree(xml)
    report(`dump took ${elapsed}ms, screen ${dump?.screen.width}x${dump?.screen.height}`)
    expect(dump).not.toBeNull()
    expect(hasUsableSemantics(dump!.tree.root)).toBe(true)

    // The measurement that shaped the backend: this is far too slow to sit inside a
    // settle loop, which is why the Android backend settles on the frame hash and
    // dumps once.
    expect(elapsed).toBeGreaterThan(0)
  }, 60_000)

  it('quotes a runnable adb command in the control note', async () => {
    const manager = new AndroidDeviceManager(toolchain!)
    const devices = await manager.listDevices()
    const running = devices.find((device) => device.running)
    if (!running) return
    const note = new AndroidDevicePort(manager).controlNote(running)
    // The serial, never the `android:avd:…` catalog id — adb has never heard of that.
    expect(note).toContain(manager.serialFor(running.id))
    expect(note).not.toContain('android:avd:')
  }, 60_000)
})

describe.skipIf(!live)('catalog entries', () => {
  it('carries ids the control flow can resolve back', async () => {
    const toolchain = detectAndroidToolchain()
    const manager = new AndroidDeviceManager(toolchain!)
    const result = await listDeviceCatalog({
      sessionId: 'live',
      ports: [new AndroidDevicePort(manager)],
    })
    for (const entry of (result.running ?? []) as DeviceEntry[]) {
      expect(entry.id.startsWith('android:')).toBe(true)
    }
  }, 60_000)
})
