import log from '../logger'
import type { SessionManager } from '../session/types'

export class DeviceRegistry {
  constructor(private readonly sessionManager: SessionManager) {}

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
    if (releasedCount || unsubscribedCount) {
      log.info('[DeviceRegistry] device=%s offline released=%d unsubscribed=%d', deviceId, releasedCount, unsubscribedCount)
    }
  }

  unsubscribeAll(deviceId: string): void {
    let count = 0
    this.sessionManager.forEachSession((session) => {
      if (session.subscribers.has(deviceId)) {
        session.unsubscribe(deviceId, 'self_leave')
        count++
      }
    })
    if (count) log.info('[DeviceRegistry] device=%s unsubscribe-all count=%d', deviceId, count)
  }

  releaseAll(deviceId: string): void {
    let count = 0
    this.sessionManager.forEachSession((session) => {
      if (session.owner.kind === 'remote' && session.owner.deviceId === deviceId) {
        session.release(deviceId, 'self_leave')
        count++
      }
    })
    if (count) log.info('[DeviceRegistry] device=%s release-all count=%d', deviceId, count)
  }
}
