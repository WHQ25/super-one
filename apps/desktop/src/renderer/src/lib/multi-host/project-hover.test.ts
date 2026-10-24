import { describe, expect, it } from 'vitest'
import {
  knownSessionCount,
  projectHoverFolders,
  projectHostPath,
  projectRepoLink,
  repoIdentityFor,
  resetRepoIdentityCache,
} from './project-hover'

describe('project hover', () => {
  it('turns a github origin into a link and keeps other hosts plain', () => {
    expect(projectRepoLink('git:git@github.com:Acme/App.git')).toEqual({
      label: 'acme/app',
      href: 'https://github.com/acme/app',
      github: true,
    })
    expect(projectRepoLink('git:https://gitlab.com/acme/app.git')).toEqual({
      label: 'gitlab.com/acme/app',
      href: 'https://gitlab.com/acme/app',
      github: false,
    })
    expect(projectRepoLink('gitdir:/repo/.git')).toBeNull()
    expect(projectRepoLink(null)).toBeNull()
  })

  it('lists the checkout and extra folders, and shows the path when names collide', () => {
    expect(projectHostPath('remote:cli-1:/srv/app')).toBe('/srv/app')
    expect(projectHoverFolders('/Users/a/src/app', ['/Users/a/src/app', '/Users/a/src/ui'])).toEqual([
      { name: 'app', path: '/Users/a/src/app', title: '~/src/app' },
      { name: 'ui', path: '/Users/a/src/ui', title: '~/src/ui' },
    ])
    expect(projectHoverFolders('/srv/app', ['/other/app']).map((folder) => folder.name)).toEqual([
      '/srv/app',
      '/other/app',
    ])
  })

  it('counts only a fully loaded list, and skips hidden sessions', () => {
    expect(knownSessionCount({ loaded: false, hasMore: false, sessions: [] })).toBeNull()
    expect(knownSessionCount({ loaded: true, hasMore: true, sessions: [{}, {}] })).toBeNull()
    expect(knownSessionCount({
      loaded: true,
      hasMore: false,
      sessions: [{}, { isHidden: true }, {}],
    })).toBe(2)
  })

  it('reads the origin from one project list per connection', async () => {
    resetRepoIdentityCache()
    let calls = 0
    const list = async () => {
      calls += 1
      return [{ projectId: 'p1', path: '/src/app', name: 'app', repoIdentity: 'git:https://github.com/acme/app.git' }]
    }
    await expect(repoIdentityFor('local', 'p1', '/src/app', list)).resolves.toBe('git:https://github.com/acme/app.git')
    await expect(repoIdentityFor('local', 'missing', '/gone', list)).resolves.toBeNull()
    expect(calls).toBe(1)
  })
})
