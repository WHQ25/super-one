import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '@superone/shared/agent-types'
import { collectChangedMessageIds } from './message-dirty'

function msg(id: string, text = id): ChatMessage {
  return {
    id,
    role: 'assistant',
    status: 'complete',
    content: [{ type: 'text', text }],
    createdAt: '2026-01-01T00:00:00Z',
    providerId: 'claude',
  }
}

describe('collectChangedMessageIds', () => {
  it('returns empty when arrays are the same reference', () => {
    const a = [msg('a')]
    expect(collectChangedMessageIds(a, a)).toEqual([])
  })

  it('detects new message ids', () => {
    const prev = [msg('a')]
    const next = [prev[0], msg('b')]
    expect(collectChangedMessageIds(prev, next)).toEqual(['b'])
  })

  it('detects replaced object identity for same id', () => {
    const prev = [msg('a', 'old')]
    const next = [msg('a', 'new')]
    expect(collectChangedMessageIds(prev, next)).toEqual(['a'])
  })

  it('ignores unchanged object identity', () => {
    const a = msg('a')
    const b = msg('b')
    const prev = [a, b]
    const next = [a, b]
    expect(collectChangedMessageIds(prev, next)).toEqual([])
  })
})
