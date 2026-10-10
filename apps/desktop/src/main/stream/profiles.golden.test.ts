import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import scenarios from './fixtures/emitted.generated.json'

vi.mock('../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

import { RemoteControlService } from '../remote-control-service'
import { createRendererAgentEventTransport } from '../agent/renderer-agent-event-transport'

/**
 * Frames each subscriber pipeline produced for recorded session output
 * (`scripts/export-stream-fixtures.ts`). The phone wire must not change, so a
 * difference here is a protocol change, not a snapshot to update.
 */
const recorded = scenarios as Array<{ recording: string; events: AgentEvent[] }>
const EVENT_SPACING_MS = 10

afterEach(() => {
  vi.useRealTimers()
})

async function mobileFrames(events: AgentEvent[]): Promise<unknown[]> {
  vi.useFakeTimers({ now: 0 })
  const frames: unknown[] = []
  const service = new RemoteControlService('wss://relay.example', { onCommand: vi.fn() })
  const internals = service as unknown as {
    keys: unknown
    hasAnyMobileTransport: () => boolean
    enqueuePayload: (payload: unknown, targets?: string[]) => Promise<void>
  }
  internals.keys = { rootSecret: 'r', channelKeyHex: 'c' }
  internals.hasAnyMobileTransport = () => true
  internals.enqueuePayload = async (payload, targets) => { frames.push({ payload, targets }) }
  for (const event of events) {
    await service.sendAgentEvent(event, ['phone-1'])
    vi.advanceTimersByTime(EVENT_SPACING_MS)
  }
  vi.advanceTimersByTime(1_000)
  return frames
}

function rendererFrames(events: AgentEvent[]): unknown[] {
  vi.useFakeTimers({ now: 0 })
  const frames: unknown[] = []
  const transport = createRendererAgentEventTransport((batch) => { frames.push(batch) })
  for (const event of events) {
    transport.push(event)
    vi.advanceTimersByTime(EVENT_SPACING_MS)
  }
  transport.flush()
  return frames
}

describe('stream profiles on recorded session output', () => {
  it.each(recorded.map((s) => [s.recording, s.events] as const))('mobile frames for %s', async (name, events) => {
    await expect(JSON.stringify(await mobileFrames(events), null, 1))
      .toMatchFileSnapshot(`./fixtures/golden/mobile.${name}.json`)
  })

  it.each(recorded.map((s) => [s.recording, s.events] as const))('renderer frames for %s', async (name, events) => {
    await expect(JSON.stringify(rendererFrames(events), null, 1))
      .toMatchFileSnapshot(`./fixtures/golden/renderer.${name}.json`)
  })
})
