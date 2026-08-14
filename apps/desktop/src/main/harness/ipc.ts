/**
 * Local desktop harness IPC (Settings → Harnesses).
 * Distinct from environment:harness* which talks to remote nodes.
 */

import { BrowserWindow, ipcMain } from 'electron'
import { AgentIpcChannels } from '@superone/shared/agent-types'
import { isNodeHarnessId } from '@superone/shared/environment'
import {
  alignEnabledManagedHarnesses,
  disableDesktopHarness,
  enableDesktopHarness,
  enabledManagedHarnessesNeedAlign,
  ensureManagedHarnessReady,
  listHarnessInstallations,
  probeDesktopHarness,
  setHarnessInstallProgressListener,
} from './service'
import {
  defaultOnboardingSelection,
  integrationLabels,
  scanAllHarnessClis,
  visibleOnboardingHarnesses,
} from './scan-cli'
import log from '../logger'

function broadcastProgress(event: {
  harnessId: string
  received: number
  total: number
  phase: string
  message?: string
}): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(AgentIpcChannels.HARNESS_INSTALL_PROGRESS, event)
    }
  }
}

export function registerHarnessIpcHandlers(): void {
  setHarnessInstallProgressListener((event) => {
    broadcastProgress(event)
  })

  ipcMain.handle(AgentIpcChannels.HARNESS_LIST, async () => {
    return listHarnessInstallations()
  })

  ipcMain.handle(
    AgentIpcChannels.HARNESS_ENABLE,
    async (
      _e,
      input: {
        harnessId: string
        artifactPath?: string
        command?: string
        serverUrl?: string
        args?: string[]
        forcePin?: boolean
      },
    ) => {
      if (!input || !isNodeHarnessId(input.harnessId)) {
        throw new Error(`unknown harnessId: ${input?.harnessId}`)
      }
      log.info('[harness-ipc] enable %s forcePin=%s', input.harnessId, input.forcePin === true)
      return enableDesktopHarness({
        harnessId: input.harnessId,
        artifactPath: input.artifactPath,
        command: input.command,
        serverUrl: input.serverUrl,
        args: input.args,
        forcePin: input.forcePin === true,
      })
    },
  )

  ipcMain.handle(AgentIpcChannels.HARNESS_DISABLE, async (_e, harnessId: string) => {
    if (!isNodeHarnessId(harnessId)) throw new Error(`unknown harnessId: ${harnessId}`)
    log.info('[harness-ipc] disable %s', harnessId)
    return disableDesktopHarness(harnessId)
  })

  ipcMain.handle(AgentIpcChannels.HARNESS_PROBE, async (_e, harnessId: string) => {
    if (!isNodeHarnessId(harnessId)) throw new Error(`unknown harnessId: ${harnessId}`)
    return probeDesktopHarness(harnessId)
  })

  ipcMain.handle(AgentIpcChannels.HARNESS_ENSURE, async (_e, harnessId: string) => {
    if (harnessId !== 'claude' && harnessId !== 'codex') {
      throw new Error(`ensure is only for managed harnesses (got ${harnessId})`)
    }
    log.info('[harness-ipc] ensure %s', harnessId)
    return ensureManagedHarnessReady(harnessId)
  })

  ipcMain.handle(AgentIpcChannels.HARNESS_SCAN_CLI, async () => {
    const hits = scanAllHarnessClis()
    return {
      hits,
      defaultSelected: defaultOnboardingSelection(hits),
      visibleIds: visibleOnboardingHarnesses(hits),
      integrationLabels: integrationLabels(),
    }
  })

  ipcMain.handle(AgentIpcChannels.HARNESS_ALIGN_ENABLED, async () => {
    log.info('[harness-ipc] alignEnabled managed harnesses')
    return alignEnabledManagedHarnesses()
  })

  ipcMain.handle(AgentIpcChannels.HARNESS_NEEDS_ALIGN, async () => {
    return enabledManagedHarnessesNeedAlign()
  })
}
