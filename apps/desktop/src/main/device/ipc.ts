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
import { parseDeviceId } from '@superone/shared/device'
import type {
  DeviceDescriptor,
  DeviceInput,
  DeviceSessionState,
  DeviceStreamOptions,
} from '@superone/shared/device'
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

/** What the panel sees before it holds anything: an empty stage with a picker. */
function emptyDeviceState(sessionId: string): DeviceSessionState {
  return {
    sessionId,
    device: null,
    phase: 'idle',
    interactive: false,
    orientation: 'portrait',
  }
}

export interface DeviceIpcOptions {
  /** In catalog order. The first one is where a session with no device lands. */
  surfaces: () => DeviceSurface[]
  /** Every platform's devices, merged. Shared with what the agent's `device_list` reads. */
  listDevices: () => Promise<DeviceDescriptor[]>
}

/**
 * The surface that speaks to a device, read off the id's provider prefix.
 *
 * A pure function: `parseDeviceId` gives the provider, and the provider is what each
 * surface registers under. Nothing to consult, nothing to keep in step — which is
 * what makes routing cheap enough to sit in front of every touch sample.
 */
function surfaceForDevice(surfaces: DeviceSurface[], deviceId: string): DeviceSurface {
  const provider = parseDeviceId(deviceId)?.provider
  const surface = provider ? surfaces.find((candidate) => candidate.provider === provider) : undefined
  if (!surface) throw new Error(`No backend is registered for ${deviceId}.`)
  return surface
}

/**
 * MIGRATION SHIM — the last place that turns a session into a device.
 *
 * Every channel below is about one device, but the renderer still names the session
 * and lets the host work out which device that is. That was well defined while a
 * session could hold only one; it is exactly what is being replaced. Until the
 * renderer sends the deviceId itself, this resolves the single device a session
 * holds, which reproduces today's behaviour precisely.
 *
 * A session holding nothing falls back to the first surface, which is what makes an
 * empty panel open on the simulator's device picker rather than on nothing.
 */
function sessionTarget(
  surfaces: DeviceSurface[],
  sessionId: string,
): { surface: DeviceSurface; deviceId: string } | null {
  for (const surface of surfaces) {
    const held = surface.devicesOf(sessionId)
    if (held.length > 0) return { surface, deviceId: held[0]! }
  }
  return null
}

export function registerDeviceIpc(options: DeviceIpcOptions): void {
  const { surfaces } = options

  // Broadcast rather than target a window: a session can be open in more than one, and
  // the payload names the session it describes so a renderer can drop what is not its
  // own. Orientation and the keyboard switch live in the main process, and an agent
  // driving the device changes them behind every panel's back.
  for (const surface of surfaces()) {
    surface.onState((state: DeviceSessionState) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (win.isDestroyed()) continue
        win.webContents.send(AgentIpcChannels.ENVIRONMENT_DEVICE_STATE, state)
      }
    })
  }

  const target = (sessionId: string) => sessionTarget(surfaces(), sessionId)

  // The catalog, not the surfaces: discovering devices is the ports' job and they
  // already merge every platform into one ordered list for the agent. The picker shows
  // the same list, so it asks the same code.
  ipcMain.handle(AgentIpcChannels.ENVIRONMENT_DEVICE_LIST, () => options.listDevices())

  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_DEVICE_STATE,
    (_event, sessionId: string) => {
      const held = target(sessionId)
      return held ? held.surface.state(held.deviceId) : emptyDeviceState(sessionId)
    },
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
    (_event, sessionId: string) => {
      const held = target(sessionId)
      return held ? held.surface.detach(held.deviceId) : emptyDeviceState(sessionId)
    },
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_DEVICE_SHUTDOWN,
    (_event, sessionId: string) => {
      const held = target(sessionId)
      return held ? held.surface.shutdown(held.deviceId) : emptyDeviceState(sessionId)
    },
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_DEVICE_RELEASE,
    async (_event, sessionId: string) => {
      // Every surface, not just the owner: releasing is cleanup on the way out, and a
      // session that changed platforms mid-life may have left state on both.
      await Promise.all(surfaces().map((surface) => surface.releaseSession(sessionId).catch(() => undefined)))
    },
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_DEVICE_INPUT,
    (_event, sessionId: string, input: DeviceInput) => {
      const held = target(sessionId)
      if (!held) return { ok: false, error: 'This session controls no device.' }
      return held.surface.input(held.deviceId, input)
    },
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_DEVICE_SCREENSHOT,
    (_event, sessionId: string) => {
      const held = target(sessionId)
      if (!held) throw new Error('This session controls no device.')
      return held.surface.screenshot(held.deviceId)
    },
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_DEVICE_RECORD_START,
    (_event, sessionId: string) => {
      const held = target(sessionId)
      if (!held) throw new Error('This session controls no device.')
      return held.surface.startRecording(held.deviceId)
    },
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_DEVICE_RECORD_STOP,
    (_event, sessionId: string) => {
      const held = target(sessionId)
      if (!held) throw new Error('This session controls no device.')
      return held.surface.stopRecording(held.deviceId)
    },
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
        const held = sessionTarget(surfaces(), sessionId)
        if (!held) throw new Error('This session controls no device.')
        unsubscribe = held.surface.subscribe(held.deviceId, (frame) => {
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
