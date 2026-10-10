export type TerminalWriter = { kind: 'local' } | { kind: 'remote'; deviceId: string }

export const LOCAL_WRITER: TerminalWriter = { kind: 'local' }

export type TerminalClaimResult = { ok: true } | { ok: false; code: 'already_claimed' }

type ChangeListener = (owner: TerminalWriter) => void
/** The devices that receive this terminal: its subscribers and a remote owner. */
type InterestListener = (deviceIds: ReadonlySet<string>) => void

export class TerminalOwnership {
  private _owner: TerminalWriter = LOCAL_WRITER
  private readonly _subscribers = new Set<string>()
  private readonly listeners = new Set<ChangeListener>()
  private readonly interestListeners = new Set<InterestListener>()

  get owner(): TerminalWriter {
    return this._owner
  }

  get ownerDeviceId(): string | null {
    return this._owner.kind === 'remote' ? this._owner.deviceId : null
  }

  get subscribers(): ReadonlySet<string> {
    return this._subscribers
  }

  get subscriberCount(): number {
    return this._subscribers.size
  }

  isWritableBy(who: 'local' | string): boolean {
    if (who === 'local') return this._owner.kind === 'local'
    return this._owner.kind === 'remote' && this._owner.deviceId === who
  }

  claim(deviceId: string): TerminalClaimResult {
    if (this._owner.kind === 'remote') {
      if (this._owner.deviceId === deviceId) return { ok: true }
      return { ok: false, code: 'already_claimed' }
    }
    this.setOwner({ kind: 'remote', deviceId })
    return { ok: true }
  }

  release(deviceId: string): void {
    if (this._owner.kind === 'remote' && this._owner.deviceId === deviceId) {
      this.setOwner(LOCAL_WRITER)
    }
  }

  reclaimLocal(): void {
    this.setOwner(LOCAL_WRITER)
  }

  subscribe(deviceId: string): void {
    this._subscribers.add(deviceId)
    this.emitInterest()
  }

  unsubscribe(deviceId: string): void {
    this._subscribers.delete(deviceId)
    this.emitInterest()
  }

  handleDeviceDisconnected(deviceId: string): void {
    this._subscribers.delete(deviceId)
    this.release(deviceId)
    this.emitInterest()
  }

  onChange(listener: ChangeListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Devices that receive this terminal; called whenever the set may have changed. */
  interestedDevices(): ReadonlySet<string> {
    const devices = new Set(this._subscribers)
    if (this._owner.kind === 'remote') devices.add(this._owner.deviceId)
    return devices
  }

  onInterest(listener: InterestListener): () => void {
    this.interestListeners.add(listener)
    return () => this.interestListeners.delete(listener)
  }

  private emitInterest(): void {
    const devices = this.interestedDevices()
    for (const listener of this.interestListeners) listener(devices)
  }

  private setOwner(next: TerminalWriter): void {
    if (next.kind === this._owner.kind && next.kind === 'local') return
    if (
      next.kind === 'remote' &&
      this._owner.kind === 'remote' &&
      next.deviceId === this._owner.deviceId
    )
      return
    this._owner = next
    // Interest first: the owner change itself goes to the new owner's topics.
    this.emitInterest()
    for (const listener of this.listeners) listener(next)
  }
}
