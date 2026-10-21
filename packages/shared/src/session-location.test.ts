import { describe, expect, it } from 'vitest'
import {
  environmentIdForProjectKey,
  selectionForNewSession,
  selectionFromDraftFields,
} from './session-location'

describe('session location', () => {
  it('reads the connection id from a remote project key', () => {
    expect(environmentIdForProjectKey('/Users/me/app')).toBe('local')
    expect(environmentIdForProjectKey('remote:node-1:/srv/app')).toBe('node-1')
    expect(environmentIdForProjectKey(null)).toBe('local')
  })

  it('starts a new session on the project root of that environment', () => {
    expect(selectionForNewSession('node-1')).toEqual({
      environmentId: 'node-1',
      selection: { kind: 'local' },
    })
  })

  it('prefers the stored selection over a legacy path', () => {
    expect(selectionFromDraftFields({
      environmentId: 'node-1',
      worktreeSelection: { kind: 'local' },
      worktreePath: '/repo/.wt/stale',
    })).toEqual({ environmentId: 'node-1', selection: { kind: 'local' } })
  })

  it('rebuilds a pending create from older draft fields', () => {
    expect(selectionFromDraftFields({
      pendingBaseBranch: 'main',
      pendingWorktreeMode: 'attach',
      pendingCarryLocalChanges: true,
    })).toEqual({
      environmentId: 'local',
      selection: {
        kind: 'create',
        baseBranch: 'main',
        mode: 'attach',
        branchName: '',
        carryLocalChanges: true,
      },
    })
  })
})
