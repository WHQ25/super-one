import { describe, expect, it } from 'vitest'
import { settingsKeepingSavedEnvironment } from './use-remote-drafts'

describe('settingsKeepingSavedEnvironment', () => {
  it('keeps an opened draft on the environment it was saved for', () => {
    const staged = settingsKeepingSavedEnvironment(
      { harness: 'codex', environmentId: 'mac', worktreePath: '/repo/wt' },
      { harness: 'claude', model: 'opus', environmentId: 'node-x', worktreePath: '/repo/wt' },
    )
    expect(staged.environmentId).toBe('mac')
    expect(staged.harness).toBe('claude')
    expect(staged.model).toBe('opus')
  })

  it('does not adopt the routed environment when the saved draft names none', () => {
    const staged = settingsKeepingSavedEnvironment(
      { harness: 'codex', codexModel: 'saved-model' },
      { harness: 'codex', codexModel: 'saved-model', environmentId: 'node-x' },
    )
    expect(staged).not.toHaveProperty('environmentId')
    expect(staged.codexModel).toBe('saved-model')
  })

  it('records the current route on a new draft', () => {
    expect(settingsKeepingSavedEnvironment(undefined, { harness: 'codex', environmentId: 'node-x' }).environmentId).toBe('node-x')
  })
})
