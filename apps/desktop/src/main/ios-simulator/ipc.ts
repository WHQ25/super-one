/**
 * The four channels only the simulator has.
 *
 * Everything a panel does to ANY device — bind, boot, stream, touch, capture — moved
 * to `device/ipc.ts` when the renderer was generalized. What is left here is not a
 * remainder but a category: a list of installable iOS runtimes, Apple's shipped
 * DeviceKit artwork, creating a simulator, and probing the local Xcode. Android has
 * no equivalent of any of them, and an empty Android implementation would only be a
 * lie the UI then has to check for.
 */

import { ipcMain } from 'electron'
import { AgentIpcChannels } from '@superone/shared/agent-types'
import type { IosSimulatorCreateRequest } from '@superone/shared/ios-simulator'
import { getIosSimulatorManager } from './index'

export function registerIosSimulatorIpc(userDataPath: string): void {
  const manager = getIosSimulatorManager(userDataPath)

  ipcMain.handle(AgentIpcChannels.ENVIRONMENT_IOS_SIMULATOR_STATUS, (_event, force?: boolean) =>
    manager.status(force === true))
  ipcMain.handle(AgentIpcChannels.ENVIRONMENT_IOS_SIMULATOR_RUNTIMES, () => manager.listRuntimes())
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_IOS_SIMULATOR_CHROME,
    (_event, udid: string) => manager.chrome(udid),
  )
  ipcMain.handle(
    AgentIpcChannels.ENVIRONMENT_IOS_SIMULATOR_CREATE,
    (_event, request: IosSimulatorCreateRequest) => manager.createDevice(request),
  )
}
