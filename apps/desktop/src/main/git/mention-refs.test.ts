import { afterEach, describe, expect, it, vi } from 'vitest'

const gitRun = vi.hoisted(() => vi.fn())
const ghRun = vi.hoisted(() => vi.fn())
vi.mock('../git-run', () => ({
  gitRun,
  ghRun,
}))

import { invalidateLocalGitReads } from './git-read-cache'
import { clearGitHubMentionProbe, resolveGitMentionCapabilities, resolveGitMentionRefs } from './mention-refs'

afterEach(() => {
  gitRun.mockReset()
  ghRun.mockReset()
  invalidateLocalGitReads()
  clearGitHubMentionProbe()
})

describe('resolveGitMentionRefs scan cache', () => {
  it('scans branches once for two needles and again after invalidation', async () => {
    gitRun.mockImplementation(async (_folder: string, args: string[]) => {
      if (args[0] === 'for-each-ref') {
        return 'main\0\0subject\0date\0*\nfeat/popup\0\0subject\0date\0\nmyfeat\0\0subject\0date\0\n'
      }
      return ''
    })
    const prefix = await resolveGitMentionRefs('/repo-scan', 'branch', 'feat')
    const current = await resolveGitMentionRefs('/repo-scan', 'branch', 'main')
    expect(prefix.ok && prefix.refs.map((ref) => ref.id)).toEqual(['feat/popup', 'myfeat'])
    expect(current.ok && current.refs.map((ref) => ref.id)).toEqual(['main'])
    const scans = () => gitRun.mock.calls.filter((call) => call[1]?.[0] === 'for-each-ref')
    expect(scans()).toHaveLength(1)

    invalidateLocalGitReads('/repo-scan')
    await resolveGitMentionRefs('/repo-scan', 'branch', 'feat')
    expect(scans()).toHaveLength(2)
  })

  it('probes gh again when a recheck drops the remembered no', async () => {
    gitRun.mockResolvedValue('.git')
    ghRun.mockRejectedValueOnce(new Error('none of the git remotes configured for this repository point to a known GitHub host'))
    ghRun.mockResolvedValue('{"nameWithOwner":"WHQ25/super-one"}')

    await expect(resolveGitMentionCapabilities('/repo-gh')).resolves.toEqual({ repo: 'ready', github: false })
    await expect(resolveGitMentionCapabilities('/repo-gh')).resolves.toEqual({ repo: 'ready', github: false })
    expect(ghRun).toHaveBeenCalledTimes(1)

    await expect(resolveGitMentionCapabilities('/repo-gh', { refresh: true })).resolves.toEqual({ repo: 'ready', github: true })
    expect(ghRun).toHaveBeenCalledTimes(2)
    expect(ghRun.mock.calls[1]?.[1]).toEqual(['repo', 'view', '--json', 'nameWithOwner'])
  })

  it('does not cache a commit lookup', async () => {
    gitRun.mockResolvedValue('abc1234fffffffffffffffffffffffffffffff\0feat: subject\0Ann\0date\n')
    await resolveGitMentionRefs('/repo-commit', 'commit', 'feat')
    await resolveGitMentionRefs('/repo-commit', 'commit', 'feat')
    expect(gitRun).toHaveBeenCalledTimes(2)
  })
})
