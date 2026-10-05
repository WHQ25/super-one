import type { SuperOneComposerOutcome, SuperOneComposerOutput } from './composer-api'

export interface ComposerViewRequest {
  viewId: string
  localId: string
  spec: unknown
  output: SuperOneComposerOutput
}

export interface ComposerViewPorts {
  open(request: ComposerViewRequest): Promise<SuperOneComposerOutcome>
  release(viewId: string): void | Promise<void>
}

/** One guest document's calls. Source/session identity comes from the embedding host. */
export class ComposerViewBridge {
  private viewId = this.newId()
  private generation = 0
  private active = new Map<string, (data: Record<string, unknown>) => void>()
  private disposed = false

  constructor(private readonly ports: ComposerViewPorts) {}

  handle(type: string, data: Record<string, unknown>, reply: (data: Record<string, unknown>) => void): boolean {
    if (type === 'composer-dispose') {
      // An old document's pagehide can arrive after navigation starts. Only its
      // outstanding call ids may release this holder, never the next document.
      if (!Array.isArray(data.ids) || data.ids.some(id => typeof id === 'string' && this.active.has(id))) this.dispose()
      return true
    }
    if (type !== 'composer-open') return false
    if (typeof data.id !== 'string' || !data.id || data.id.length > 128) return true
    const id = data.id
    if (this.active.has(id)) return true
    if (this.disposed || this.active.size >= 32) {
      reply({ type: 'composer-result', id, error: this.disposed ? 'This view is closed' : 'Too many pending input requests' })
      return true
    }
    const output = data.output ?? 'caller'
    if (output !== 'caller' && output !== 'agent') {
      reply({ type: 'composer-result', id, error: 'Invalid composer output' }); return true
    }
    const generation = this.generation
    const viewId = this.viewId
    this.active.set(id, reply)
    void (async () => {
      try {
        const outcome = await this.ports.open({ viewId, localId: id, spec: data.spec, output })
        if (generation === this.generation && !this.disposed) reply({ type: 'composer-result', id, outcome })
      } catch (error) {
        if (generation === this.generation && !this.disposed) reply({ type: 'composer-result', id, error: error instanceof Error ? error.message : String(error) })
      } finally {
        if (generation === this.generation) this.active.delete(id)
      }
    })()
    return true
  }

  /** Reload/navigation creates a new holder; late results cannot reach the next document. */
  reset(): void {
    this.dispose()
    this.viewId = this.newId()
    this.disposed = false
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.generation++
    if (this.active.size) {
      try { void Promise.resolve(this.ports.release(this.viewId)).catch(() => {}) } catch { /* host gone */ }
      for (const [id, reply] of this.active) {
        try { reply({ type: 'composer-result', id, outcome: { status: 'cancelled', reason: 'owner_disposed' } }) } catch { /* guest gone */ }
      }
    }
    this.active.clear()
  }

  private newId(): string {
    return typeof globalThis.crypto?.randomUUID === 'function' ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  }
}
