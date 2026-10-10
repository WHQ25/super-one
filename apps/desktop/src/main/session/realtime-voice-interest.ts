/** Pins the runtime independently of a chat topic or navigation screen. */
export class RealtimeVoiceInterest {
  private readonly interests = new Map<symbol, string | undefined>()
  constructor(private readonly retainControl: (deviceId?: string) => () => void) {}
  active(deviceId?: string): boolean {
    return deviceId === undefined ? this.interests.size > 0 : [...this.interests.values()].includes(deviceId)
  }
  retain(deviceId?: string): () => void {
    const releaseControl = this.retainControl(deviceId)
    const token = Symbol('voice')
    this.interests.set(token, deviceId)
    return () => {
      if (!this.interests.delete(token)) return
      releaseControl()
    }
  }
}
