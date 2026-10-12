import type { AgentEvent, ScheduledSend, ScheduledSendPatch } from '@superone/shared/agent-types'
import type { RelayClient } from '@superone/relay-client'
import type { SessionRef } from '@superone/shared/environment/refs'

export type ScheduledSendState = {
  key: string
  scheduled: ScheduledSend | null
  supported: boolean
  loading: boolean
  busy: boolean
  error: string
}
const empty = (key = ''): ScheduledSendState => ({ key, scheduled: null, supported: false, loading: false, busy: false, error: '' })
export const scheduledSessionKey = (environmentId: string, sessionId: string | null) => JSON.stringify([environmentId, sessionId])
type Client = Pick<RelayClient, 'rpc' | 'controlledRpc'>

/** Reads on session/reconnect, then consumes host pushes. Late reads never undo a push. */
export class MobileScheduledSend {
  state = empty()
  private generation = 0
  private revision = 0
  private client: Client | null = null
  private target: SessionRef | null = null
  private ready: Promise<void> = Promise.resolve()
  constructor(private readonly changed: (state: ScheduledSendState) => void, private readonly delivered: (previous: ScheduledSend | null, next: ScheduledSend | null) => void) {}

  private update(patch: Partial<ScheduledSendState>) {
    this.state = { ...this.state, ...patch }
    this.changed(this.state)
  }

  connect(client: Client, environmentId: string, sessionId: string | null, refresh = false): Promise<void> {
    const key = scheduledSessionKey(environmentId, sessionId)
    if (!refresh && this.client === client && this.state.key === key) return this.ready
    this.client = client
    this.target = sessionId ? { environmentId, sessionId } : null
    const generation = ++this.generation
    const revision = ++this.revision
    this.state = { ...empty(key), loading: true }
    this.changed(this.state)
    return this.ready = (async () => {
      try {
        const descriptor = await client.rpc<{ capabilities: { methods: string[] } }>('environment.descriptor', {}, { environmentId })
        if (generation !== this.generation) return
        const supported = ['get', 'set', 'clear'].every(action => descriptor.capabilities.methods.includes(`session.scheduledSend.${action}`))
        this.update({ supported })
        if (supported && sessionId) {
          const scheduled = await client.rpc<ScheduledSend | null>('session.scheduledSend.get', { sessionId }, { environmentId })
          if (generation !== this.generation) return
          if (revision === this.revision) this.update({ scheduled })
        }
        this.update({ loading: false })
      } catch (error) {
        // Unknown is not an empty schedule: hold immediate sends until a successful read.
        if (generation === this.generation) this.update({ error: error instanceof Error ? error.message : String(error) })
      }
    })()
  }

  disconnect() {
    this.generation++
    this.client = null
    this.target = null
    this.state = empty()
    this.changed(this.state)
  }

  ingest(events: unknown[]) {
    for (const event of events as AgentEvent[]) {
      if (event.type !== 'scheduled_send_changed' || event.sessionId !== this.target?.sessionId
        || event.environmentId !== this.target.environmentId) continue
      this.revision++
      const previous = this.state.scheduled
      this.update({ scheduled: event.scheduled, error: '' })
      if (event.delivered) this.delivered(previous, event.scheduled)
    }
  }

  async write(patch: ScheduledSendPatch | null): Promise<void> {
    const client = this.client
    const target = this.target
    const generation = this.generation
    await this.ready
    if (generation !== this.generation) throw new Error('The conversation changed before the schedule was updated')
    if (!client || !target || !this.state.supported || this.state.loading) throw new Error('Scheduled sending is unavailable on this host')
    if (this.state.busy) throw new Error('A scheduled send is still being updated')
    const revision = this.revision
    this.update({ busy: true, error: '' })
    try {
      const scheduled = patch
        ? await client.controlledRpc<ScheduledSend | null>(target, 'session.scheduledSend.set', { patch })
        : await client.controlledRpc<null>(target, 'session.scheduledSend.clear', {})
      if (generation !== this.generation) return
      if (revision === this.revision) this.update({ scheduled })
      if (patch?.armed && !this.state.scheduled?.armed) throw new Error('The scheduled send was not accepted. Choose a future time and try again.')
    } catch (error) {
      if (generation === this.generation) this.update({ error: error instanceof Error ? error.message : String(error) })
      throw error
    } finally {
      if (generation === this.generation) this.update({ busy: false })
    }
  }
}
