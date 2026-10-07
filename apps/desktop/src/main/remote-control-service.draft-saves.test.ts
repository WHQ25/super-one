import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'

vi.mock('./remote-highlighter', () => ({
  initHighlighter: vi.fn(),
  highlightCodeSync: vi.fn(() => null),
  highlightCodeByLang: vi.fn(() => null),
  parseAnsiTokens: vi.fn(() => []),
}))
vi.mock('./logger', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }))
vi.mock('./agent/event-trace', () => ({ trace: vi.fn() }))

import { RemoteControlService } from './remote-control-service'
import { RELAY_DRAFT_SAVE_INTERVAL_MS } from './remote/relay-draft-save-throttle'

describe('RemoteControlService draft saves', () => {
  afterEach(() => { vi.useRealTimers() })

  it('routes typing saves by each phone transport', async () => {
    vi.useFakeTimers()
    const sent: Array<{ text?: string; targets?: string[] }> = []
    const service = new RemoteControlService('wss://relay.example', { onCommand: vi.fn() })
    const internals = service as unknown as {
      keys: unknown
      hasAnyMobileTransport: () => boolean
      queueSend: (events: AgentEvent[], targets?: string[]) => void
      markDeviceOnline: (name: string, id: string, via: 'lan' | 'relay') => void
    }
    internals.keys = { aesKey: {} }
    internals.hasAnyMobileTransport = () => true
    internals.queueSend = (events, targets) => {
      for (const event of events) if (event.type === 'draft_changed') sent.push({ text: event.draft?.text, targets })
    }
    internals.markDeviceOnline('Home phone', 'lan-phone', 'lan')
    internals.markDeviceOnline('Away phone', 'relay-phone', 'relay')

    const save = (text: string) => service.sendAgentEvent({ type: 'draft_changed', draftId: 'd1', reason: 'saved', draft: { id: 'd1', text } } as AgentEvent)
    await save('h')
    await save('hi')
    expect(sent).toEqual([{ text: 'h', targets: ['lan-phone'] }, { text: 'hi', targets: ['lan-phone'] }])

    vi.advanceTimersByTime(RELAY_DRAFT_SAVE_INTERVAL_MS)
    expect(sent.at(-1)).toEqual({ text: 'hi', targets: ['relay-phone'] })
    await service.stop()
  })
})
