import { describe, expect, it, vi } from 'vitest'
import type { RelayClient } from '@superone/relay-client'
import { fetchProjectGitInfo, gitTurnEnded } from './session-git-refresh'

const idle = (sessionId: string | null): { sessionId: string | null; streaming: boolean } => (
  { sessionId, streaming: false }
)
const live = (sessionId: string): { sessionId: string; streaming: boolean } => (
  { sessionId, streaming: true }
)

describe('gitTurnEnded', () => {
  it('fires when the same session leaves streaming', () => {
    expect(gitTurnEnded(live('s1'), idle('s1'))).toBe(true)
  })

  it('ignores a session that was already idle', () => {
    expect(gitTurnEnded(idle('s1'), idle('s1'))).toBe(false)
  })

  it('ignores a session that is still streaming', () => {
    expect(gitTurnEnded(live('s1'), live('s1'))).toBe(false)
  })

  it('does not treat a session switch as a turn ending', () => {
    expect(gitTurnEnded(live('s1'), idle('s2'))).toBe(false)
    expect(gitTurnEnded(idle('s1'), idle('s2'))).toBe(false)
  })

  it('does not fire before a session exists', () => {
    expect(gitTurnEnded(idle(null), idle(null))).toBe(false)
    expect(gitTurnEnded(idle(null), idle('s1'))).toBe(false)
  })
})

describe('fetchProjectGitInfo', () => {
  it('asks the host for the project checkout', async () => {
    const request = vi.fn(async () => ({ branch: 'main', dirty: { files: 2, insertions: 4, deletions: 1 } }))
    const git = await fetchProjectGitInfo({ request } as unknown as RelayClient, '/repo')
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ type: 'get_git_info', projectPath: '/repo' }))
    expect(git?.dirty?.files).toBe(2)
  })

  it('swallows a failed read so the chip can stay on the last known state', async () => {
    const request = vi.fn(async () => { throw new Error('offline') })
    await expect(fetchProjectGitInfo({ request } as unknown as RelayClient, '/repo')).resolves.toBeNull()
  })
})
