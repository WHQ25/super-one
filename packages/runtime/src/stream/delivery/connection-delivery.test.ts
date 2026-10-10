import { describe, expect, it } from 'vitest'
import type { AgentEvent, ChatMessage } from '@superone/shared/agent-types'
import { deliveryPolicy } from '../delivery-policy'
import { ConnectionDelivery, batchingFor } from './connection-delivery'

const message = (thinking: string): ChatMessage => ({ id: 'm', role: 'assistant', status: 'streaming', createdAt: '', providerId: 'claude', content: [
  { type: 'thinking', thinking },
] })
const thinkingDelta = (text: string): AgentEvent => ({ type: 'content_delta', sessionId: 's', messageId: 'm', delta: { type: 'thinking', thinking: text } })
const progress = (): AgentEvent => ({ type: 'tool_progress', sessionId: 's', toolUseId: 't', toolName: 'Bash', elapsedSeconds: 1 } as AgentEvent)

describe('ConnectionDelivery', () => {
  it('summarizes a session only for the connection that opened it so, with its own detail state', () => {
    const desktopA = new ConnectionDelivery(deliveryPolicy('lan', 'desktop'))
    const phoneC = new ConnectionDelivery(deliveryPolicy('relay', 'phone'))
    phoneC.views.open('s')

    const first = message('plan')
    expect(desktopA.live(thinkingDelta('plan'), 's', [first])).toEqual([thinkingDelta('plan')])
    const [summary] = phoneC.live(thinkingDelta('plan'), 's', [first])
    expect(summary).toMatchObject({ remoteView: 'summary', delta: { thinking: '', remoteDetail: '["m","thinking",0]' } })

    expect(phoneC.views.subscribe('s', 'sub', '["m","thinking",0]', first)).toMatchObject({ text: 'plan', revision: 0 })
    expect(() => desktopA.views.subscribe('s', 'sub', '["m","thinking",0]', first)).toThrow('expired')

    const second = message('plan more')
    expect(desktopA.live(thinkingDelta(' more'), 's', [second])).toEqual([thinkingDelta(' more')])
    expect(phoneC.live(thinkingDelta(' more'), 's', [second]).filter((event) => event.type === 'remote_detail'))
      .toEqual([{ type: 'remote_detail', sessionId: 's', subscriptionId: 'sub', revision: 1, offset: 4, text: ' more' }])
  })

  it('throttles progress and drops desktop-only events by tier and surface', () => {
    let now = 0
    const relayPhone = new ConnectionDelivery(deliveryPolicy('relay', 'phone'), { now: () => now })
    const lanDesktop = new ConnectionDelivery(deliveryPolicy('lan', 'desktop'), { now: () => now })
    const hook: AgentEvent = { type: 'hook_started', sessionId: 's' } as AgentEvent
    for (const delivery of [relayPhone, lanDesktop]) {
      delivery.shape(progress())
      now += 500
    }
    expect(relayPhone.shape(progress())).toEqual([])
    expect(lanDesktop.shape(progress())).toHaveLength(1)
    expect(relayPhone.shape(hook)).toEqual([])
    expect(lanDesktop.shape(hook)).toEqual([hook])
  })

  it('switches tier on failover without losing what it opened', () => {
    let now = 10_000
    const desktop = new ConnectionDelivery(deliveryPolicy('lan', 'desktop'), { now: () => now })
    desktop.views.open('s')
    expect(desktop.shape(progress())).toHaveLength(1)
    expect(desktop.shape(progress())).toHaveLength(1)
    desktop.setPolicy(deliveryPolicy('relay', 'desktop'))
    expect(desktop.shape(progress())).toHaveLength(1)
    now += 100
    expect(desktop.shape(progress())).toEqual([])
    expect(desktop.views.has('s')).toBe(true)
  })

  it('pages transcripts under the same policy as live events', () => {
    const phone = new ConnectionDelivery(deliveryPolicy('relay', 'phone'))
    const desktop = new ConnectionDelivery(deliveryPolicy('local', 'desktop'))
    phone.views.open('s')
    expect(JSON.stringify(phone.messages([message('secret')], 's'))).not.toContain('secret')
    expect(desktop.messages([message('secret')], 's')).toEqual([message('secret')])
  })

  it('batches off the local link within one relay frame', () => {
    expect(batchingFor(deliveryPolicy('ipc', 'desktop'))).toEqual({})
    expect(batchingFor(deliveryPolicy('relay', 'phone'))).toEqual({ maxBytes: 64 * 1024, maxEvents: 128 })
  })
})
