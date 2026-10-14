import { describe, expect, it } from 'vitest'
import type { ChatMessage } from './agent-types'
import { buildRecapMessage, isRecapSlashSend, withoutPendingRecapTurn, withRecapRow } from './recap-row'
import { parseTurnMetaMarker } from './transcript-markers'

function msg(id: string, role: 'user' | 'assistant', text?: string): ChatMessage {
  return { id, role, status: 'complete', content: text ? [{ type: 'text', text }] : [], createdAt: '', providerId: 'claude' }
}

const recap = (id: string, text = 'Shipped; next is push.') => buildRecapMessage(id, '', text, false)

describe('withRecapRow', () => {
  it('appends a host-side recap after the transcript', () => {
    const next = withRecapRow([msg('u1', 'user', 'go'), msg('a1', 'assistant')], recap('r1'))
    expect(next!.map((m) => m.id)).toEqual(['u1', 'a1', 'r1'])
    expect(parseTurnMetaMarker(next![2])).toEqual({ kind: 'recap', text: 'Shipped; next is push.', auto: false })
  })

  it('replaces a sent "/recap" bubble and its blank reply', () => {
    const next = withRecapRow([msg('u1', 'user', 'go'), msg('a1', 'assistant'), msg('u2', 'user', '/recap'), msg('a2', 'assistant')], recap('r1'), 'a2')
    expect(next!.map((m) => m.id)).toEqual(['u1', 'a1', 'r1'])
  })

  it('keeps a user message that only mentions /recap', () => {
    const next = withRecapRow([msg('u1', 'user', '/recap please, then push'), msg('a1', 'assistant')], recap('r1'), 'a1')
    expect(next!.map((m) => m.id)).toEqual(['u1', 'r1'])
  })

  it('returns null when the tail already shows the same recap', () => {
    expect(withRecapRow([msg('u1', 'user', 'go'), recap('r1')], recap('r2'))).toBeNull()
    expect(withRecapRow([recap('r1')], recap('r2', 'Something else'))).not.toBeNull()
  })
})

describe('withoutPendingRecapTurn', () => {
  const turn = [msg('u1', 'user', 'go'), msg('a1', 'assistant'), msg('u2', 'user', '/recap'), msg('a2', 'assistant')]

  it('hides the running "/recap" turn', () => {
    expect(withoutPendingRecapTurn(turn, true).map((m) => m.id)).toEqual(['u1', 'a1'])
  })

  it('shows everything when no recap is running, or the last message is not "/recap"', () => {
    expect(withoutPendingRecapTurn(turn, false)).toBe(turn)
    const hostRecap = turn.slice(0, 2)
    expect(withoutPendingRecapTurn(hostRecap, true)).toBe(hostRecap)
  })
})

describe('isRecapSlashSend', () => {
  it('matches a bare /recap on harnesses that run it as a local command', () => {
    expect(isRecapSlashSend('claude', ' /recap ')).toBe(true)
    expect(isRecapSlashSend('claude', '/recap now')).toBe(false)
    expect(isRecapSlashSend('acp', '/recap')).toBe(false)
  })
})
