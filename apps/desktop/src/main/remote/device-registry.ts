import { mobileModClientId } from '@superone/shared/mod-ui'
import log from '../logger'
import { releaseComposerClient } from '../session/composer-delivery'
import type { SessionManager } from '../session/types'

export class DeviceRegistry {
  private draftControl?: import('@superone/runtime/drafts').DraftControl
  private terminalManager?: import('../terminal/terminal-manager').TerminalManager

  constructor(private readonly sessionManager: SessionManager) {}

  setDraftControl(drafts: import('@superone/runtime/drafts').DraftControl): void {
    this.draftControl = drafts
  }

  setTerminalManager(mgr: import('../terminal/terminal-manager').TerminalManager): void {
    this.terminalManager = mgr
  }

  handleDeviceDisconnected(deviceId: string): void {
    this.draftControl?.releaseDevice(`phone:${deviceId}`)
    releaseComposerClient({ kind: 'device', id: deviceId })
    let releasedCount = 0
    this.sessionManager.forEachSession((session) => {
      if (session.lease.releaseDelegate(`phone:${deviceId}`)) releasedCount++
      // A killed app never detaches its mod client; the plugin would keep routing requests to it.
      session.detachModClient(mobileModClientId(deviceId))
    })
    for (const item of this.terminalManager?.list() ?? []) {
      this.terminalManager?.get(item.terminalId)?.lease.handleDeviceDisconnected(deviceId)
    }
    if (releasedCount) log.info('[DeviceRegistry] device=%s offline released=%d', deviceId, releasedCount)
  }
}
