/**
 * The renderer's way to a device, whichever platform provides it.
 *
 * One set of channels for both. The router is `surfaceFor`, and it asks the platforms
 * rather than remembering: a session can be handed from a simulator to a phone, and a
 * cached answer would keep sending touches to the device it used to hold.
 *
 * Four channels stay iOS-specific and live in `ios-simulator/ipc.ts` — the runtime
 * list, DeviceKit artwork, creating a simulator, and the Xcode probe. Those are not
 * shared concepts, and giving Android an empty implementation of each would be a lie
 * the UI then has to check for.
 */

import { BrowserWindow, ipcMain, MessageChannelMain, type MessagePortMain } from 'electron'
import { AgentIpcChannels } from '@superone/shared/agent-types'
import type { DeviceDescriptor, DeviceInput, DeviceStreamOptions } from '@superone/shared/device'
import log from '../logger'
import type { DeviceSurface } from './surface'

const openPorts = new Map<string, { port: MessagePortMain; unsubscribe: () => void }>()

function portKey(webContentsId: number, sessionId: string): string {
  return `${webContentsId}:${sessionId}`
}

function closePort(key: string): void {
  const current = openPorts.get(key)
  if (!current) return
  openPorts.delete(key)
  current.unsubscribe()
  current.port.close()
}

export interface DeviceIpcOptions {
  /** In catalog order. The first one is where a session with no device lands. */
  surfaces: () => DeviceSurface[]
  /** Every platform's devices, merged. Shared with what the agent's `device_list` reads. */
  listDevices: () => Promise<DeviceDescriptor[]>
}

/**
 * Which surface owns this session.
 *
 * Asked in order and answered by the first that claims it. A session holding nothing
 * falls to the first surface, which is what makes an empty panel show the simulator's
 * device picker rather than nothing at all.
 *
 * Synchronous, and that is a requirement rather than a convenience: this runs in
 * front of EVERY call the panel makes, including one input per 8ms of a drag. It
 * used to ask `sessionState`, which on iOS spawns `simctl list devices --json` —
 * a quarter of a second, per touch sample. See `DeviceSurface.owns`.
 */
function surfaceFor(surfaces: DeviceSurface[], sessionId: string): DeviceSurface {
  for (const surface of surfaces) {
    if (surface.owns(sessionId)) return surface
  }
  const fallback = surfaces[0]
  if (!fallback) throw new Error('No device platform is available on this machine.')
  return fallback
}

/**
 * The surface that owns a device id, by its platform prefix.
 *
 * Used for the calls that name a device rather than rely on the session already
 * holding one — binding and booting, which are how a session comes to hold one at all.
 */
function surfaceForDevice(surfaces: DeviceSurface[], deviceId: string): DeviceSurface {
  const separator = deviceId.indexOf(':')
  const platform = separator > 0 ? deviceId.slice(0, separator) : 'ios'
  const surface = surfaces.find((candidate) => candidate.platform === platform)
  if (!surface) throw new Error(`No backend is registered for ${platform}.`)
  return surface
}

export function registerDeviceIpc(options: DeviceIpcOptions): void {
  const { surfaces } = options

  // Broadcast rather than target a window: a session can be open in more than one, and
  // the payload names the session it describes so a renderer can drop what is not its
  // own. Orientation and the keyboard switch live in the main process, and an agent
  // driving the device changes them behind every panel's back.
  for (const surface of surfaces()) {
    surface.onSessionState((state) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (win.isDestroyed()) continue
        win.webContents.send(AgentIpcChannels.ENVIRONMENT_DEVICE_STATE, state)
      }
    })
  }

  const bySession = (sessionId: string) => surfaceFor(surfaces(), sessionId)

  // The catalog, not the surfaces: discovering devices is the ports' job and they
  // already merge every platform into one ordered list for the agent. The picker shows
  // the same list, so it asks the same code.
  ipcMain.handle(AgentIpcChannels.ENVIRONMENT_DEVICE_LIST, () => options.listDevices())

  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_DEVICE_STATE,
    (_event, sessionId: string) => bySession(sessionId).sessionState(sessionId),
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_DEVICE_BIND,
    (_event, sessionId: string, deviceId: string) =>
      surfaceForDevice(surfaces(), deviceId).bind(sessionId, deviceId),
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_DEVICE_BOOT,
    (_event, sessionId: string, deviceId: string) =>
      surfaceForDevice(surfaces(), deviceId).boot(sessionId, deviceId),
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_DEVICE_DETACH,
    (_event, sessionId: string) => bySession(sessionId).detach(sessionId),
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_DEVICE_SHUTDOWN,
    (_event, sessionId: string) => bySession(sessionId).shutdown(sessionId),
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_DEVICE_RELEASE,
    async (_event, sessionId: string) => {
      // Every surface, not just the owner: releasing is cleanup on the way out, and a
      // session that changed platforms mid-life may have left state on both.
      await Promise.all(surfaces().map((surface) => surface.release(sessionId).catch(() => undefined)))
    },
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_DEVICE_INPUT,
    (_event, sessionId: string, input: DeviceInput) => bySession(sessionId).input(sessionId, input),
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_DEVICE_SCREENSHOT,
    (_event, sessionId: string) => bySession(sessionId).screenshot(sessionId),
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_DEVICE_RECORD_START,
    (_event, sessionId: string) => bySession(sessionId).startRecording(sessionId),
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_DEVICE_RECORD_STOP,
    (_event, sessionId: string) => bySession(sessionId).stopRecording(sessionId),
  )

  ipcMain.on(
    AgentIpcChannels.ENVIRONMENT_DEVICE_STREAM_OPEN,
    (event, sessionId: string, options?: DeviceStreamOptions) => {
      const key = portKey(event.sender.id, sessionId)
      closePort(key)
      const { port1, port2 } = new MessageChannelMain()
      // Subscribing and recording the port happen in one synchronous step, which is
      // what makes a close arriving right behind an open safe: there is no window in
      // which the subscription exists but its map entry does not. Routing used to be
      // asynchronous, and carrying a late subscription across that gap needed a flag.
      let unsubscribe = () => {}
      try {
        unsubscribe = surfaceFor(surfaces(), sessionId).subscribe(sessionId, (frame) => {
          try { port2.postMessage(frame) } catch { closePort(key) }
        }, options)
      } catch (error: unknown) {
        // Without this the panel sits on its spinner forever: a stream that never
        // starts looks exactly like one that has not produced a frame yet.
        log.warn('[device] preview stream failed to start', error)
      }
      openPorts.set(key, { port: port2, unsubscribe })
      port2.on('close', () => closePort(key))
      port2.start()
      event.sender.postMessage(
        AgentIpcChannels.ENVIRONMENT_DEVICE_STREAM_PORT,
        { sessionId },
        [port1],
      )
    },
  )
  ipcMain.on(
    AgentIpcChannels.ENVIRONMENT_DEVICE_STREAM_CLOSE,
    (event, sessionId: string) => closePort(portKey(event.sender.id, sessionId)),
  )
}

export function closeDevicePorts(): void {
  for (const key of [...openPorts.keys()]) closePort(key)
}
