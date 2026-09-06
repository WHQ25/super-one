import { describe, expect, it } from 'vitest'
import type { GithubRepoHit } from '@superone/shared/agent-types'
import {
  addProjectPlaceholder,
  addProjectStepTitle,
  directoryRows,
  githubRows,
  githubSearchRows,
  projectRows,
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
    expect(addProjectPlaceholder({ kind: 'source' })).toBe('Type a path, or pick a source...')
    expect(addProjectPlaceholder({ kind: 'repo', source: 'url' })).toBe('https://github.com/owner/repo.git')
  })
})

describe('source rows', () => {
  it('offers all three sources when nothing is typed', () => {
    expect(sourceRows('', null).map((row) => row.key)).toEqual(['local', 'github', 'url'])
  })

  it('floats the detected source first without hiding the others', () => {
    const rows = sourceRows('~/Developer', 'local')
    expect(rows[0]!.key).toBe('local')
    expect(rows).toHaveLength(3)
  })

  it('keeps every source visible for text that is content, not a label search', () => {
    // A half-typed URL must not filter GitHub / Git URL out of reach.
    expect(sourceRows('git@github.com:o/r', null)).toHaveLength(3)
  })

  it('fuzzy-filters when the text is a plain label search', () => {
    expect(sourceRows('hub', null).map((row) => row.key)).toEqual(['github'])
    expect(sourceRows('zzz', null)).toEqual([])
  })
})

describe('project rows', () => {
  const projects = [
    { path: '/w/super-one', name: 'super-one' },
    { path: '/w/design-system', name: 'design-system' },
  ]

  it('lists every project with its path as the subtitle', () => {
    expect(projectRows(projects, '')).toEqual([
      { key: '/w/super-one', icon: 'project', label: 'super-one', subtitle: '/w/super-one' },
      { key: '/w/design-system', icon: 'project', label: 'design-system', subtitle: '/w/design-system' },
    ])
  })

  it('ranks fuzzy hits and drops the rest', () => {
    expect(projectRows(projects, 'design').map((row) => row.label)).toEqual(['design-system'])
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
