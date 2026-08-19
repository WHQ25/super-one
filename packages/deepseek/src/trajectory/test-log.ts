/**
 * Session-log fixtures shared by the trajectory tests.
 *
 * One builder, so a one-shot projection test and an incremental fold test
 * assert over the same log shape rather than two drifting hand-written ones.
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'

/**
 * Build a seq-contiguous log the way dsh writes one: seq is the array index and
 * time advances by a fixed tick unless the case pins an exact instant.
 * @param entries - `[type, data, time?]` triples in log order.
 * @returns the log.
 */
export function log(entries: Array<[SessionEvent['type'], unknown, number?]>): SessionEvent[] {
  return entries.map(([type, data, time], index) => ({
    type,
    seq: index,
    time: time ?? 1_000 + index * 10,
    data,
  })) as SessionEvent[]
}

/**
 * A minimal assistant message carrying `text` from one provider route.
 * @param text - the message text.
 * @returns the message payload.
 */
export function assistantMessage(text: string) {
  return {
    id: 'msg',
    role: 'assistant',
    content: [{ type: 'text', text }],
    source: { kind: 'model', provider: 'deepseek', model: 'deepseek-chat' },
  }
}

/**
 * A tool result payload for one call.
 * @param callId - the call this result answers.
 * @param text - the result text.
 * @returns the event data.
 */
export function toolResult(callId: string, text: string) {
  return {
    turn: 0,
    step: 0,
    message: {
      id: 'm',
      role: 'user',
      source: { kind: 'tool', callId },
      content: [{ type: 'tool-result', toolCallId: callId, isError: false, content: [{ type: 'text', text }] }],
    },
  }
}

/** A header with one tool, so schema lookup has something to resolve. */
export const HEADER = {
  config: { provider: 'deepseek', model: 'deepseek-chat', temperature: 0.2 },
  system: 'you are helpful',
  tools: [{ name: 'read', description: 'read a file', parameters: { type: 'object' } }],
}
