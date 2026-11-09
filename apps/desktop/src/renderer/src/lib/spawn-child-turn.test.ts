import { describe, expect, it } from 'vitest'
import { spawnChildTurnOpen, type SpawnChildTurn } from './spawn-child-turn'

function sessions(entries: Record<string, SpawnChildTurn>) {
  return entries
}

describe('spawnChildTurnOpen', () => {
  it('is true when a spawn child is streaming, in the background, waiting, or on a voice call', () => {
    expect(spawnChildTurnOpen(sessions({ child: { _parentSessionId: 'parent', status: 'streaming' } }), 'parent')).toBe(true)
    expect(spawnChildTurnOpen(sessions({ child: { _parentSessionId: 'parent', status: 'background' } }), 'parent')).toBe(true)
    expect(spawnChildTurnOpen(sessions({
      child: { _parentSessionId: 'parent', status: 'idle', pendingPermissions: [{}] },
    }), 'parent')).toBe(true)
    expect(spawnChildTurnOpen(sessions({
      child: { _parentSessionId: 'parent', status: 'idle', pendingQuestion: {} },
    }), 'parent')).toBe(true)
    expect(spawnChildTurnOpen(sessions({
      child: { _parentSessionId: 'parent', status: 'idle' },
    }), 'parent', 'child')).toBe(true)
  })

  it('ignores an idle child, another parent\'s child, and the parent\'s own turn', () => {
    expect(spawnChildTurnOpen(sessions({ child: { _parentSessionId: 'parent', status: 'idle' } }), 'parent')).toBe(false)
    expect(spawnChildTurnOpen(sessions({ child: { _parentSessionId: 'parent', status: 'error' } }), 'parent')).toBe(false)
    expect(spawnChildTurnOpen(sessions({ child: { _parentSessionId: 'other', status: 'streaming' } }), 'parent')).toBe(false)
    expect(spawnChildTurnOpen(sessions({ parent: { status: 'streaming' } }), 'parent')).toBe(false)
    expect(spawnChildTurnOpen(undefined, 'parent')).toBe(false)
  })
})
