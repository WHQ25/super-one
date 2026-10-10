import type { SessionLeaveReason, SessionOwner } from './types'

type Interest = { chat: boolean; releaseRequested: boolean }
/** Keeps call interest independent of the navigation subscriber's lifetime. */
export class RealtimeVoiceInterest {
  private interests = new Map<string, Interest>()
  private local: symbol | null = null
  active(): boolean { return !!this.local || this.interests.size > 0 }
  constructor(private readonly ports: {
    owner(): SessionOwner; subscribers(): ReadonlySet<string>
    claim(deviceId: string): void; subscribe(deviceId: string): void
    release(deviceId: string): void; unsubscribe(deviceId: string): void
  }) {}
  retain(deviceId?: string): () => void {
    if (!deviceId) {
      if (this.ports.owner().kind === 'remote' || this.ports.subscribers().size) throw new Error('This session is controlled by a phone.')
      const local = Symbol('voice')
      this.local = local
      return () => { if (this.local === local) this.local = null }
    }
    if (this.interests.has(deviceId)) throw new Error('Voice interest already retained.')
    const interest = { chat: this.ports.subscribers().has(deviceId), releaseRequested: false }
    this.ports.claim(deviceId)
    this.ports.subscribe(deviceId)
    this.interests.set(deviceId, interest)
    return () => {
      if (this.interests.get(deviceId) !== interest) return
      this.interests.delete(deviceId)
      if (!interest.chat) this.ports.unsubscribe(deviceId)
      if (interest.releaseRequested || !interest.chat) this.ports.release(deviceId)
    }
  }
  subscribed(deviceId: string): void {
    const interest = this.interests.get(deviceId)
    if (interest) { interest.chat = true; interest.releaseRequested = false }
  }
  releaseAllowed(deviceId: string, reason?: SessionLeaveReason): boolean {
    const interest = this.interests.get(deviceId)
    if (!interest) return true
    interest.releaseRequested = true
    return reason !== undefined && reason !== 'self_leave' && reason !== 'self_switch'
  }
  unsubscribeAllowed(deviceId: string, reason?: SessionLeaveReason): boolean {
    const interest = this.interests.get(deviceId)
    if (!interest) return true
    interest.chat = false
    return reason !== undefined && reason !== 'self_leave' && reason !== 'self_switch'
  }
}
