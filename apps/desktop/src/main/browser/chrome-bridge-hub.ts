import { EXTENSION_BROWSERS } from '@superone/shared/chrome-extension-browsers'
import {
  ChromeBridgeChunkAssembler,
  isChromeBridgeChunk,
  type ChromeBridgeEventMessage,
  type ChromeBridgeEventName,
  type ChromeBridgeEvents,
  type ChromeBridgeMethod,
  type ChromeBridgeMethods,
  type ChromeBridgeRequest,
  type ChromeBridgeResponse,
} from '@superone/shared/chrome-bridge-protocol'

type EventListener = (
  event: ChromeBridgeEventName,
  params: ChromeBridgeEvents[ChromeBridgeEventName],
  browserId: string,
) => void

interface Pending {
  browserId: string
  resolve: (result: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
  cleanup: () => void
}

interface Link {
  send: (json: string) => void
  generation: number
}

const DEFAULT_TIMEOUT_MS = 30_000
const BROWSER_ORDER = EXTENSION_BROWSERS.map((browser) => browser.id)

/**
 * One authenticated native-host connection per browser.
 * A replacement only retires that browser's previous socket. The old socket's
 * close carries the generation from its own attach and does not drop the new
 * link, or any other browser. Messages are JSON strings. Chunk envelopes from
 * the protocol are joined per browser first.
 */
export class ChromeBridgeHub {
  private readonly links = new Map<string, Link>()
  private readonly pending = new Map<number, Pending>()
  private readonly events = new Set<EventListener>()
  private readonly connectionListeners = new Set<(connected: boolean) => void>()
  private readonly assemblers = new Map<string, ChromeBridgeChunkAssembler>()
  private disabledBrowsers = new Set<string>()
  private nextId = 1
  private nextGeneration = 1

  get connected(): boolean {
    return this.browsers().length > 0
  }

  /** Replaces only this browser. Returns the generation the close handler must pass back. */
  attach(send: (json: string) => void, browserId = 'chrome'): number {
    const id = browserId || 'chrome'
    this.failPending('replaced', id)
    const generation = this.nextGeneration++
    this.links.set(id, { send, generation })
    this.assemblers.delete(id)
    this.notifyConnection()
    return generation
  }

  /** Drops every browser. A single socket close must use `detachBrowser`. */
  detach(reason: string, notify = true): void {
    const was = this.connected
    this.links.clear()
    this.assemblers.clear()
    this.failPending(reason)
    if (notify && was) this.notifyConnection()
  }

  /** No-ops when `generation` is not the live link, so a replaced socket cannot win. */
  detachBrowser(browserId: string, reason: string, generation: number): void {
    const link = this.links.get(browserId)
    if (!link || link.generation !== generation) return
    this.links.delete(browserId)
    this.assemblers.delete(browserId)
    this.failPending(reason, browserId)
    this.notifyConnection()
  }

  setDisabledBrowsers(ids: Iterable<string>): void {
    this.disabledBrowsers = new Set(ids)
    this.notifyConnection()
  }

  connectedBrowsers(): string[] {
    return [...this.links.keys()].sort((a, b) => this.browserRank(a) - this.browserRank(b))
  }

  browsers(): string[] {
    return this.connectedBrowsers().filter((id) => !this.disabledBrowsers.has(id))
  }

  onConnection(listener: (connected: boolean) => void): () => void {
    this.connectionListeners.add(listener)
    return () => this.connectionListeners.delete(listener)
  }

  private notifyConnection(): void {
    for (const listener of this.connectionListeners) listener(this.connected)
  }

  private browserRank(id: string): number {
    const index = BROWSER_ORDER.indexOf(id as (typeof BROWSER_ORDER)[number])
    return index >= 0 ? index : BROWSER_ORDER.length
  }

  private failPending(reason: string, browserId?: string): void {
    for (const [id, pending] of this.pending) {
      if (browserId && pending.browserId !== browserId) continue
      clearTimeout(pending.timer)
      pending.cleanup()
      this.pending.delete(id)
      pending.reject(new Error(`Chrome bridge disconnected (${reason})`))
    }
  }

