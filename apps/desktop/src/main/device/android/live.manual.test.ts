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
import { collectNodes, hasUsableSemantics } from '../tree'
import { AndroidBackend } from '../../device-agent/android-backend'

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

describe.skipIf(!live)('driving a real device through the backend', () => {
  it('observes, acts, and sees the screen change', async () => {
    const toolchain = detectAndroidToolchain()
    const manager = new AndroidDeviceManager(toolchain!)
    const devices = await manager.listDevices()
    const running = devices.find((device) => device.running)
    if (!running) {
      report('no running device; boot one to exercise this')
      return
    }
    await manager.boot('live-drive', running.id)

    // The DEVICE, not the session — `AndroidBackend` has been addressed by device
    // since channels stopped being per-session, and a session may hold several.
    const backend = new AndroidBackend(manager, running.id, '/tmp/claude/live-captures')

    const started = Date.now()
    const before = await backend.observe()
    report(`observe took ${Date.now() - started}ms, settled=${before.settled}, `
      + `screen=${before.screen.width}x${before.screen.height}, `
      + `orientation=${before.orientation}, nodes=${collectNodes(before.root).length}`)
    expect(before.frameHash).toMatch(/^[0-9a-f]{64}$/)
    expect(hasUsableSemantics(before.root)).toBe(true)

    // HOME always changes the screen unless the launcher is already showing, so the
    // app switcher is opened first to guarantee there is something to leave.
    await backend.perform({ kind: 'key', button: 'app-switch' }, { observation: before })
    await new Promise((resolve) => setTimeout(resolve, 1200))
    const middle = await backend.observe()
    report(`after app-switch: hash changed = ${middle.frameHash !== before.frameHash}`)

    await backend.perform({ kind: 'key', button: 'home' }, { observation: middle })
    await new Promise((resolve) => setTimeout(resolve, 1200))
    const after = await backend.observe()
    report(`after home: hash changed = ${after.frameHash !== middle.frameHash}`)

    // At least one of the two navigations must have moved the picture. Asserting on
    // both would fail on a device that was already on the launcher.
    expect(middle.frameHash !== before.frameHash || after.frameHash !== middle.frameHash).toBe(true)

    const shot = await backend.capture()
    report(`capture -> ${shot.path} ${shot.width}x${shot.height}`)
    expect(shot.width).toBeGreaterThan(0)

    await manager.dispose()
  }, 180_000)

  it('opens the app drawer with a swipe and leaves no finger held down', async () => {
    const toolchain = detectAndroidToolchain()
    const manager = new AndroidDeviceManager(toolchain!)
    const devices = await manager.listDevices()
    const running = devices.find((device) => device.running)
    if (!running) return
    await manager.boot('live-swipe', running.id)
    const backend = new AndroidBackend(manager, running.id, '/tmp/claude/live-captures')

    const initial = await backend.observe()
    await backend.perform({ kind: 'key', button: 'home' }, { observation: initial })
    await new Promise((resolve) => setTimeout(resolve, 1200))
    const before = await backend.observe()
    const started = Date.now()
    await backend.perform(
      { kind: 'swipe', fromX: 0.5, fromY: 0.75, toX: 0.5, toY: 0.3, durationMs: 260 },
      { observation: before },
    )
    report(`swipe took ${Date.now() - started}ms`)
    // The gesture must have taken roughly its stated duration. Sent back to back it
    // would return instantly and the guest would read it as a teleport, not a swipe.
    expect(Date.now() - started).toBeGreaterThan(200)

    await new Promise((resolve) => setTimeout(resolve, 1200))
    const after = await backend.observe()
    report(`after swipe: hash changed = ${after.frameHash !== before.frameHash}`)
    expect(after.frameHash).not.toBe(before.frameHash)

    await manager.dispose()
  }, 180_000)
})
