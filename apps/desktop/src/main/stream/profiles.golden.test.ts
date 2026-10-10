import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import scenarios from './fixtures/emitted.generated.json'
// Desktop content ports provide the same ANSI/highlight transforms as production.
import '../remote-content'

vi.mock('../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

import { batchingFor, ConnectionDelivery, createEventBatcher, createLocalDelivery, deliveryPolicy } from '@superone/runtime/stream'

/**
 * Surface transformations and renderer batches from recorded session output.
 * The actual phone protocol sender, projection and sealed frame budgets are
 * covered by wire-baseline.test.ts.
 */
const recorded = scenarios as Array<{ recording: string; events: AgentEvent[] }>
const EVENT_SPACING_MS = 10

afterEach(() => {
  vi.useRealTimers()
})

async function mobileFrames(events: AgentEvent[]): Promise<unknown[]> {
  vi.useFakeTimers({ now: 0 })
  const frames: unknown[] = []
  const delivery = new ConnectionDelivery(deliveryPolicy('relay', 'phone'))
  const batcher = createEventBatcher<undefined>(payload => { frames.push({ payload, targets: ['phone-1'] }) }, batchingFor(delivery.policy))
  for (const event of events) {
    for (const shaped of delivery.shape(event)) batcher.push(shaped)
    vi.advanceTimersByTime(EVENT_SPACING_MS)
  }
  vi.advanceTimersByTime(1_000)
  return frames
}

function rendererFrames(events: AgentEvent[]): unknown[] {
  vi.useFakeTimers({ now: 0 })
  const frames: unknown[] = []
  const transport = createLocalDelivery((batch) => { frames.push(batch) })
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
