import { describe, expect, it } from 'vitest'
import { normalizeGitRemoteUrl, repoIdentityRemote } from './git-remote-url'

describe('normalizeGitRemoteUrl', () => {
  it('matches one repository across ssh, scp-like and https remotes', () => {
    for (const url of [
      'git@github.com:Acme/App.git',
      'https://github.com/acme/app',
      'ssh://git@GitHub.com:22/acme/app.git',
      'https://user@github.com:443/acme/app/',
    ]) {
      expect(normalizeGitRemoteUrl(url)).toBe('github.com/acme/app')
    }
  })

  it('keeps a non-default port, which names another server', () => {
    expect(normalizeGitRemoteUrl('ssh://git@git.example.com:2222/team/app.git')).toBe('git.example.com:2222/team/app')
    expect(normalizeGitRemoteUrl('https://git.example.com:8443/team/app')).toBe('git.example.com:8443/team/app')
    expect(normalizeGitRemoteUrl('https://git.example.com:8443/team/app'))
      .not.toBe(normalizeGitRemoteUrl('https://git.example.com/team/app'))
    expect(normalizeGitRemoteUrl('git://git.example.com:9418/team/app')).toBe('git.example.com/team/app')
  })

  it('keeps path case on hosts that may tell repositories apart by it', () => {
    expect(normalizeGitRemoteUrl('https://Git.Example.com/Team/App.git')).toBe('git.example.com/Team/App')
    expect(normalizeGitRemoteUrl('https://git.example.com/Team/App'))
      .not.toBe(normalizeGitRemoteUrl('https://git.example.com/team/app'))
    expect(normalizeGitRemoteUrl('https://GitLab.com/Group/Sub/Project')).toBe('gitlab.com/group/sub/project')
  })

  it('rejects what is not a remote URL', () => {
    expect(normalizeGitRemoteUrl('')).toBeNull()
    expect(normalizeGitRemoteUrl('/srv/repos/app.git')).toBeNull()
    expect(normalizeGitRemoteUrl('https://example.com/')).toBeNull()
  })

  it('reads the remote of a git project identity only', () => {
    expect(repoIdentityRemote('git:git@github.com:acme/app.git')).toBe('github.com/acme/app')
    expect(repoIdentityRemote('path:/Users/a/app')).toBeNull()
  })
})
