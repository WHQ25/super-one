import { describe, expect, it } from 'vitest'
import {
  resolveMainDirFromCommonDir,
  planNewWorktreePaths,
  worktreeAddArgs,
  recordedBranchForMode,
  parseNumstat,
  worktreeInfoFromPorcelain,
  checkedOutBranchesFromPorcelain,
} from './worktree-plan'

describe('resolveMainDirFromCommonDir', () => {
  it('strips .git suffix from absolute common dir', () => {
    expect(resolveMainDirFromCommonDir('/repo/wt', '/repo/.git')).toBe('/repo')
  })

  it('resolves relative common dir', () => {
    expect(resolveMainDirFromCommonDir('/repo/wt', '../.git')).toMatch(/\/repo$/)
  })
})

describe('planNewWorktreePaths', () => {
  it('places worktrees under ~/.worktrees/<repo>/<epoch>-<hash>', () => {
    const { wtDir, wtPath } = planNewWorktreePaths({
      mainDir: '/Users/me/proj',
      shortHash: 'abcdef1',
      nowMs: 1_700_000_000_000,
      homeDir: '/home/u',
    })
    expect(wtDir).toBe('/home/u/.worktrees/proj')
    expect(wtPath.startsWith('/home/u/.worktrees/proj/')).toBe(true)
    expect(wtPath.endsWith('-abcdef1')).toBe(true)
  })
})

describe('worktreeAddArgs', () => {
  it('builds branch/attach/detach argv', () => {
    expect(worktreeAddArgs('branch', '/wt', 'main', 'feat')).toEqual([
      'add',
      '-b',
      'feat',
      '/wt',
      'main',
    ])
    expect(worktreeAddArgs('attach', '/wt', 'main')).toEqual(['add', '/wt', 'main'])
    expect(worktreeAddArgs('detach', '/wt', 'main')).toEqual(['add', '--detach', '/wt', 'main'])
  })
})

describe('recordedBranchForMode', () => {
  it('maps modes', () => {
    expect(recordedBranchForMode('branch', 'main', 'f')).toBe('f')
    expect(recordedBranchForMode('attach', 'main')).toBe('main')
    expect(recordedBranchForMode('detach', 'main')).toBeNull()
  })
})

describe('parseNumstat', () => {
  it('sums lines', () => {
    expect(parseNumstat('10\t2\ta.ts\n3\t1\tb.ts\n')).toEqual({
      files: 2,
      insertions: 13,
      deletions: 3,
    })
  })
})

describe('worktreeInfoFromPorcelain', () => {
  it('parses multi-block porcelain', () => {
    const raw = [
      'worktree /repo',
      'HEAD aaa',
      'branch refs/heads/main',
      '',
      'worktree /repo/.worktrees/x',
      'HEAD bbb',
      'branch refs/heads/feat',
      '',
    ].join('\n')
    const info = worktreeInfoFromPorcelain(raw, '/repo/.worktrees/x')
    expect(info.isWorktree).toBe(true)
    expect(info.entries).toHaveLength(2)
    expect(info.entries[1]?.isCurrent).toBe(true)
    expect(info.currentBranch).toBe('feat')
  })
})

describe('checkedOutBranchesFromPorcelain', () => {
  it('lists branches', () => {
    const raw = 'worktree /a\nbranch refs/heads/main\n\nworktree /b\nbranch refs/heads/f\n\n'
    expect(checkedOutBranchesFromPorcelain(raw)).toEqual(['main', 'f'])
  })
})
