import { ipcMain, MessageChannelMain, type MessagePortMain } from 'electron'
import { AgentIpcChannels } from '@superone/shared/agent-types'
import type {
  IosSimulatorCreateRequest,
  IosSimulatorInput,
  IosSimulatorPreviewMode,
  IosSimulatorPreviewQuality,
} from '@superone/shared/ios-simulator'
import { getIosSimulatorManager } from './index'

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

export function registerIosSimulatorIpc(userDataPath: string): void {
  const manager = getIosSimulatorManager(userDataPath)

  ipcMain.handle(AgentIpcChannels.ENVIRONMENT_IOS_SIMULATOR_STATUS, (_event, force?: boolean) =>
    manager.status(force === true))
  ipcMain.handle(AgentIpcChannels.ENVIRONMENT_IOS_SIMULATOR_LIST, () => manager.listDevices())
  ipcMain.handle(AgentIpcChannels.ENVIRONMENT_IOS_SIMULATOR_RUNTIMES, () => manager.listRuntimes())
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_IOS_SIMULATOR_CHROME,
    (_event, udid: string) => manager.chrome(udid),
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_IOS_SIMULATOR_CREATE,
    (_event, request: IosSimulatorCreateRequest) => manager.createDevice(request),
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_IOS_SIMULATOR_BIND,
    (_event, sessionId: string, udid: string) => manager.bind(sessionId, udid),
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_IOS_SIMULATOR_BOOT,
    (_event, sessionId: string, udid: string) => manager.boot(sessionId, udid),
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_IOS_SIMULATOR_DETACH,
    (_event, sessionId: string) => manager.detach(sessionId),
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_IOS_SIMULATOR_SHUTDOWN,
    (_event, sessionId: string) => manager.shutdown(sessionId),
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_IOS_SIMULATOR_RELEASE,
    (_event, sessionId: string) => manager.releaseSession(sessionId),
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_IOS_SIMULATOR_SCREENSHOT,
    (_event, sessionId: string) => manager.screenshot(sessionId),
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_IOS_SIMULATOR_RECORD_START,
    (_event, sessionId: string) => manager.startRecording(sessionId),
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_IOS_SIMULATOR_RECORD_STOP,
    (_event, sessionId: string) => manager.stopRecording(sessionId),
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_IOS_SIMULATOR_INPUT,
    (_event, sessionId: string, input: IosSimulatorInput) => manager.input(sessionId, input),
  )

  ipcMain.on(
    AgentIpcChannels.ENVIRONMENT_IOS_SIMULATOR_STREAM_OPEN,
    (
      event,
      sessionId: string,
      preferredMode?: IosSimulatorPreviewMode,
      quality?: IosSimulatorPreviewQuality,
    ) => {
      const key = portKey(event.sender.id, sessionId)
      closePort(key)
      const { port1, port2 } = new MessageChannelMain()
      const unsubscribe = manager.subscribe(sessionId, (frame) => {
        try { port2.postMessage(frame) } catch { closePort(key) }
      }, preferredMode, quality)
      openPorts.set(key, { port: port2, unsubscribe })
      port2.on('close', () => closePort(key))
      port2.start()
      event.sender.postMessage(
        AgentIpcChannels.ENVIRONMENT_IOS_SIMULATOR_STREAM_PORT,
        { sessionId },
        [port1],
      )
    },
  )
  ipcMain.on(
    AgentIpcChannels.ENVIRONMENT_IOS_SIMULATOR_STREAM_CLOSE,
    (event, sessionId: string) => closePort(portKey(event.sender.id, sessionId)),
  )
}

export function closeIosSimulatorPorts(): void {
  for (const key of [...openPorts.keys()]) closePort(key)
}
