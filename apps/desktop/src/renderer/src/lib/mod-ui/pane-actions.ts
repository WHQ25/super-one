import type { ModPaneTabParams } from '@/components/activity/activity-panel-api'
import { openModPaneTab } from '@/components/activity/activity-panel-api'
import { getModUiClient } from './registry'

/**
 * The person closed a mod pane's dock tab. The CLI decides (a `ui.close` hook
 * may keep it open); a kept pane gets its tab back.
 */
export async function handleModPaneTabClosed(params: ModPaneTabParams | undefined, title: string): Promise<void> {
  if (!params?.sessionId || !params.paneId) return
  const client = getModUiClient(params.projectPath, params.sessionId)
  if (!client) return
  const result = await client.act('close', { id: params.paneId, clientId: client.clientId })
  if (result && !result.closed) openModPaneTab({ ...params, title, activate: true })
}

/**
 * The person brought a mod pane's dock tab to the front: that pane is now the
 * one shown, so the roster (and the toasts it holds) follow the dock.
 */
export function handleModPaneTabActivated(params: ModPaneTabParams | undefined): void {
  if (!params?.sessionId || !params.paneId) return
  const client = getModUiClient(params.projectPath, params.sessionId)
  if (!client || client.panes.shownId === params.paneId) return
  void client.act('paneShow', { id: params.paneId, surface: client.surface, clientId: client.clientId })
}
