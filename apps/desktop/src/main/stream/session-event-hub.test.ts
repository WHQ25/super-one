import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'

vi.mock('../logger', () => ({ default: { warn: vi.fn() } }))

import { SessionEventHub, type HubEvent } from './session-event-hub'

const idle: AgentEvent = { type: 'status_change', status: 'idle' }

describe('SessionEventHub', () => {
  it('delivers an event only to consumers of its source', () => {
    const hub = new SessionEventHub()
    const renderer: HubEvent[] = []
    const phones: HubEvent[] = []
    hub.subscribe({ name: 'renderer', sources: ['session', 'presence'], replay: true, deliver: (e) => { renderer.push(e) } })
    hub.subscribe({ name: 'phones', sources: ['session', 'list'], replay: true, deliver: (e) => { phones.push(e) } })

    hub.publish({ event: idle, source: 'presence' })
    hub.publish({ event: { type: 'project_list_changed' } as AgentEvent, source: 'list' })

    expect(renderer.map((e) => e.source)).toEqual(['presence'])
    expect(phones.map((e) => e.source)).toEqual(['list'])
  })

  it('keeps replay events from consumers that act on live events only', () => {
    const hub = new SessionEventHub()
    const live: HubEvent[] = []
    hub.subscribe({ name: 'scheduled-send', sources: ['session'], replay: false, deliver: (e) => { live.push(e) } })

    hub.publish({ event: idle, source: 'session', sessionId: 's', replay: true })
    hub.publish({ event: idle, source: 'session', sessionId: 's' })

    expect(live).toHaveLength(1)
  })

  it('isolates a failing consumer from the rest', () => {
    const hub = new SessionEventHub()
    const after = vi.fn()
    hub.subscribe({ name: 'broken', sources: ['session'], replay: true, deliver: () => { throw new Error('boom') } })
    hub.subscribe({ name: 'after', sources: ['session'], replay: true, deliver: after })

    hub.publish({ event: idle, source: 'session', sessionId: 's' })

    expect(after).toHaveBeenCalledTimes(1)
  })
})
