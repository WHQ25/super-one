/** Flutter-semantic envelope ACK. Envelope seq never lands on AgentEvent.seq. */

export const PROCESSED_SEQ_CAP = 2048

export class SeqAckTracker {
  lastAckedSeq = 0
  unackedCount = 0
  readonly processed = new Set<number>()

  /** Add seq before decrypt. False = duplicate / already contiguous. */
  see(seq: number): boolean {
    if (!Number.isSafeInteger(seq) || seq <= 0) return false
    if (seq <= this.lastAckedSeq || this.processed.has(seq)) return false
    this.processed.add(seq)
    this.trim()
    return this.processed.has(seq)
  }

  /** Advance contiguous ACK watermark. Call even when decrypt failed. */
  markProcessed(seq: number): { lastAckedSeq: number; advanced: number; shouldAckNow: boolean } {
    if (seq <= this.lastAckedSeq) {
      return { lastAckedSeq: this.lastAckedSeq, advanced: 0, shouldAckNow: false }
    }
    this.processed.add(seq)
    let advanced = 0
    while (this.processed.delete(this.lastAckedSeq + 1)) {
      this.lastAckedSeq++
      advanced++
    }
    if (advanced === 0) return { lastAckedSeq: this.lastAckedSeq, advanced: 0, shouldAckNow: false }
    this.unackedCount += advanced
    const shouldAckNow = this.unackedCount >= 10
    return { lastAckedSeq: this.lastAckedSeq, advanced, shouldAckNow }
  }

  trim(): void {
    if (this.processed.size <= PROCESSED_SEQ_CAP) return
    for (const s of this.processed) {
      if (s <= this.lastAckedSeq) this.processed.delete(s)
    }
    if (this.processed.size <= PROCESSED_SEQ_CAP) return
    const farthest = [...this.processed].sort((a, b) => b - a)
    for (const seq of farthest) {
      if (this.processed.size <= PROCESSED_SEQ_CAP) break
      this.processed.delete(seq)
    }
  }

  acknowledgeSent(): void {
    this.unackedCount = 0
  }

  clear(): void {
    this.lastAckedSeq = 0
    this.unackedCount = 0
    this.processed.clear()
  }
}

/** One tracker per transport. Never ACK a relay seq on the LAN socket. */
export class TransportAckRegistry {
  private readonly trackers = new Map<string, SeqAckTracker>()

  forTransport(id: string): SeqAckTracker {
    let t = this.trackers.get(id)
    if (!t) {
      t = new SeqAckTracker()
      this.trackers.set(id, t)
    }
    return t
  }

  clear(id: string): void {
    this.trackers.get(id)?.clear()
  }

  clearAll(): void {
    for (const t of this.trackers.values()) t.clear()
  }
}
