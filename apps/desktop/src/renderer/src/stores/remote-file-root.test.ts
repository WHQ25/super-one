/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from 'vitest'
import { selectEffectiveProjectRoot, useAppStore } from './app'

const PROJECT = 'remote:env-1:/work/app'

describe('remote file-tree root', () => {
  beforeEach(() => {
    useAppStore.setState({ currentFolder: PROJECT, _worktrees: {} })
  })

  it('stores a remote worktree as a remote key and a project-root cwd as none', () => {
    useAppStore.getState().setActiveWorktree(PROJECT, '/work/app/wt')
    expect(useAppStore.getState()._worktrees[PROJECT]?.activePath).toBe('remote:env-1:/work/app/wt')
    expect(selectEffectiveProjectRoot(useAppStore.getState())).toBe('remote:env-1:/work/app/wt')

    useAppStore.getState().setActiveWorktree(PROJECT, '/work/app/')
    expect(useAppStore.getState()._worktrees[PROJECT]?.activePath).toBeNull()
    expect(selectEffectiveProjectRoot(useAppStore.getState())).toBe(PROJECT)

    useAppStore.getState().setActiveWorktree(PROJECT, '/work/app/.')
    expect(useAppStore.getState()._worktrees[PROJECT]?.activePath).toBeNull()
    useAppStore.getState().setActiveWorktree(PROJECT, '/work/./app/wt')
    expect(useAppStore.getState()._worktrees[PROJECT]?.activePath).toBe('remote:env-1:/work/app/wt')
  })

  it('repairs a bare host path already stored as the active worktree', () => {
    useAppStore.setState({
      currentFolder: PROJECT,
      _worktrees: {
        [PROJECT]: {
          pendingBaseBranch: null,
          pendingMode: 'branch',
          pendingBranchName: '',
          pendingCarryLocalChanges: false,
          activePath: '/work/app/wt',
        },
      },
    })
    expect(selectEffectiveProjectRoot(useAppStore.getState())).toBe('remote:env-1:/work/app/wt')
  })

  it('leaves a local worktree path unchanged', () => {
    useAppStore.setState({ currentFolder: '/repo', _worktrees: {} })
    useAppStore.getState().setActiveWorktree('/repo', '/repo/.wt/feat')
    expect(useAppStore.getState()._worktrees['/repo']?.activePath).toBe('/repo/.wt/feat')
    expect(selectEffectiveProjectRoot(useAppStore.getState())).toBe('/repo/.wt/feat')

    useAppStore.getState().setActiveWorktree('/repo', '/repo')
    expect(useAppStore.getState()._worktrees['/repo']?.activePath).toBeNull()
    expect(selectEffectiveProjectRoot(useAppStore.getState())).toBe('/repo')
  })
})
