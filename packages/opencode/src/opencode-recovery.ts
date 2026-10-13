import type { OpenCodeV2Client } from './opencode-v2-client'
import type { OpenCodeV2Event } from './opencode-v2-types'

/** Resume facts, never operations. One cursor belongs to one native session. */
export class OpenCodeRecovery {
  private cursor = 0
  private recovery: Promise<void> | undefined
  private worker: Promise<void> | undefined
  private failure: Error | undefined
  private readonly replayedAssistants = new Set<string>()

  constructor(private readonly client: Pick<OpenCodeV2Client, 'eventStream' | 'sessionLog'>,
    private readonly sessionID: string, private readonly signal: AbortSignal,
    private readonly onEvent: (event: OpenCodeV2Event, replay?: boolean) => void,
    private readonly reconcile: (missingReplay?: boolean) => Promise<string[] | void>,
    private readonly onState: (state: 'connected' | 'recovering' | 'disconnected', attempt: number) => void,
    private readonly delayMs = 250) {}

  async initialize() {
    // Reading beyond the head gives its watermark without replaying old history.
    this.cursor = (await this.client.sessionLog(this.sessionID, Number.MAX_SAFE_INTEGER, this.signal)).cursor
    this.onState('connected', 0)
  }

  ready() { return this.recovery ?? (this.failure ? Promise.reject(this.failure) : Promise.resolve()) }
  join() { return this.worker?.catch(() => {}) ?? Promise.resolve() }
  finishTurn() { this.replayedAssistants.clear() }

  retry(): Promise<void> {
    this.signal.throwIfAborted()
    if (!this.failure) return this.ready()
    const resumed = this.reconnectStream()
    this.worker = resumed.then((stream) => this.loop(stream))
    void this.worker.catch(() => {})
    return resumed.then(() => {})
  }

  private accept(event: OpenCodeV2Event, replay = false) {
    if (event.durable?.aggregateID === this.sessionID) {
      if (event.durable.seq <= this.cursor) return
      this.onEvent(event, replay)
      this.cursor = event.durable.seq
    } else {
      const id = (event.data as { assistantMessageID?: string }).assistantMessageID
      // Buffered ephemeral fragments may already be represented by durable
      // replay. Full ended values reconcile these blocks; new steps stream.
      if (id && this.replayedAssistants.has(id) && ['session.text.delta', 'session.reasoning.delta', 'session.tool.input.delta'].includes(event.type)) return
      this.onEvent(event, replay)
    }
    if (replay) {
      const data = event.data as { assistantMessageID?: string; messageID?: string }
      const id = data.assistantMessageID ?? data.messageID
      if (id) this.replayedAssistants.add(id)
    }
  }

  private wait(ms: number) {
    this.signal.throwIfAborted()
    return new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(this.signal.reason) }
      const timer = setTimeout(() => { this.signal.removeEventListener('abort', abort); resolve() }, ms)
      this.signal.addEventListener('abort', abort, { once: true })
    })
  }

  run(initial: AsyncIterable<OpenCodeV2Event>): Promise<void> {
    this.worker = this.loop(initial)
    return this.worker
  }

  private async loop(initial: AsyncIterable<OpenCodeV2Event>): Promise<void> {
    let stream = initial
    for (;;) {
      try {
        for await (const event of stream) this.accept(event)
        if (this.signal.aborted) return
      } catch (error) {
        if (this.signal.aborted) return
      }
      stream = await this.reconnectStream()
      if (this.signal.aborted) return
    }
  }

  private reconnectStream(): Promise<AsyncIterable<OpenCodeV2Event>> {
    this.failure = undefined
    const task = (async () => {
        for (let attempt = 1; attempt <= 5; attempt++) {
          this.onState('recovering', attempt)
          await this.wait(Math.min(this.delayMs * 2 ** (attempt - 1), 4000))
          const connection = new AbortController()
          try {
            // Warm the live subscriber first; the SDK buffers overlap while
            // the finite durable replay catches up to its captured watermark.
            const stream = await this.client.eventStream(AbortSignal.any([this.signal, connection.signal]))
            const replay = await this.client.sessionLog(this.sessionID, this.cursor, this.signal)
            this.signal.throwIfAborted()
            let expected = this.cursor + 1
            const missing = replay.events.some((event) => event.durable?.seq !== expected++) || expected - 1 < replay.cursor
            // A partial log can contain a terminal fact before its missing
            // content. Restore the authoritative projection before settling.
            if (!missing) for (const event of replay.events) this.accept(event, true)
            const restored = await this.reconcile(missing)
            for (const id of restored ?? []) this.replayedAssistants.add(id)
            this.cursor = Math.max(this.cursor, replay.cursor)
            this.onState('connected', attempt)
            return stream
          } catch (error) {
            connection.abort()
            if (this.signal.aborted) throw this.signal.reason
            if (attempt === 5) {
              this.failure = new Error('OpenCode connection recovery failed; the input was not resent', { cause: error })
              this.onState('disconnected', attempt)
              throw this.failure
            }
          }
        }
        throw new Error('OpenCode recovery ended without a connection')
    })()
    const gate = task.then(() => {})
    this.recovery = gate
    const clear = () => { if (this.recovery === gate) this.recovery = undefined }
    void gate.then(clear, clear)
    return task
  }
}
