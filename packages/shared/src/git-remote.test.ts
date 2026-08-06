import { describe, it, expect } from 'vitest'
import {
  buildGitHubCloneUrl,
  githubOwnerAvatarUrl,
  parseGitHubOwnerSearchQuery,
  parseGitHubRepoInput,
  repoNameFromGitUrl,
  validateCloneRemoteUrl,
} from './git-remote'

describe('GitHub repo shorthand parsing', () => {
  it('accepts owner/repo typed by hand', () => {
    expect(parseGitHubRepoInput('  anthropics/claude-code  ')).toEqual({
      owner: 'anthropics',
      repo: 'claude-code',
    })
  })

  it('accepts a browser URL pasted from the repo page', () => {
    expect(parseGitHubRepoInput('https://github.com/WHQ25/super-one')).toEqual({
      owner: 'WHQ25',
      repo: 'super-one',
    })
  })

  it('accepts an SSH remote and strips the .git suffix', () => {
    expect(parseGitHubRepoInput('git@github.com:WHQ25/super-one.git')).toEqual({
      owner: 'WHQ25',
      repo: 'super-one',
    })
  })

  it('accepts a bare github.com path without a scheme', () => {
    expect(parseGitHubRepoInput('github.com/WHQ25/super-one')).toEqual({
      owner: 'WHQ25',
      repo: 'super-one',
    })
    expect(parseGitHubRepoInput('www.github.com/WHQ25/super-one.git')).toEqual({
      owner: 'WHQ25',
      repo: 'super-one',
    })
  })

  it('keeps only owner/repo when a deep link is pasted', () => {
    expect(parseGitHubRepoInput('https://github.com/vercel/next.js/tree/canary/docs')).toEqual({
      owner: 'vercel',
      repo: 'next.js',
    })
  })

  it('returns null for a non-GitHub URL so the caller falls back to raw clone', () => {
    expect(parseGitHubRepoInput('https://gitlab.com/group/project.git')).toBeNull()
  })

  it('returns null for a bare owner with no repo', () => {
    expect(parseGitHubRepoInput('anthropics')).toBeNull()
  })

  it('builds an https clone URL', () => {
    expect(buildGitHubCloneUrl({ owner: 'WHQ25', repo: 'super-one' })).toBe(
      'https://github.com/WHQ25/super-one.git',
    )
  })

  it('builds the same owner avatar URL marketplace uses', () => {
    expect(githubOwnerAvatarUrl('WHQ25', 80)).toBe('https://github.com/WHQ25.png?size=80')
  })

  it('starts owner search only after a trailing slash', () => {
    expect(parseGitHubOwnerSearchQuery('WHQ25')).toBeNull()
    expect(parseGitHubOwnerSearchQuery('WHQ25/')).toEqual({ owner: 'WHQ25', repoPrefix: '' })
    expect(parseGitHubOwnerSearchQuery('WHQ25/super')).toEqual({
      owner: 'WHQ25',
      repoPrefix: 'super',
    })
    expect(parseGitHubOwnerSearchQuery('https://github.com/WHQ25/super-one')).toBeNull()
    expect(parseGitHubOwnerSearchQuery('github.com/WHQ25/super-one')).toBeNull()
  })
})

describe('destination directory name derivation', () => {
  it('derives the name from an https URL', () => {
    expect(repoNameFromGitUrl('https://github.com/WHQ25/super-one.git')).toBe('super-one')
  })

  it('derives the name from an scp-style remote', () => {
    expect(repoNameFromGitUrl('git@gitlab.com:group/sub/project.git')).toBe('project')
  })

  it('ignores a trailing slash', () => {
    expect(repoNameFromGitUrl('https://github.com/WHQ25/super-one/')).toBe('super-one')
  })

  it('rejects a name that would escape the parent directory', () => {
    expect(repoNameFromGitUrl('https://example.com/repo/..')).toBeNull()
  })

  it('rejects half-typed scheme prefixes that are not yet a repo path', () => {
    expect(repoNameFromGitUrl('https://')).toBeNull()
    expect(repoNameFromGitUrl('https://github.com')).toBeNull()
    expect(repoNameFromGitUrl('https://github.com/')).toBeNull()
  })
})

describe('clone remote URL validation', () => {
  it('accepts https, ssh and scp-style remotes', () => {
    expect(validateCloneRemoteUrl('https://github.com/a/b.git')).toBeNull()
    expect(validateCloneRemoteUrl('ssh://git@github.com/a/b.git')).toBeNull()
    expect(validateCloneRemoteUrl('git@github.com:a/b.git')).toBeNull()
  })

  it('rejects half-typed URLs so auto-detect does not fire mid-keystroke', () => {
    expect(validateCloneRemoteUrl('https://')).not.toBeNull()
    expect(validateCloneRemoteUrl('http://')).not.toBeNull()
    expect(validateCloneRemoteUrl('https://github.com')).not.toBeNull()
    expect(validateCloneRemoteUrl('https://github.com/')).not.toBeNull()
    expect(validateCloneRemoteUrl('git@github.com:')).not.toBeNull()
  })

  it('accepts a host plus at least one path segment', () => {
    expect(validateCloneRemoteUrl('https://example.com/repo.git')).toBeNull()
    expect(validateCloneRemoteUrl('https://gitlab.com/group/project')).toBeNull()
  })

  it('rejects the ext:: transport helper that would execute a shell command', () => {
    expect(validateCloneRemoteUrl('ext::sh -c "touch /tmp/pwned"')).not.toBeNull()
  })

  it('rejects a URL that git would read as a flag', () => {
    expect(validateCloneRemoteUrl('--upload-pack=touch')).not.toBeNull()
  })

  it('rejects a local file path so clone cannot reach arbitrary disk locations', () => {
    expect(validateCloneRemoteUrl('/etc/passwd')).not.toBeNull()
    expect(validateCloneRemoteUrl('file:///etc')).not.toBeNull()
  })

  it('rejects an empty URL', () => {
    expect(validateCloneRemoteUrl('   ')).not.toBeNull()
  })
})
