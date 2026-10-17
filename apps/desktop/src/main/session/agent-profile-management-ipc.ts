import type { IpcMain } from 'electron'
import { AGENT_PROFILE_CHANNELS } from '@superone/shared/agent-profile-management'
import type { SaveManagedAgentProfile } from '@superone/shared/agent-profile-management'
import type { SessionManagerImpl } from './session-manager'

/** Registered through windowControlIpc: authenticated desktop UI, never generic provider RPC. */
export function registerAgentProfileManagementIpc(ipc: Pick<IpcMain, 'handle'>, host: () => SessionManagerImpl | null): void {
  ipc.handle(AGENT_PROFILE_CHANNELS.list, async () => (await import('./agent-profile-management')).listManagedAgentProfiles())
  ipc.handle(AGENT_PROFILE_CHANNELS.get, async (_event, id: string) => (await import('./agent-profile-management')).getManagedAgentProfile(id))
  ipc.handle(AGENT_PROFILE_CHANNELS.save, async (_event, input: SaveManagedAgentProfile) => (await import('./agent-profile-management')).saveManagedAgentProfile(input))
  ipc.handle(AGENT_PROFILE_CHANNELS.delete, async (_event, input: { id: string; version: string }) => (await import('./agent-profile-management')).deleteManagedAgentProfile(input, host()))
}

export function unregisterAgentProfileManagementIpc(ipc: Pick<IpcMain, 'removeHandler'>): void {
  for (const channel of Object.values(AGENT_PROFILE_CHANNELS)) ipc.removeHandler(channel)
}
