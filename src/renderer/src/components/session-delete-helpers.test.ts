import { describe, expect, it } from 'vitest'
import { getDeleteSessionRecovery } from './session-delete-helpers'

describe('getDeleteSessionRecovery', () => {
  it('returns Claude CLI resume command for claude sessions', () => {
    expect(getDeleteSessionRecovery('claude', 'sess-claude-1')).toEqual({
      cliName: 'Claude Code CLI',
      resumeCommand: 'claude --resume sess-claude-1',
    })
  })

  it('returns Codex CLI resume command for codex sessions', () => {
    expect(getDeleteSessionRecovery('codex', 'thread_123')).toEqual({
      cliName: 'Codex CLI',
      resumeCommand: 'codex resume thread_123',
    })
  })
})

