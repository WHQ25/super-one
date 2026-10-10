import type { TerminalEvent, TerminalSnapshot } from '@superone/shared/agent-types'
import type { TerminalRef } from '@superone/shared/environment/refs'
import type { TopicSubscribeInput } from '@superone/shared/environment/events'
import type { RpcStreamHandlers } from '@superone/shared/environment/rpc-connection'
import type { PhoneTopicStream } from './phone-protocol'

export interface PhoneTerminalStream {
  ready: Promise<void>
  refresh(): Promise<void>
  close(): Promise<void>
}

type Attach = { snapshot: string; sequence: string; terminal: TerminalSnapshot }
type Ports = {
  subscribe(input: Omit<TopicSubscribeInput, 'subscriptionId'>, handlers: RpcStreamHandlers): Promise<PhoneTopicStream>
  attach(): Promise<Attach>
}
const MAX_PENDING_CHARS = 512 * 1_024

/** Subscribe before attaching, then apply only output above the snapshot's cut. */
export class PhoneTerminalFeed implements PhoneTerminalStream {
  readonly ready: Promise<void>
  private stream: PhoneTopicStream | null = null
  private stopped = false
  private failure: Error | null = null
  private sequence: number | null = null
  private pending: TerminalEvent[] = []
  private pendingChars = 0
  private resetting: Promise<void> | null = null
  private resetAgain = false

  constructor(
    private readonly resource: TerminalRef,
    private readonly ports: Ports,
    private readonly emit: (event: TerminalEvent) => void,
    private readonly onEnd: (error: Error) => void,
  ) {
    this.ready = this.open()
    void this.ready.catch(error => this.fail(error))
  }

  async refresh(): Promise<void> {
    await this.ready
    if (!this.stopped) await this.resnapshot()
  }

  async close(): Promise<void> {
    this.stopped = true
    this.pending = []
    const stream = this.stream
    this.stream = null
    await stream?.close()
  }

  private async open(): Promise<void> {
    const stream = await this.ports.subscribe({
      afterSequence: '0', topics: [{ kind: 'terminal', ...this.resource }],
    }, {
      onFrame: frame => {
        if (frame.recover?.some(topic => topic.kind === 'terminal' && topic.environmentId === this.resource.environmentId && (topic.terminalId === '*' || topic.terminalId === this.resource.terminalId))) this.requestReset()
      },
      onTerminal: event => this.receive(event),
      onEnd: error => this.fail(error),
    })
    if (this.stopped) { await stream.close(); return }
    this.stream = stream
    await this.resnapshot()
  }

  private receive(event: TerminalEvent): void {
    if (this.stopped || !('terminalId' in event) || event.terminalId !== this.resource.terminalId) return
    if (this.sequence === null || this.resetting) {
      this.pendingChars += event.type === 'terminal_output' ? event.data.length : 1
      if (this.pendingChars > MAX_PENDING_CHARS || this.pending.length >= 1_024) {
        this.pending = []
        this.pendingChars = 0
        this.resetAgain = true
      } else this.pending.push(event)
      return
    }
    if (event.type === 'terminal_output') {
      if (event.toSeq <= this.sequence) return
      if (event.fromSeq !== this.sequence + 1 || !Number.isSafeInteger(event.toSeq) || event.toSeq < event.fromSeq) {
        this.requestReset()
        return
      }
      this.sequence = event.toSeq
    }
    this.emit(event)
  }

  private requestReset(): void {
    if (this.stopped) return
    if (!this.stream || this.resetting) { this.resetAgain = true; return }
    void this.resnapshot().catch(error => this.fail(error))
  }

  private resnapshot(): Promise<void> {
    if (this.resetting) return this.resetting
    this.resetting = Promise.resolve().then(async () => {
      do {
        this.resetAgain = false
        const attached = await this.ports.attach()
        if (this.stopped) return
        const cut = Number(attached.sequence)
        if (!Number.isSafeInteger(cut) || cut < 0 || attached.terminal?.terminalId !== this.resource.terminalId || attached.terminal.lastSeq !== cut || typeof attached.snapshot !== 'string') throw new Error('invalid terminal snapshot')
        this.sequence = cut
        this.emit({ type: 'terminal_snapshot', terminalId: this.resource.terminalId, snapshot: attached.terminal, ansi: attached.snapshot })
      } while (this.resetAgain && !this.stopped)
    }).finally(() => { this.resetting = null })
    return this.resetting.then(() => {
      const pending = this.pending
      this.pending = []
      this.pendingChars = 0
      for (const event of pending) this.receive(event)
    })
  }

  private fail(reason: unknown): void {
    if (this.stopped || this.failure) return
    this.failure = reason instanceof Error ? reason : new Error(String(reason))
    this.onEnd(this.failure)
    void this.close().catch(() => {})
  }
}
