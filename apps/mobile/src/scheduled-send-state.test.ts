import { describe, expect, it, vi } from 'vitest'
import type { ScheduledSend } from '@superone/shared/agent-types'
import type { RelayClient } from '@superone/relay-client'
import { MobileScheduledSend } from './scheduled-send-state'

const offer: ScheduledSend = { sessionId: 's', sendAt: Date.now() + 3_600_000, armed: false, source: 'rate_limit', message: null }
const methods = ['get', 'set', 'clear'].map(action => `session.scheduledSend.${action}`)
function setup() {
  let row: ScheduledSend | null = offer
  const client = {
    rpc: vi.fn(async (method: string) => method === 'environment.descriptor' ? { capabilities: { methods } } : row),
    controlledRpc: vi.fn(async (_target, method: string, payload) => {
      row = method === 'session.scheduledSend.clear' ? null : { ...row, ...payload.patch }
      return row
    }),
  }
  const delivered = vi.fn()
  const control = new MobileScheduledSend(vi.fn(), delivered)
  return { client, delivered, control, port: client as unknown as RelayClient }
}

describe('mobile host-owned scheduled sends', () => {
  it('keeps sends held when the schedule read fails and can retry the persisted record', async () => {
    const f = setup()
    f.client.rpc.mockResolvedValueOnce({ capabilities: { methods } })
    f.client.rpc.mockRejectedValueOnce(new Error('Read failed'))
    await f.control.connect(f.port, 'desktop', 's')
    expect(f.control.state).toMatchObject({ loading: true, error: 'Read failed' })
    await expect(f.control.write({ armed: true })).rejects.toThrow('unavailable')
    await f.control.connect(f.port, 'desktop', 's', true)
    expect(f.control.state).toMatchObject({ loading: false, error: '', scheduled: offer })
  })
  it('loads an unanswered offer, opts in with a fenced RPC, and cancels without sending a turn', async () => {
    const f = setup()
    await f.control.connect(f.port, 'desktop', 's')
    expect(f.control.state.scheduled).toEqual(offer)
    await f.control.write({ armed: true })
    expect(f.client.controlledRpc).toHaveBeenCalledWith({ environmentId: 'desktop', sessionId: 's' }, 'session.scheduledSend.set', { patch: { armed: true } })
    expect(f.control.state.scheduled?.armed).toBe(true)
    await f.control.write({ armed: false })
    expect(f.control.state.scheduled?.armed).toBe(false)
    await f.control.write(null)
    expect(f.control.state.scheduled).toBeNull()
    expect(f.client.controlledRpc.mock.calls.every(call => call[1] !== 'session.send')).toBe(true)
  })

  it('keeps a host push newer than an in-flight initial read and isolates other hosts', async () => {
    const f = setup()
    let finish!: (row: ScheduledSend | null) => void
    f.client.rpc.mockImplementation(async method => method === 'environment.descriptor'
      ? { capabilities: { methods } } : new Promise(resolve => { finish = resolve }) as any)
    const loading = f.control.connect(f.port, 'desktop', 's')
    await Promise.resolve()
    const armed = { ...offer, armed: true }
    f.control.ingest([{ type: 'scheduled_send_changed', sessionId: 's', environmentId: 'other', scheduled: null, delivered: true }])
    expect(f.delivered).not.toHaveBeenCalled()
    f.control.ingest([{ type: 'scheduled_send_changed', sessionId: 's', environmentId: 'desktop', scheduled: armed, delivered: false }])
    finish(null)
    await loading
    expect(f.control.state.scheduled).toEqual(armed)
  })

  it('ignores responses and delivery notices from a session that has been left', async () => {
    const f = setup()
    let finish!: (row: ScheduledSend | null) => void
    f.client.rpc.mockImplementation(async method => method === 'environment.descriptor'
      ? { capabilities: { methods } } : new Promise(resolve => { finish = resolve }) as any)
    const loading = f.control.connect(f.port, 'desktop', 's')
    await Promise.resolve()
    f.control.disconnect()
    finish(offer)
    await loading
    f.control.ingest([{ type: 'scheduled_send_changed', sessionId: 's', environmentId: 'desktop', scheduled: null, delivered: true }])
    expect(f.control.state.scheduled).toBeNull()
    expect(f.delivered).not.toHaveBeenCalled()
  })

  it('retains an offer on failed acceptance and reports the failure', async () => {
    const f = setup()
    await f.control.connect(f.port, 'desktop', 's')
    f.client.controlledRpc.mockRejectedValueOnce(new Error('Control was lost'))
    await expect(f.control.write({ armed: true })).rejects.toThrow('Control was lost')
    expect(f.control.state).toMatchObject({ scheduled: offer, error: 'Control was lost', busy: false })
  })

  it('disables scheduling on hosts without the methods and reloads persisted state after reconnect', async () => {
    const f = setup()
    f.client.rpc.mockResolvedValueOnce({ capabilities: { methods: [] } })
    await f.control.connect(f.port, 'node', 's')
    expect(f.control.state.supported).toBe(false)
    await expect(f.control.write({ armed: true })).rejects.toThrow('unavailable')
    f.control.disconnect()
    await f.control.connect(f.port, 'desktop', 's')
    expect(f.control.state.scheduled).toEqual(offer)
  })
})
