import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '@superone/shared/agent-types'
import { findLastAssistantMessageId } from './presenters/ChatMessageIndicators'
import { transcriptRow } from './transcript-rows'

function assistant(id: string, text: string, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id,
    role: 'assistant',
    status: 'complete',
    content: [{ type: 'text', text }],
    createdAt: '2026-09-07T00:00:00.000Z',
    providerId: 'claude',
    ...overrides,
  }
}

/** Compaction and turn-meta rows are persisted as system-provider assistant messages. */
function marker(id: string, text: string): ChatMessage {
  return assistant(id, text, { providerId: 'system' })
}

describe('marker rows in the mobile transcript', () => {
  it('renders a compaction marker as an indicator instead of its raw text', () => {
    const message = marker('c1', '__compact__:auto:123456:2000:4500')
    const row = transcriptRow(message, [message])

    expect(row.kind).toBe('compact')
    expect(row.kind === 'compact' && row.marker).toMatchObject({
      trigger: 'auto',
      preTokens: 123456,
      postTokens: 2000,
      durationMs: 4500,
    })
  })

  it('renders a turn-meta recap as an indicator', () => {
    const message = marker('m1', `__turn_meta__:${JSON.stringify({ kind: 'recap', text: 'Picked up the parity audit' })}`)
    const row = transcriptRow(message, [message])

    expect(row.kind).toBe('turn-meta')
    expect(row.kind === 'turn-meta' && row.meta).toEqual({ kind: 'recap', text: 'Picked up the parity audit' })
  })

  it('hides a summary marker the turn footer already carries', () => {
    const turn = assistant('t1', 'done', { metadata: { turnSummary: 'Fixed the footer' } })
    const message = marker('m1', `__turn_meta__:${JSON.stringify({ kind: 'summary', text: 'Fixed the footer' })}`)

    expect(transcriptRow(message, [turn, message]).kind).toBe('hidden')
    // …but keeps it when no turn repeats it.
    expect(transcriptRow(message, [assistant('t1', 'done'), message]).kind).toBe('turn-meta')
  })

  it('keeps an ordinary assistant turn a turn', () => {
    const message = assistant('t1', 'Not a marker: __compact__ appears mid-sentence')
    expect(transcriptRow(message, [message]).kind).toBe('turn')
  })

  it('does not let a trailing marker steal the live turn from the real reply', () => {
    const reply = assistant('reply', 'streaming…', { status: 'streaming' })
    const trailing = marker('c1', '__compact__:auto:900')

    // Markers carry role 'assistant' for persistence, so a naive findLast picks
    // the marker and the real reply never renders as live.
    expect(findLastAssistantMessageId([reply, trailing])).toBe('reply')
  })

  it('does not let a mid-turn model-fallback notice steal the live turn', () => {
    const reply = assistant('reply', 'streaming…', { status: 'streaming' })
    const notice = assistant('fallback', 'Switched to claude-sonnet-5 (overloaded)', {
      providerId: 'system',
      metadata: { modelFallback: { trigger: 'overloaded', toModel: 'claude-sonnet-5' } },
    })

    expect(findLastAssistantMessageId([reply, notice])).toBe('reply')
  })
})
