import { describe, expect, it, vi } from 'vitest'
import { invalidateGitResources, requestGitResource } from './git-resource-cache'

describe('project git freshness', () => {
  it('shares pending reads, expires git before branches, and invalidates the changed project', async () => {
    vi.useFakeTimers()
    try {
      const client = { request: vi.fn(async () => ({ branch: 'main', branches: ['main'] })) }
      await Promise.all([requestGitResource(client, 'get_git_info', '/a'), requestGitResource(client, 'get_git_info', '/a')])
      await requestGitResource(client, 'get_git_branches', '/a')
      await requestGitResource(client, 'get_git_info', '/b')
      expect(client.request).toHaveBeenCalledTimes(3)
      vi.advanceTimersByTime(5_001)
      await requestGitResource(client, 'get_git_info', '/a')
      await requestGitResource(client, 'get_git_branches', '/a')
      expect(client.request).toHaveBeenCalledTimes(4)
      invalidateGitResources(client, '/a')
      await requestGitResource(client, 'get_git_branches', '/a')
      expect(client.request).toHaveBeenCalledTimes(5)
      vi.advanceTimersByTime(30_001)
      await requestGitResource(client, 'get_git_branches', '/a')
      expect(client.request).toHaveBeenCalledTimes(6)
    } finally { vi.useRealTimers() }
  })
  it('does not let a late invalidated response replace fresh data or cache errors', async () => {
    let resolve!: (value: unknown) => void
    const client = { request: vi.fn().mockImplementationOnce(() => new Promise(r => { resolve = r })).mockResolvedValue({ branch: 'new' }) }
    const old = requestGitResource(client, 'get_git_info', '/a')
    await Promise.resolve()
    invalidateGitResources(client, '/a')
    await requestGitResource(client, 'get_git_info', '/a')
    resolve({ branch: 'old' }); await old
    expect(await requestGitResource(client, 'get_git_info', '/a')).toEqual({ branch: 'new' })
    client.request.mockResolvedValueOnce({ error: 'offline' })
    invalidateGitResources(client, '/a')
    await expect(requestGitResource(client, 'get_git_info', '/a')).rejects.toThrow('offline')
    expect(await requestGitResource(client, 'get_git_info', '/a')).toEqual({ branch: 'new' })
  })
})