  receive(json: string, browserId?: string): void {
    const browser = browserId ?? (this.links.size === 1 ? [...this.links.keys()][0] : undefined)
    if (!browser) return
    let parsed: unknown
    try {
      parsed = JSON.parse(json) as unknown
    } catch {
      return
    }
    if (isChromeBridgeChunk(parsed)) {
      let assembler = this.assemblers.get(browser)
      if (!assembler) {
        assembler = new ChromeBridgeChunkAssembler()
        this.assemblers.set(browser, assembler)
      }
      const joined = assembler.accept(parsed)
      if (!joined) return
      this.receive(joined, browser)
      return
    }
    const message = parsed as Partial<ChromeBridgeResponse & ChromeBridgeEventMessage>
    if (typeof message.id === 'number') {
      const pending = this.pending.get(message.id)
      if (!pending || pending.browserId !== browser) return
      clearTimeout(pending.timer)
      pending.cleanup()
      this.pending.delete(message.id)
      if (typeof message.error === 'string' && message.error) pending.reject(new Error(message.error))
      else pending.resolve(message.result)
      return
    }
    if (typeof message.event === 'string') {
      const event = message.event as ChromeBridgeEventName
      const params = (message.params ?? {}) as ChromeBridgeEvents[ChromeBridgeEventName]
      for (const listener of this.events) listener(event, params, browser)
    }
  }

  onEvent(listener: EventListener): () => void {
    this.events.add(listener)
    return () => this.events.delete(listener)
  }

  call<M extends ChromeBridgeMethod>(
    method: M,
    params: ChromeBridgeMethods[M]['params'],
    opts?: { timeoutMs?: number; signal?: AbortSignal; browserId?: string },
  ): Promise<ChromeBridgeMethods[M]['result']> {
    const target = this.targetLink(opts?.browserId)
    if ('error' in target) return Promise.reject(new Error(target.error))
    const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const id = this.nextId++
    const request: ChromeBridgeRequest<M> = { id, method, params }
    return new Promise((resolve, reject) => {
      if (opts?.signal?.aborted) {
        reject(new Error('Chrome bridge call was cancelled'))
        return
      }
      const timer = setTimeout(() => {
        this.pending.delete(id)
        cleanup()
        reject(new Error(`Chrome bridge '${method}' timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      const onAbort = () => {
        clearTimeout(timer)
        this.pending.delete(id)
        cleanup()
        reject(new Error('Chrome bridge call was cancelled'))
      }
      const cleanup = () => opts?.signal?.removeEventListener('abort', onAbort)
      this.pending.set(id, {
        browserId: target.browserId,
        resolve: resolve as (result: unknown) => void,
        reject,
        timer,
        cleanup,
      })
      opts?.signal?.addEventListener('abort', onAbort, { once: true })
      target.send(JSON.stringify(request))
    })
  }

  private targetLink(requested?: string): { browserId: string; send: (json: string) => void } | { error: string } {
    if (this.links.size === 0) {
      return { error: 'Chrome bridge is not connected. Open the SuperOne extension in the browser.' }
    }
    if (requested) {
      const link = this.links.get(requested)
      if (!link) return { error: `Browser "${requested}" is not connected. Connected: ${this.browsers().join(', ')}.` }
      if (this.disabledBrowsers.has(requested)) {
        return { error: `Browser "${requested}" control is disabled in Settings.` }
      }
      return { browserId: requested, send: link.send }
    }
    const enabled = this.browsers()
    if (enabled.length === 0) {
      return { error: 'Connected browsers are disabled in Settings.' }
    }
    if (enabled.length === 1) {
      const id = enabled[0]!
      const link = this.links.get(id)
      if (!link) return { error: 'Chrome bridge is not connected. Open the SuperOne extension in the browser.' }
      return { browserId: id, send: link.send }
    }
    return { error: `More than one browser extension is connected (${enabled.join(', ')}). Pass browser.` }
  }
}

export const chromeBridgeHub = new ChromeBridgeHub()
