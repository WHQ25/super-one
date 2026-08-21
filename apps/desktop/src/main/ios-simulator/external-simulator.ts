/**
 * Keeping Apple's Simulator.app out of the way of our own preview.
 *
 * `xcrun simctl boot` is headless — CoreSimulator carries no reference to
 * Simulator.app and cannot launch it. But a Simulator.app that is running subscribes
 * to device-state notifications and opens a window for every device that boots, so
 * booting a simulator from here makes a second, uninvited copy of the same screen
 * appear on the user's desktop.
 *
 * Hiding, not closing. Simulator.app treats closing a device window as "I am done
 * with this device" and shuts the guest down — measured, not assumed — which would
 * kill the very simulator this app is about to stream. `NSRunningApplication.hide()`
 * leaves the device booted and is one Cmd-Tab away from being undone, and unlike the
 * System Events route it needs no Accessibility permission.
 *
 * The work runs in the helper because AppKit is where the two things it needs live:
 * `NSRunningApplication.hide()` and `NSWorkspace`'s launch notifications. Electron's
 * main process can see neither.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { ensureIosSimulatorHelper } from './helper-build'
import log from '../logger'

/**
 * Start suppressing Apple's Simulator; returns the stop.
 *
 * Hides whatever is already up, then keeps hiding one every time it is LAUNCHED —
 * which is how `flutter run`, `expo run:ios` and Xcode bring it back mid-session. It
 * deliberately does not react to the app being unhidden or activated: that is the
 * user going to look at it, and undoing that would leave them unable to open Apple's
 * Simulator at all while a device was bound here.
 *
 * Best-effort by construction. A machine where the helper cannot be built is one
 * where the preview does not work either, so failing a boot over a window would
 * trade a small annoyance for a total one.
 */
export function watchExternalSimulator(cacheRoot: string): () => void {
  if (process.platform !== 'darwin') return () => {}

  let child: ChildProcess | null = null
  let stopped = false

  void ensureIosSimulatorHelper(cacheRoot)
    .then((binary) => {
      // Stopped while the helper was still being resolved — never start it at all,
      // or a fast bind/unbind pair leaks a watcher with nothing left to watch for.
      if (stopped) return
      const started = spawn(binary, ['--watch-simulator-app'], { stdio: ['pipe', 'ignore', 'pipe'] })
      started.on('error', (error) => log.warn('[ios-simulator] simulator watch failed', error))
      started.stderr?.on('data', (chunk: Buffer) =>
        log.warn('[ios-simulator] simulator watch:', chunk.toString().trim()))
      child = started
    })
    .catch((error) => log.warn('[ios-simulator] could not watch Apple Simulator', error))

  return () => {
    stopped = true
    // Closing stdin is the helper's own stop signal, which is also what happens if
    // this process dies — so the watcher can never outlive the app that started it.
    child?.stdin?.end()
    child = null
  }
}
