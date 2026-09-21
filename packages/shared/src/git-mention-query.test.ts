import { describe, expect, it } from 'vitest'
import {
  enabledGitMentionPortals,
  encodeGitMentionValue,
  gitRefMatchIndices,
  gitRefMatches,
  gitMentionDisplayName,
  isGitMentionQuery,
  listGitRefKindChoices,
  parseGitMentionQuery,
  parseGitMentionValue,
  remainingGitArgumentHint,
} from './git-mention-query'
import { mentionQueryAllowsSpaces } from './session-mention-query'

describe('isGitMentionQuery', () => {
  it('matches git and git with args, keyword directly after @', () => {
    expect(isGitMentionQuery('git')).toBe(true)
    expect(isGitMentionQuery('git ')).toBe(true)
    expect(isGitMentionQuery('Git branch main')).toBe(true)
    expect(isGitMentionQuery(' git')).toBe(false)
    expect(isGitMentionQuery('github')).toBe(false)
    expect(isGitMentionQuery('git:')).toBe(false)
  })

  it('also opens on the gh portal', () => {
    expect(isGitMentionQuery('gh')).toBe(true)
    expect(isGitMentionQuery('gh issue 23')).toBe(true)
    expect(isGitMentionQuery('ghost')).toBe(false)
  })

  it('is plain text for a portal the host cannot serve', () => {
    expect(enabledGitMentionPortals(null)).toEqual(['git', 'gh'])
    expect(enabledGitMentionPortals({ repo: 'unsupported', github: false })).toEqual(['git', 'gh'])
    expect(enabledGitMentionPortals({ repo: 'ready', github: false })).toEqual(['git'])
    expect(enabledGitMentionPortals({ repo: 'not-repo', github: false })).toEqual([])
    const gitOnly = enabledGitMentionPortals({ repo: 'ready', github: false })
    expect(isGitMentionQuery('gh issue 23', gitOnly)).toBe(false)
    expect(isGitMentionQuery('git branch', gitOnly)).toBe(true)
    expect(parseGitMentionQuery('gh issue 23', gitOnly)).toBeNull()
    expect(remainingGitArgumentHint('gh', gitOnly)).toBeNull()
    expect(mentionQueryAllowsSpaces('gh issue 23', { gitPortals: gitOnly })).toBe(false)
    expect(mentionQueryAllowsSpaces('git branch x', { gitPortals: [] })).toBe(false)
  })

  it('exempts the grammar from the single-token space rule', () => {
    expect(mentionQueryAllowsSpaces('git commit fix')).toBe(true)
    expect(mentionQueryAllowsSpaces('src/a b')).toBe(false)
  })
})

describe('parseGitMentionQuery phases', () => {
  it('picks a kind until a known kind is followed by a space', () => {
    expect(parseGitMentionQuery('git')).toMatchObject({ phase: 'pick-kind', kindToken: '' })
    expect(parseGitMentionQuery('git bra')).toMatchObject({ phase: 'pick-kind', kindToken: 'bra' })
    expect(parseGitMentionQuery('git nope ')).toMatchObject({ phase: 'pick-kind', kindToken: 'nope' })
  })

  it('needs a query after the kind, then searches', () => {
    expect(parseGitMentionQuery('git branch ')).toMatchObject({
      phase: 'need-query', refKind: 'branch', refQuery: '', kindNavPrefix: 'git branch ',
    })
    expect(parseGitMentionQuery('git Commit fix auth')).toMatchObject({
      phase: 'search', refKind: 'commit', refQuery: 'fix auth',
    })
  })

  it('returns null outside the grammar', () => {
    expect(parseGitMentionQuery('src/a.ts')).toBeNull()
  })

  it('keeps each portal to its own kinds', () => {
    expect(parseGitMentionQuery('gh issue 23')).toMatchObject({
      portal: 'gh', phase: 'search', refKind: 'issue', refQuery: '23', kindNavPrefix: 'gh issue ',
    })
    expect(parseGitMentionQuery('gh pr ')).toMatchObject({ portal: 'gh', phase: 'need-query', refKind: 'pr' })
    // A kind the other portal owns is just an unknown token here.
    expect(parseGitMentionQuery('gh branch main')).toMatchObject({ portal: 'gh', phase: 'pick-kind', kindToken: 'branch' })
    expect(parseGitMentionQuery('git issue 1')).toMatchObject({ portal: 'git', phase: 'pick-kind', kindToken: 'issue' })
  })
})

