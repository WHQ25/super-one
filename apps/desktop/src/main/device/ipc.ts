/**
 * The renderer's way to a device, whichever platform provides it.
 *
 * One set of channels for both, and every one of them names the DEVICE. A chat
 * session may hold several at once — a client build on one phone and a merchant build
 * on another — so "which device does this session mean" has no answer for the host to
 * give; the panel that opened the device is the thing that knows.
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
  DeviceState,
  DeviceStreamOptions,
} from '@superone/shared/device'
import log from '../logger'
import type { DeviceSurface } from './surface'

const openPorts = new Map<string, { port: MessagePortMain; unsubscribe: () => void }>()

function portKey(webContentsId: number, deviceId: string): string {
  return `${webContentsId}:${deviceId}`
}

function closePort(key: string): void {
  const current = openPorts.get(key)
  if (!current) return
  openPorts.delete(key)
  current.unsubscribe()
  current.port.close()
}

export interface DeviceIpcOptions {
  /** In catalog order. */
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

export function registerDeviceIpc(options: DeviceIpcOptions): void {
  const { surfaces } = options
  const forDevice = (deviceId: string) => surfaceForDevice(surfaces(), deviceId)

  // Broadcast rather than target a window: a device can be on screen in more than
  // one, and the payload names the device it describes so a renderer can drop what is
  // not its own. Orientation and the keyboard switch live in the main process, and an
  // agent driving the device changes them behind every panel's back.
  for (const surface of surfaces()) {
    surface.onState((state: DeviceState) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (win.isDestroyed()) continue
        win.webContents.send(AgentIpcChannels.ENVIRONMENT_DEVICE_STATE, state)
      }
    })
  }

  // The catalog, not the surfaces: discovering devices is the ports' job and they
  // already merge every platform into one ordered list for the agent. The picker shows
  // the same list, so it asks the same code.
  ipcMain.handle(AgentIpcChannels.ENVIRONMENT_DEVICE_LIST, () => options.listDevices())

  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_DEVICE_STATE,
    (_event, deviceId: string) => forDevice(deviceId).state(deviceId),
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_DEVICE_BIND,
    (_event, sessionId: string, deviceId: string) => forDevice(deviceId).bind(sessionId, deviceId),
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_DEVICE_BOOT,
    (_event, sessionId: string, deviceId: string) => forDevice(deviceId).boot(sessionId, deviceId),
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_DEVICE_DETACH,
    (_event, deviceId: string) => forDevice(deviceId).detach(deviceId),
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_DEVICE_SHUTDOWN,
    (_event, deviceId: string) => forDevice(deviceId).shutdown(deviceId),
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_DEVICE_RELEASE,
    (_event, deviceId: string) => forDevice(deviceId).release(deviceId),
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_DEVICE_INPUT,
    (_event, deviceId: string, input: DeviceInput) => forDevice(deviceId).input(deviceId, input),
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_DEVICE_SCREENSHOT,
    (_event, deviceId: string) => forDevice(deviceId).screenshot(deviceId),
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_DEVICE_RECORD_START,
    (_event, deviceId: string) => forDevice(deviceId).startRecording(deviceId),
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_DEVICE_RECORD_STOP,
    (_event, deviceId: string) => forDevice(deviceId).stopRecording(deviceId),
  )

  ipcMain.on(
    AgentIpcChannels.ENVIRONMENT_DEVICE_STREAM_OPEN,
    (event, deviceId: string, streamOptions?: DeviceStreamOptions) => {
      const key = portKey(event.sender.id, deviceId)
      closePort(key)
      const { port1, port2 } = new MessageChannelMain()
      // Subscribing and recording the port happen in one synchronous step, which is
      // what makes a close arriving right behind an open safe: there is no window in
      // which the subscription exists but its map entry does not. Routing used to be
      // asynchronous, and carrying a late subscription across that gap needed a flag.
      let unsubscribe = () => {}
      try {
        unsubscribe = forDevice(deviceId).subscribe(deviceId, (frame) => {
          try { port2.postMessage(frame) } catch { closePort(key) }
        }, streamOptions)
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
        { deviceId },
        [port1],
      )
    },
  )
  ipcMain.on(
    AgentIpcChannels.ENVIRONMENT_DEVICE_STREAM_CLOSE,
    (event, deviceId: string) => closePort(portKey(event.sender.id, deviceId)),
  )
}

export function closeDevicePorts(): void {
  for (const key of [...openPorts.keys()]) closePort(key)
}
