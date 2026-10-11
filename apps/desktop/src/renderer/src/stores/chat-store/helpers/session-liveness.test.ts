import { describe, it, expect } from 'vitest'
import { createDefaultPerSessionState } from '../defaults'
import type { ChatMessage } from '@superone/shared/agent-types'
import { sessionDirectoryHint } from './session-liveness'

const session = (patch: Partial<ReturnType<typeof createDefaultPerSessionState>>) => ({ ...createDefaultPerSessionState(), ...patch })

describe('sessionDirectoryHint', () => {
  it('sends a chosen worktree for any session', () => {
    expect(sessionDirectoryHint(session({ _worktreePath: '/repo/.worktrees/a', messages: [{} as ChatMessage] }))).toBe('/repo/.worktrees/a')
  })

  it('sends an unsent session its own directory, or the fallback', () => {
    expect(sessionDirectoryHint(session({ cwd: '/repo' }))).toBe('/repo')
    expect(sessionDirectoryHint(session({ cwd: '' }), '/repo')).toBe('/repo')
  })

  it('leaves a started session where its host put it', () => {
    expect(sessionDirectoryHint(session({ cwd: '/repo', messages: [{} as ChatMessage] }), '/repo')).toBeUndefined()
    expect(sessionDirectoryHint(session({ cwd: '/repo', status: 'streaming' }), '/repo')).toBeUndefined()
  })

  it('does not move a history session from its loading stub', () => {
    expect(sessionDirectoryHint(session({ cwd: '/repo', _historyHydrated: false }), '/repo')).toBeUndefined()
  })
})
