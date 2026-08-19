import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { AgentEvent } from '@superone/shared/agent-types'
import { DeepseekEventMapper } from './event-map'

/**
 * A synthetic dsh log, because the shape under test IS the log's bracketing:
 * driving it through the runtime would make a turn's step count an emergent
 * property of the mock adapter rather than something the test states.
 */
function log(entries: Array<[string, unknown]>): SessionEvent[] {
  return entries.map(([type, data], index) => ({
    type,
    seq: index,
    time: 1_700_000_000_000 + index,
    data,
  })) as unknown as SessionEvent[]
}

function drain(entries: Array<[string, unknown]>): AgentEvent[] {
  const events: AgentEvent[] = []
  const mapper = new DeepseekEventMapper({ sessionId: 's1', emit: (event) => events.push(event) })
  for (const event of log(entries)) mapper.handle(event)
  return events
}

/** A turn that calls one tool: two model round trips, so two dsh steps. */
const TWO_STEP_TURN: Array<[string, unknown]> = [
  ['turn/start', { turn: 0 }],
  ['step/start', { turn: 0, step: 0 }],
  ['assistant/chunk', { chunk: { type: 'text-delta', text: 'looking' } }],
  ['tool/call', { name: 'bash', callId: 'c1', arguments: { command: 'ls' } }],
  ['assistant/message', { usage: { inputTokens: 1_000, outputTokens: 40, cacheReadTokens: 30_000 } }],
  ['step/end', { turn: 0, step: 0 }],
  ['tool/result', { message: { source: { callId: 'c1' }, content: [] } }],
  ['step/start', { turn: 0, step: 1 }],
  ['assistant/chunk', { chunk: { type: 'text-delta', text: 'done' } }],
  ['assistant/message', { usage: { inputTokens: 200, outputTokens: 60, cacheReadTokens: 31_000 } }],
  ['step/end', { turn: 0, step: 1 }],
  ['turn/end', { turn: 0, reason: { kind: 'completed' } }],
]

describe('the turn is the message', () => {
  it('renders a multi-step turn as one assistant message, not one per step', () => {
    const events = drain(TWO_STEP_TURN)

    // A step per model round trip is dsh's business; SuperOne renders one
    // bubble — and therefore one token footer — per thing the user asked for.
    expect(events.filter((event) => event.type === 'message_start')).toHaveLength(1)
    expect(events.filter((event) => event.type === 'message_complete')).toHaveLength(1)
    const targets = new Set(events.flatMap((event) => (
      event.type === 'content_delta' ? [event.messageId] : []
    )))
    expect(targets.size).toBe(1)
  })

  it('closes the message at the turn, anchoring a fork on the seq that ended it', () => {
    const events = drain(TWO_STEP_TURN)

    const complete = events.find((event) => event.type === 'message_complete')
    // `turn/end` is the last entry, and dsh forks at an inclusive seq — so the
    // branch carries the whole turn, never half of one.
    expect(complete?.type === 'message_complete' ? complete.metadata?.forkAnchorId : undefined)
      .toBe(String(TWO_STEP_TURN.length - 1))
  })

  it('sums the turn’s spend across steps while leaving cache reads out of it', () => {
    const usage = drain(TWO_STEP_TURN).filter((event) => event.type === 'message_usage')

    // `message_usage` overwrites the footer, so the last one is what the user
    // reads. Cache reads are the same prompt re-sent each step: billing them
    // per step would report this turn as ~62k spent instead of 1.2k.
    const last = usage.at(-1)
    expect(last?.type === 'message_usage' ? last.inputTokens : undefined).toBe(1_200)
    expect(last?.type === 'message_usage' ? last.outputTokens : undefined).toBe(100)
    expect(last?.type === 'message_usage' ? last.cacheReadTokens : undefined).toBe(61_000)
  })

  it('keeps the context ring on the latest step’s occupancy rather than accumulating', () => {
    const usage = drain(TWO_STEP_TURN).filter((event) => event.type === 'message_usage')

    // The ring answers "how full is the context now", which the newest step
    // states outright — summing it would overflow a window that never filled.
    const last = usage.at(-1)
    expect(last?.type === 'message_usage' ? last.contextTokens : undefined).toBe(31_260)
  })

  it('starts a fresh message for the next turn', () => {
    const events = drain([
      ...TWO_STEP_TURN,
      ['turn/start', { turn: 1 }],
      ['step/start', { turn: 1, step: 0 }],
      ['assistant/chunk', { chunk: { type: 'text-delta', text: 'again' } }],
      ['assistant/message', { usage: { inputTokens: 500, outputTokens: 10 } }],
      ['step/end', { turn: 1, step: 0 }],
      ['turn/end', { turn: 1, reason: { kind: 'completed' } }],
    ])

    const ids = events.flatMap((event) => (event.type === 'message_start' ? [event.message.id] : []))
    expect(ids).toEqual(['dsh:s1:0', 'dsh:s1:1'])
    // The second turn's footer is its own spend, not the session's running total.
    const last = events.filter((event) => event.type === 'message_usage').at(-1)
    expect(last?.type === 'message_usage' ? last.inputTokens : undefined).toBe(500)
  })

  it('leaves no bubble behind for a turn that never reached the model', () => {
    // dsh opens a turn before it claims input, and rejection or empty input
    // closes it with no step at all.
    const events = drain([
      ['turn/start', { turn: 0 }],
      ['turn/end', { turn: 0, reason: { kind: 'blocked' } }],
    ])

    expect(events).toHaveLength(0)
  })

  it('stops the bubble streaming when a turn ends blocked rather than completed', () => {
    const events = drain([
      ['turn/start', { turn: 0 }],
      ['step/start', { turn: 0, step: 0 }],
      ['assistant/chunk', { chunk: { type: 'text-delta', text: 'partial' } }],
      ['turn/end', { turn: 0, reason: { kind: 'blocked' } }],
    ])

    // Only `aborted` and `error` get their own terminal event; every other way
    // a turn can end still has to close the message, or it spins forever.
    expect(events.filter((event) => event.type === 'message_complete')).toHaveLength(1)
  })

  it('attributes an aborted turn to the open message without completing it', () => {
    const events = drain([
      ['turn/start', { turn: 0 }],
      ['step/start', { turn: 0, step: 0 }],
      ['assistant/chunk', { chunk: { type: 'text-delta', text: 'half' } }],
      ['turn/end', { turn: 0, reason: { kind: 'aborted', reason: 'user' } }],
    ])

    const interrupted = events.find((event) => event.type === 'message_interrupted')
    expect(interrupted?.type === 'message_interrupted' ? interrupted.messageId : undefined).toBe('dsh:s1:0')
    expect(events.some((event) => event.type === 'message_complete')).toBe(false)
  })
})
