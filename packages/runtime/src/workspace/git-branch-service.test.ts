import { describe, expect, it, vi } from 'vitest'
import { WorkspaceGitService, type WorkspaceGitServiceOptions } from './git-service'
import type { WorkspaceProjects } from './workspace-projects'

function projects(): WorkspaceProjects {
  return {
    get: () => ({ projectId: 'p1', path: '/repo', name: 'repo', repoIdentity: null }),
    touch: () => {},
  } as unknown as WorkspaceProjects
}

describe('WorkspaceGitService branch lists', () => {
  it('lists tracking refs and checks out a local branch with --track', async () => {
    const calls: string[][] = []
    const run = vi.fn(async (_cwd: string, args: string[]) => {
      calls.push(args)
      if (args[0] === 'branch') return 'main\n'
      if (args[0] === 'for-each-ref') return 'origin\norigin/HEAD\norigin/feature/foo\n'
      if (args[0] === 'rev-parse' && args.includes('--abbrev-ref')) return 'main\n'
      if (args[0] === 'rev-parse' && args.includes('--verify')) return 'abc\n'
      if (args[0] === 'rev-parse' && args.includes('--is-inside-work-tree')) return 'true\n'
      return ''
    })
    const svc = new WorkspaceGitService(projects(), { gitRun: run as WorkspaceGitServiceOptions['gitRun'] })

    await expect(svc.branches('p1')).resolves.toEqual({
      current: 'main',
      branches: ['main'],
      tracking: ['origin/feature/foo'],
    })
    await expect(svc.switchBranch('p1', 'feature/foo', {
      create: true,
      startPoint: 'origin/feature/foo',
    })).resolves.toEqual({ ok: true })
    expect(calls).toContainEqual(['checkout', '-b', 'feature/foo', '--track', 'origin/feature/foo'])
    expect(calls.some((args) => args[0] === 'checkout' && args[1] === 'origin/feature/foo')).toBe(false)

    await expect(svc.init('p1')).resolves.toEqual({ ok: true })
    expect(calls.some((args) => args[0] === 'init')).toBe(false)
  })

  it('inits a folder that is not a repository', async () => {
    const calls: string[][] = []
    const run = vi.fn(async (_cwd: string, args: string[]) => {
      calls.push(args)
      if (args[0] === 'rev-parse') throw new Error('not a repo')
      return ''
    })
    const svc = new WorkspaceGitService(projects(), { gitRun: run as WorkspaceGitServiceOptions['gitRun'] })
    await expect(svc.init('p1')).resolves.toEqual({ ok: true })
    expect(calls).toContainEqual(['init'])
  })
})
