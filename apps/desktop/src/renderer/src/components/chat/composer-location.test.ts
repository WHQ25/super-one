/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest'
import { composerLocationOf } from './composer-location'

const PROJECT = '/repo'
const MIRROR = {
  pendingBaseBranch: 'main',
  pendingMode: 'branch' as const,
  pendingBranchName: 'from-mirror',
  pendingCarryLocalChanges: true,
  activePath: '/repo/.wt/mirror',
}

describe('composerLocationOf', () => {
  it('ignores the project mirror when the session chose the project root', () => {
    const location = composerLocationOf({
      projectPath: PROJECT,
      session: {
        environmentSelection: { environmentId: 'local', selection: { kind: 'local' } },
        _gitBranch: 'main',
      },
      mirror: MIRROR,
    })
    expect(location.cwd).toBe(PROJECT)
    expect(location.pendingCreate).toBe(false)
    expect(location.selection).toEqual({ kind: 'local' })
    expect(location.branch).toBe('main')
  })

  it('reads an existing checkout from the session', () => {
    const location = composerLocationOf({
      projectPath: PROJECT,
      session: {
        environmentSelection: {
          environmentId: 'office',
          selection: { kind: 'existing', path: '/repo/.wt/feat', branch: 'feat' },
        },
        messages: { length: 1 },
        session: { id: 'started' },
      },
      mirror: MIRROR,
    })
    expect(location).toMatchObject({
      environmentId: 'office',
      cwd: '/repo/.wt/feat',
      branch: 'feat',
      readOnly: true,
      pendingCreate: false,
    })
  })

  it('keeps a pending create on the session ahead of the mirror', () => {
    const location = composerLocationOf({
      projectPath: PROJECT,
      session: {
        environmentSelection: {
          environmentId: 'local',
          selection: {
            kind: 'create',
            baseBranch: 'develop',
            mode: 'branch',
            branchName: 'from-session',
            carryLocalChanges: false,
          },
        },
      },
      mirror: MIRROR,
    })
    expect(location.pendingCreate).toBe(true)
    expect(location.selection).toMatchObject({ baseBranch: 'develop', branchName: 'from-session' })
    expect(location.cwd).toBe(PROJECT)
  })

  it('falls back to a legacy mirror only when the session has no selection', () => {
    const pending = composerLocationOf({
      projectPath: PROJECT,
      session: { environmentSelection: null },
      mirror: MIRROR,
    })
    expect(pending.pendingCreate).toBe(true)
    expect(pending.selection).toMatchObject({ baseBranch: 'main', branchName: 'from-mirror' })

    const existing = composerLocationOf({
      projectPath: PROJECT,
      session: { _worktreePath: '/repo/.wt/saved', _gitBranch: 'saved' },
      mirror: { ...MIRROR, pendingBaseBranch: null },
    })
    expect(existing.cwd).toBe('/repo/.wt/saved')
    expect(existing.selection.kind).toBe('existing')
  })
})