describe('kind choices and ghost hint', () => {
  it('filters kinds by substring with highlight indices', () => {
    expect(listGitRefKindChoices('git', '').map((c) => c.kind)).toEqual(['branch', 'commit', 'worktree', 'tag'])
    expect(listGitRefKindChoices('gh', '').map((c) => c.kind)).toEqual(['issue', 'pr'])
    expect(listGitRefKindChoices('gh', 'p')).toEqual([{ kind: 'pr', matchIndices: [0] }])
    expect(listGitRefKindChoices('git', 't')).toEqual([
      { kind: 'commit', matchIndices: [5] },
      { kind: 'worktree', matchIndices: [4] },
      { kind: 'tag', matchIndices: [0] },
    ])
  })

  it('shows the remaining grammar per phase', () => {
    expect(remainingGitArgumentHint('git')).toBe('<branch | commit | worktree | tag> <query>')
    expect(remainingGitArgumentHint('git tag ')).toBe('<query>')
    expect(remainingGitArgumentHint('git tag v1')).toBeNull()
    expect(remainingGitArgumentHint('files')).toBeNull()
    expect(remainingGitArgumentHint('gh')).toBe('<issue | pr> <number | query>')
    expect(remainingGitArgumentHint('gh pr ')).toBe('<number | query>')
  })
})

describe('matching', () => {
  it('matches names and subjects fuzzily; a sha only by prefix', () => {
    const commit = { kind: 'commit' as const, label: 'f14bf73', detail: 'fix(popup): second commit' }
    expect(gitRefMatches(commit, 'fxpscnd')).toBe(true)
    expect(gitRefMatches(commit, 'zzz')).toBe(false)
    expect(gitRefMatchIndices(commit, 'fcm')).toEqual({ label: [], detail: [0, 14, 21] })
    expect(gitRefMatchIndices(commit, 'f14b')).toEqual({ label: [0, 1, 2, 3], detail: [] })
    expect(gitRefMatchIndices(commit, '14b')).toEqual({ label: [], detail: [] })

    const branch = { kind: 'branch' as const, label: 'feat/mention', detail: 'feat: add popup' }
    expect(gitRefMatches(branch, 'ftmn')).toBe(true)
    // The subject beside a branch is not searched, so it never highlights.
    expect(gitRefMatches(branch, 'popup')).toBe(false)
    expect(gitRefMatchIndices(branch, 'ftmn')).toEqual({ label: [0, 3, 5, 7], detail: [] })

    // An issue / PR: the number by prefix (with or without `#`), the title fuzzily.
    const issue = { kind: 'issue' as const, label: '#123', detail: 'Crash on start' }
    expect(gitRefMatchIndices(issue, '12')).toEqual({ label: [1, 2], detail: [] })
    expect(gitRefMatchIndices(issue, '#12')).toEqual({ label: [1, 2], detail: [] })
    expect(gitRefMatchIndices(issue, 'crs')).toEqual({ label: [], detail: [0, 1, 3] })
    expect(gitRefMatches(issue, 'crs')).toBe(true)

    // A worktree is found by its branch name; the path is shown, not searched.
    const worktree = { kind: 'worktree' as const, label: 'main', detail: '/Users/me/.worktrees/app' }
    expect(gitRefMatches(worktree, 'trees/app')).toBe(false)
    expect(gitRefMatches(worktree, 'mn')).toBe(true)
    expect(gitRefMatchIndices(worktree, 'mn')).toEqual({ label: [0, 3], detail: [] })
  })
})

describe('value encoding', () => {
  it('carries the forge for hosted kinds and rejects an unknown one', () => {
    expect(encodeGitMentionValue('issue', '23')).toBe('issue:github:23')
    expect(encodeGitMentionValue('pr', '45', 'github')).toBe('pr:github:45')
    expect(parseGitMentionValue('issue:github:23')).toEqual({ kind: 'issue', id: '23', host: 'github' })
    expect(parseGitMentionValue('issue:23')).toBeNull()
    expect(parseGitMentionValue('issue:gitlab:23')).toBeNull()
    expect(parseGitMentionValue('branch:main')).toEqual({ kind: 'branch', id: 'main' })
  })

  it('round-trips kind and id, keeping colons inside the id', () => {
    const value = encodeGitMentionValue('worktree', 'C:/repo/wt')
    expect(value).toBe('worktree:C:/repo/wt')
    expect(parseGitMentionValue(value)).toEqual({ kind: 'worktree', id: 'C:/repo/wt' })
    expect(parseGitMentionValue('nope:x')).toBeNull()
    expect(parseGitMentionValue('branch:')).toBeNull()
  })

  it('shortens commit shas for display only', () => {
    expect(gitMentionDisplayName({ kind: 'commit', id: 'f14bf73fabcdef', label: 'f14bf73', detail: 'fix: overlay' })).toBe('fix: overlay')
    expect(gitMentionDisplayName({ kind: 'commit', id: 'f14bf73fabcdef', label: 'f14bf73', detail: '' })).toBe('f14bf73')
    expect(gitMentionDisplayName({ kind: 'branch', id: 'main', label: 'main', detail: 'feat: x' })).toBe('main')
    expect(gitMentionDisplayName({ kind: 'pr', id: '45', label: '#45', detail: 'feat: chips' })).toBe('#45 feat: chips')
    expect(gitMentionDisplayName({ kind: 'issue', id: '7', label: '#7', detail: '' })).toBe('#7')
  })
})
