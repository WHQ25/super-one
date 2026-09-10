import { describe, expect, it } from 'vitest'
import type { GithubRepoHit } from '@superone/shared/agent-types'
import {
  addProjectPlaceholder,
  addProjectStepTitle,
  directoryRows,
  githubRows,
  githubSearchRows,
  sourceRows,
} from './add-project-state'

const repo = (owner: string, name: string, stars: number | null = null): GithubRepoHit => ({
  owner, name, fullName: `${owner}/${name}`, description: null, private: false, stars,
})

describe('add-project step chrome', () => {
  it('names each step the way the desktop dialog does', () => {
    expect(addProjectStepTitle({ kind: 'source' })).toBe('Add Project')
    expect(addProjectStepTitle({ kind: 'browse' })).toBe('Open or Create a Folder')
    expect(addProjectStepTitle({ kind: 'repo', source: 'github' })).toBe('Search GitHub')
    expect(addProjectStepTitle({ kind: 'repo', source: 'url' })).toBe('Enter a Git URL')
    expect(addProjectPlaceholder({ kind: 'repo', source: 'url' })).toBe('https://github.com/owner/repo.git')
    // The source step is a pick, so it has no field to label.
    expect(addProjectPlaceholder({ kind: 'source' })).toBeNull()
  })
})

describe('source rows', () => {
  it('always offers all three sources, in a fixed order', () => {
    expect(sourceRows().map((row) => row.key)).toEqual(['local', 'github', 'url'])
  })

  it('describes each source, since the row is the only thing to go on', () => {
    expect(sourceRows().every((row) => !!row.subtitle && row.prominent)).toBe(true)
  })
})

describe('directory rows', () => {
  const entries = [{ name: 'Developer' }, { name: 'Documents' }, { name: 'Downloads' }]

  it('keys rows by name so navigation appends to the typed prefix', () => {
    expect(directoryRows(entries, '').map((row) => row.key)).toEqual(['Developer', 'Documents', 'Downloads'])
  })

  it('ranks a prefix match above a later subsequence match', () => {
    expect(directoryRows(entries, 'dev')[0]!.label).toBe('Developer')
  })
})

describe('github rows', () => {
  const mine = [repo('me', 'super-one', 1200), repo('me', 'dotfiles'), repo('me', 'design-system')]

  it('matches the repo name alone when no slash was typed', () => {
    expect(githubRows(mine, { query: 'dot' }).map((row) => row.label)).toEqual(['me/dotfiles'])
  })

  it('matches the full name once an owner prefix is in play', () => {
    const rows = githubRows([repo('vercel', 'next.js'), repo('vercel', 'turborepo')], {
      ownerPrefix: { owner: 'vercel', repoPrefix: 'turbo' },
    })
    expect(rows.map((row) => row.label)).toEqual(['vercel/turborepo'])
  })

  it('carries the star count and owner avatar onto the row', () => {
    const row = githubRows(mine, { query: 'super' })[0]!
    expect(row.stars).toBe(1200)
    expect(row.avatarUrl).toContain('me')
  })

  it('drops search hits already listed as the user own repos', () => {
    const hits = [repo('me', 'super-one'), repo('other', 'super-one-fork')]
    expect(githubSearchRows(hits, mine, 'super').map((row) => row.label)).toEqual(['other/super-one-fork'])
  })
})
