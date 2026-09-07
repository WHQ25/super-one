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
import type { DeviceUiNode } from '@superone/shared/device-agent'
import { encodeSetClipboard } from './scrcpy-control'
import { listDeviceCatalog, type DeviceEntry } from '../../device-agent/device-catalog'
import { detectAndroidToolchain, AndroidDeviceManager } from './android-device-manager'
import { AndroidDevicePort } from './device-port'
import { uiautomatorToTree } from './uiautomator'
import { collectNodes, findNode, hasUsableSemantics } from '../tree'
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

/**
 * Text entry, against a device whose keyboard composes.
 *
 * The reason this exists is that the bug it guards is invisible without one. With
 * Gboard on Pinyin, `INJECT_TEXT` put NOTHING in the field: the letters sat in the
 * composition buffer, the tree kept reporting the field empty, and a later space
 * committed them alongside the next injection as `audit你好`. Set the emulator up with
 *
 *   adb shell settings put secure selected_input_method_subtype <zh_CN subtype hash>
 *
 * (read the hash out of `adb shell dumpsys input_method`) to exercise that path; on an
 * English keyboard these still pass, they just prove less.
 */
describe.skipIf(!live)('entering text on a real device', () => {
  /** Settings' own search field: an EditText with a hint, on every Android build. */
  const SEARCH_FIELD = 'open_search_view_edit_text'

  async function searchScreen(manager: AndroidDeviceManager, serial: string) {
    await manager.adb.shell(serial, ['am', 'force-stop', 'com.google.android.settings.intelligence'])
    await manager.adb.shell(serial, ['am', 'start', '-a', 'android.settings.APP_SEARCH_SETTINGS'])
    await new Promise((resolve) => setTimeout(resolve, 3000))
  }

  function fieldValue(observation: { root: DeviceUiNode }): string | undefined {
    return findNode(observation.root, (node) => node.identifier?.endsWith(SEARCH_FIELD) === true)?.value
  }

  it('puts text in the field even when the keyboard would compose it', async () => {
    const toolchain = detectAndroidToolchain()
    const manager = new AndroidDeviceManager(toolchain!)
    const running = (await manager.listDevices()).find((device) => device.running)
    if (!running) { report('no running device'); return }
    await manager.boot('live-text', running.id)
    const serial = manager.serialFor(running.id)!
    const backend = new AndroidBackend(manager, running.id, '/tmp/claude/live-captures')

    const mode = (await manager.adb.execOut(serial, ['dumpsys', 'input_method']))
      .toString('utf8').match(/current_input_method_entry: "([^"]*)"/)?.[1]
    report(`guest keyboard: ${mode}`)

    await searchScreen(manager, serial)
    const before = await backend.observe()
    // An empty hinted field reports its hint as `text` in the dump; the tree must not
    // pass that off as a value somebody typed.
    expect(fieldValue(before)).toBeUndefined()

    await backend.perform({ kind: 'type', text: 'check' }, { observation: before })
    await new Promise((resolve) => setTimeout(resolve, 1500))
    const after = await backend.observe()
    report(`typed "check" -> ${JSON.stringify(fieldValue(after))}`)
    expect(fieldValue(after)).toBe('check')

    await manager.dispose()
  }, 180_000)

  it('replaces the field with setText, and clears it with an empty one', async () => {
    const toolchain = detectAndroidToolchain()
    const manager = new AndroidDeviceManager(toolchain!)
    const running = (await manager.listDevices()).find((device) => device.running)
    if (!running) return
    await manager.boot('live-settext', running.id)
    const serial = manager.serialFor(running.id)!
    const backend = new AndroidBackend(manager, running.id, '/tmp/claude/live-captures')

    await searchScreen(manager, serial)
    let observation = await backend.observe()
    await backend.perform({ kind: 'type', text: 'audit' }, { observation })
    await new Promise((resolve) => setTimeout(resolve, 1200))

    observation = await backend.observe()
    await backend.perform({ kind: 'setText', text: 'theme' }, { observation })
    await new Promise((resolve) => setTimeout(resolve, 1200))
    observation = await backend.observe()
    report(`setText -> ${JSON.stringify(fieldValue(observation))}`)
    expect(fieldValue(observation)).toBe('theme')

    await backend.perform({ kind: 'setText', text: '' }, { observation })
    await new Promise((resolve) => setTimeout(resolve, 1200))
    observation = await backend.observe()
    report(`cleared -> ${JSON.stringify(fieldValue(observation))}`)
    expect(fieldValue(observation)).toBeUndefined()

    await manager.dispose()
  }, 180_000)

  it('gives the device its clipboard back after typing through it', async () => {
    const toolchain = detectAndroidToolchain()
    const manager = new AndroidDeviceManager(toolchain!)
    const running = (await manager.listDevices()).find((device) => device.running)
    if (!running) return
    await manager.boot('live-clipboard', running.id)
    const serial = manager.serialFor(running.id)!
    const backend = new AndroidBackend(manager, running.id, '/tmp/claude/live-captures')

    await searchScreen(manager, serial)
    const observation = await backend.observe()
    // Seeded through the same channel typing uses, so the read-back is proving the
    // save/restore rather than the seeding.
    const connection = await manager.connection(running.id)
    connection.send(encodeSetClipboard('user-had-this-copied', false))
    await new Promise((resolve) => setTimeout(resolve, 800))

    await backend.perform({ kind: 'type', text: 'check' }, { observation })
    await new Promise((resolve) => setTimeout(resolve, 1500))

    // Read off the connection's own last-known value, which is the only way to ask:
    // GET_CLIPBOARD is implemented on the device by PRESSING copy, so using it would
    // change the very thing under test.
    // Subscribing replays the last clipboard synchronously, so this reads the value
    // rather than waiting for a change that will never come.
    let restored: string | null = null
    const off = connection.onDeviceMessage((message) => {
      if (message.kind === 'clipboard') restored = message.text
    })
    off()
    report(`clipboard after typing: ${JSON.stringify(restored)}`)
    expect(restored).toBe('user-had-this-copied')

    await manager.dispose()
  }, 180_000)
})
