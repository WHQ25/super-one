import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import { buildModelFallbackMessage, modelFallbackSignature } from './model-fallback-notification'

type FallbackEvent = Extract<AgentEvent, { type: 'model_fallback' }>

function fallback(overrides: Partial<FallbackEvent> = {}): FallbackEvent {
  return {
    type: 'model_fallback',
    trigger: 'overloaded',
    fromModel: 'claude-fable-5',
    toModel: 'claude-opus-5',
    ...overrides,
  } as FallbackEvent
}

describe('buildModelFallbackMessage', () => {
  it('carries the swap in metadata so the chat can render its own row', () => {
    expect(buildModelFallbackMessage(fallback()).metadata?.modelFallback).toEqual({
      trigger: 'overloaded',
      fromModel: 'claude-fable-5',
      toModel: 'claude-opus-5',
    })
  })

  it('is a system-authored assistant row so it cannot title the session', () => {
    const row = buildModelFallbackMessage(fallback())
    expect(row.role).toBe('assistant')
    expect(row.providerId).toBe('system')
    expect(row.status).toBe('complete')
  })

  it('writes prose into the text block for DB rows, exports and mobile', () => {
    const [block] = buildModelFallbackMessage(fallback()).content
    expect(block).toEqual({
      type: 'text',
      text: 'Switched to claude-opus-5 from claude-fable-5 (overloaded)',
    })
  })

  it('does not claim the session switched when the swap was subagent-local', () => {
    const row = buildModelFallbackMessage(fallback({ trigger: 'refusal', scope: 'local' }))
    expect(row.metadata?.modelFallback?.scope).toBe('local')
    expect(row.content[0]).toEqual({
      type: 'text',
      text: 'Switched to claude-opus-5 from claude-fable-5 for this response only (refusal)',
    })
  })

  it('reads as a decline, not a swap, when nothing took over', () => {
    const row = buildModelFallbackMessage(
      fallback({ trigger: 'refusal', toModel: undefined, outcome: 'declined', refusalCategory: 'cyber' }),
    )
    expect(row.metadata?.modelFallback).toMatchObject({ outcome: 'declined', refusalCategory: 'cyber' })
    expect(row.content[0]).toEqual({
      type: 'text',
      text: 'claude-fable-5 declined and no fallback was available (refusal)',
    })
  })

  it('omits absent models rather than emitting undefined keys', () => {
    const row = buildModelFallbackMessage(fallback({ fromModel: undefined, toModel: undefined }))
    expect(row.metadata?.modelFallback).toEqual({ trigger: 'overloaded' })
    expect(row.content[0]).toEqual({ type: 'text', text: 'Switched model (overloaded)' })
  })

  it('mints a distinct id per row so two swaps in one turn both survive append', () => {
    const first = buildModelFallbackMessage(fallback())
    const second = buildModelFallbackMessage(fallback())
    expect(first.id).not.toBe(second.id)
  })
})

describe('modelFallbackSignature', () => {
  it('matches a re-announced identical swap', () => {
    expect(modelFallbackSignature(fallback())).toBe(modelFallbackSignature(fallback()))
  })

  it('separates chain hops that land on different models', () => {
    expect(modelFallbackSignature(fallback())).not.toBe(
      modelFallbackSignature(fallback({ toModel: 'claude-sonnet-5' })),
    )
  })

  it('separates the same hop taken for a different reason', () => {
    expect(modelFallbackSignature(fallback())).not.toBe(
      modelFallbackSignature(fallback({ trigger: 'last_resort' })),
    )
  })

  it('separates a decline from a swap of the same models', () => {
    expect(modelFallbackSignature(fallback({ trigger: 'refusal' }))).not.toBe(
      modelFallbackSignature(fallback({ trigger: 'refusal', outcome: 'declined' })),
    )
  })

  it('separates a session-wide swap from a subagent-local one', () => {
    expect(modelFallbackSignature(fallback({ scope: 'session' }))).not.toBe(
      modelFallbackSignature(fallback({ scope: 'local' })),
    )
  })
})
