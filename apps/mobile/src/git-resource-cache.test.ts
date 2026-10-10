import { resolveTestProject } from './project-rpc.test-fixtures'
import { describe, expect, it, vi } from 'vitest'
import { invalidateGitResources, requestGitResource } from './git-resource-cache'

describe('project git freshness', () => {
  it('shares pending reads, expires git before branches, and invalidates the changed project', async () => {
    vi.useFakeTimers()
    try {
      const client = { resolveProject: resolveTestProject, rpc: vi.fn(async () => ({ branch: 'main', branches: ['main'] })) }
      await Promise.all([requestGitResource(client, 'git.status', '/a'), requestGitResource(client, 'git.status', '/a')])
      await requestGitResource(client, 'git.branches', '/a')
      await requestGitResource(client, 'git.status', '/b')
      expect(client.rpc).toHaveBeenCalledTimes(3)
      vi.advanceTimersByTime(5_001)
      await requestGitResource(client, 'git.status', '/a')
      await requestGitResource(client, 'git.branches', '/a')
      expect(client.rpc).toHaveBeenCalledTimes(4)
      invalidateGitResources(client, '/a')
      await requestGitResource(client, 'git.branches', '/a')
      expect(client.rpc).toHaveBeenCalledTimes(5)
      vi.advanceTimersByTime(30_001)
      await requestGitResource(client, 'git.branches', '/a')
      expect(client.rpc).toHaveBeenCalledTimes(6)
    } finally { vi.useRealTimers() }
  })
  it('does not let a late invalidated response replace fresh data or cache errors', async () => {
    let resolve!: (value: unknown) => void
    const client = { resolveProject: resolveTestProject, rpc: vi.fn().mockImplementationOnce(() => new Promise(r => { resolve = r })).mockResolvedValue({ branch: 'new' }) }
    const old = requestGitResource(client, 'git.status', '/a')
    await Promise.resolve()
    invalidateGitResources(client, '/a')
    await requestGitResource(client, 'git.status', '/a')
    resolve({ branch: 'old' }); await old
    expect(await requestGitResource(client, 'git.status', '/a')).toMatchObject({ branch: 'new' })
    client.rpc.mockResolvedValueOnce({ error: 'offline' })
    invalidateGitResources(client, '/a')
    await expect(requestGitResource(client, 'git.status', '/a')).rejects.toThrow('offline')
    expect(await requestGitResource(client, 'git.status', '/a')).toMatchObject({ branch: 'new' })
  })
  it('preserves detached commit labels and file counts from native git status', async () => {
    const client = { resolveProject: resolveTestProject, rpc: vi.fn(async () => ({ branch: null, head: 'abc1234', ahead: 2, behind: 1, porcelain: ' M first.ts\n?? second.ts\n', insertions: 5, deletions: 3 })) }
    expect(await requestGitResource(client, 'git.status', '/a')).toEqual({ branch: null, head: 'abc1234', ahead: 2, behind: 1, dirty: { files: 2, insertions: 5, deletions: 3 } })
    expect(client.rpc).toHaveBeenCalledWith('git.status', { projectId: 'p' }, { environmentId: 'desktop' })
  })
})
