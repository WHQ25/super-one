import { describe, expect, it, vi } from 'vitest'
import type { ChildTurnView } from './settle-guard'

vi.mock('../db-sessions', () => ({
  spawnChildSessionIds: (parentId: string) => (parentId === 'parent' ? ['live', 'idle', 'away'] : []),
}))

import { childTurnIsOpen, runningSpawnChildIds } from './settle-guard'

function view(
  activity: 'idle' | 'streaming' | 'background' | 'error',
  extra: Partial<ChildTurnView> = {},
): ChildTurnView {
  return {
    activityStatus: () => activity,
    getPendingInteractions: () => [],
    ...extra,
  }
}

describe('childTurnIsOpen', () => {
  it('treats an open turn as running and a finished one as not', () => {
    expect(childTurnIsOpen(null)).toBe(false)
    expect(childTurnIsOpen(view('idle'))).toBe(false)
    expect(childTurnIsOpen(view('error'))).toBe(false)
    expect(childTurnIsOpen(view('streaming'))).toBe(true)
    expect(childTurnIsOpen(view('background'))).toBe(true)
    expect(childTurnIsOpen(view('idle', { getPendingInteractions: () => [{}] }))).toBe(true)
    expect(childTurnIsOpen(view('idle', { realtimeActive: true }))).toBe(true)
  })
})

describe('runningSpawnChildIds', () => {
  it('returns children with an open turn, including one reported by the remote probe', async () => {
    const ids = await runningSpawnChildIds('parent', (id) => {
      if (id === 'live') return view('streaming')
      if (id === 'idle') return view('idle')
      return null
    }, async (id) => id === 'away')
    expect(ids).toEqual(['live', 'away'])
  })
})
