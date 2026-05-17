import log from '../logger'
import type { SessionLeaveReason, SessionManager } from '../session/types'

export class DeviceRegistry {
  private terminalManager?: import('../terminal/terminal-manager').TerminalManager

  constructor(private readonly sessionManager: SessionManager) {}

  setTerminalManager(mgr: import('../terminal/terminal-manager').TerminalManager): void {
    this.terminalManager = mgr
  }

  handleDeviceDisconnected(deviceId: string): void {
    let releasedCount = 0
    let unsubscribedCount = 0
    this.sessionManager.forEachSession((session) => {
      if (session.owner.kind === 'remote' && session.owner.deviceId === deviceId) {
        session.release(deviceId, 'transport_disconnect')
        releasedCount++
      }
      if (session.subscribers.has(deviceId)) {
        session.unsubscribe(deviceId, 'transport_disconnect')
        unsubscribedCount++
      }
    })
    for (const item of this.terminalManager?.list() ?? []) {
      this.terminalManager?.get(item.terminalId)?.ownership.handleDeviceDisconnected(deviceId)
    }
    if (releasedCount || unsubscribedCount) {
      log.info('[DeviceRegistry] device=%s offline released=%d unsubscribed=%d', deviceId, releasedCount, unsubscribedCount)
    }
  }

  unsubscribeAll(deviceId: string, reason: SessionLeaveReason = 'self_leave'): void {
    let count = 0
    this.sessionManager.forEachSession((session) => {
      if (session.subscribers.has(deviceId)) {
        session.unsubscribe(deviceId, reason)
        count++
      }
    })
    if (count) log.info('[DeviceRegistry] device=%s unsubscribe-all reason=%s count=%d', deviceId, reason, count)
  }

  releaseAll(deviceId: string, reason: SessionLeaveReason = 'self_leave'): void {
    let count = 0
    this.sessionManager.forEachSession((session) => {
      if (session.owner.kind === 'remote' && session.owner.deviceId === deviceId) {
        session.release(deviceId, reason)
        count++
      }
    })
    if (count) log.info('[DeviceRegistry] device=%s release-all reason=%s count=%d', deviceId, reason, count)
  }
}
