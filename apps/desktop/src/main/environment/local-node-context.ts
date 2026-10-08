import { app, powerMonitor } from 'electron'
import type { EnvironmentGuiState, EnvironmentLiveStatus, EnvironmentMachine } from '@superone/shared/environment'
import type { HarnessId } from '@superone/shared/session-types'
import { getMachineInfo, readLiveStatus } from '@superone/runtime/machine'
import { loadNodeAgentSettings } from '@superone/runtime/settings'
import { ensureShellPath } from '../shell-path'
import { desktopNodeHostPaths } from '../node-host/paths'

/** The slice of a live desktop session that the activity counts read. */
export interface LocalSessionActivity {
  readonly ephemeral?: boolean
  isStreaming(): boolean
  getPendingInteractions(): unknown[]
}

export interface LocalSessionSource {
  forEachSession(fn: (session: LocalSessionActivity) => void): void
}

/** GUI tools need an unlocked screen; this desktop is otherwise always able to run them. */
export function readDesktopGuiState(): EnvironmentGuiState {
  return powerMonitor.getSystemIdleState(60) === 'locked' ? 'locked' : 'available'
}

/** What `environment_list` reports for this desktop, computed in-process. */
export async function readLocalNodeContext(sessions: LocalSessionSource | null): Promise<{
  machine: EnvironmentMachine
  note: string
  harnessIds: HarnessId[]
  live: EnvironmentLiveStatus
}> {
  // Toolchain probes need the login-shell PATH, not Finder's.
  await ensureShellPath()
  const { getHarnessManager } = await import('../harness/service')
  const activity: Array<{ running: boolean; pending: boolean }> = []
  sessions?.forEachSession((session) => {
    // Side chats are panel-local helpers, not work running on this machine.
    if (session.ephemeral) return
    activity.push({ running: session.isStreaming(), pending: session.getPendingInteractions().length > 0 })
  })
  return {
    machine: await getMachineInfo(),
    note: loadNodeAgentSettings(desktopNodeHostPaths(app.getPath('userData')).configJson).note,
    harnessIds: getHarnessManager().readySessionHarnessIds(),
    live: readLiveStatus({ sessions: sessions ? activity : null, gui: readDesktopGuiState() }),
  }
}
