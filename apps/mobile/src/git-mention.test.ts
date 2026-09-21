import { describe, expect, it, vi } from 'vitest'
import {
  gitEmptyLabel, gitKindItems, gitRefItems, isGitMentionQuery, parseGitMentionQuery, requestGitMentionRefs,
} from './git-mention'
import { buildMentionRows, groupMentionRows, mentionGroupKey } from './mention-rows'
import { mentionTokenFromItem } from './mention-selection'
import { serializeMentionDocument } from './mention-document'
import { extractMentionQuery } from './mentions'

describe('git mention query', () => {
  it('opens on the portal keyword and survives spaces in the draft', () => {
    expect(isGitMentionQuery('git')).toBe(true)
    expect(isGitMentionQuery('github')).toBe(false)
    expect(extractMentionQuery('see @git commit fix auth', 'see @git commit fix auth'.length))
      .toEqual({ atPosition: 4, query: 'git commit fix auth' })
    expect(extractMentionQuery('see @ git', 'see @ git'.length)).toBeNull()
  })

  it('walks the three phases as the user types', () => {
    expect(parseGitMentionQuery('git')?.phase).toBe('pick-kind')
    expect(parseGitMentionQuery('git tag ')?.phase).toBe('need-query')
    expect(parseGitMentionQuery('git commit fix auth')).toMatchObject({ phase: 'search', refKind: 'commit', refQuery: 'fix auth' })
  })
})

describe('kind choices', () => {
  it('navigate rather than mention, and say where they go', () => {
    const items = gitKindItems('git', '')
    expect(items.map((item) => item.label)).toEqual(['Branch', 'Commit', 'Worktree', 'Tag'])
    expect(items[0]).toMatchObject({ kind: 'git-kind', path: 'branch', navigateTo: 'git branch ' })
    expect(gitKindItems('git', 'wo').map((item) => item.path)).toEqual(['worktree'])
    expect(gitKindItems('gh', '').map((item) => item.navigateTo)).toEqual(['gh issue ', 'gh pr '])
  })
})

describe('ref rows', () => {
  const refs = [
    { kind: 'branch' as const, id: 'main', label: 'main', detail: 'fix: popup', current: true },
    { kind: 'commit' as const, id: 'f14bf73fabcdef0123456789', label: 'f14bf73', detail: 'fix(computer-use): overlay', author: 'Hangqi', date: new Date(Date.now() - 3 * 3_600_000).toISOString() },
  ]

  it('carries the exact ref in the path and the short form as the label', () => {
    const [branch, commit] = gitRefItems(refs, '')
    expect(branch).toMatchObject({ kind: 'git-ref', path: 'branch:main', label: 'main', description: 'fix: popup', badge: 'current' })
    // A commit is picked by its subject; the sha rides beside it.
    expect(commit).toMatchObject({ path: 'commit:f14bf73fabcdef0123456789', label: 'fix(computer-use): overlay', description: 'f14bf73', rootPath: 'Hangqi · 3h ago' })
  })

  it('highlights the typed filter wherever it matched — name, subject or sha', () => {
    expect(gitRefItems(refs, 'ai')[0]?.labelIndices).toEqual([1, 2])
    const [, bySubject] = gitRefItems(refs, 'overlay')
    expect(bySubject?.labelIndices).toEqual([19, 20, 21, 22, 23, 24, 25])
    const [, bySha] = gitRefItems(refs, 'f14b')
    expect(bySha?.descriptionIndices).toEqual([0, 1, 2, 3])
  })

  it('groups by ref kind in the desktop order and shapes one-line rows', () => {
    const rows = buildMentionRows('', { remote: gitRefItems(refs, ''), agentProfiles: [], scoped: true })
    expect(rows.map((row) => mentionGroupKey(row.item))).toEqual(['git-branch', 'git-commit'])
    expect(groupMentionRows(rows).map((group) => group.key)).toEqual(['git-branch', 'git-commit'])
    expect(rows[0]).toMatchObject({ inline: 'fix: popup', badge: { text: 'current', tone: 'muted' } })
    expect(rows[1]).toMatchObject({ label: 'fix(computer-use): overlay', inline: 'f14bf73', trailing: 'Hangqi · 3h ago' })
  })

  it('becomes a git chip that serializes to the desktop tag', () => {
    const token = mentionTokenFromItem(gitRefItems(refs, '')[1]!)
    // The chip is the subject a person recognises; the tag still carries the full sha.
    expect(token).toEqual({ kind: 'git', value: 'commit:f14bf73fabcdef0123456789', displayName: 'fix(computer-use): overlay' })
    expect(serializeMentionDocument([{ text: 'see' }, { mention: token! }]))
      .toBe('see <superone-git><kind>commit</kind><name>fix(computer-use): overlay</name><id>f14bf73fabcdef0123456789</id></superone-git>')
  })
})

describe('portal availability', () => {
  it('is disabled with a reason outside a repository, enterable otherwise', () => {
    const off = buildMentionRows('gi', { remote: [], agentProfiles: [], gitAvailability: { repo: 'not-repo', github: false } })
      .find((row) => row.item.kind === 'git-portal')
    expect(off).toMatchObject({ disabled: true, hint: 'Not a git repository' })
    expect(off?.item.navigateTo).toBeUndefined()
    const on = buildMentionRows('gi', { remote: [], agentProfiles: [] }).find((row) => row.item.kind === 'git-portal')
    expect(on).toMatchObject({ inline: '@git' })
  })

  it('greys out only the GitHub portal when gh cannot be used', () => {
    const rows = buildMentionRows('g', { remote: [], agentProfiles: [], gitAvailability: { repo: 'ready', github: false } })
      .filter((row) => row.item.kind === 'git-portal')
    expect(Object.fromEntries(rows.map((row) => [row.item.path, row.disabled ?? false]))).toEqual({ git: false, gh: true })
    expect(rows.find((row) => row.item.path === 'gh')).toMatchObject({ hint: 'Needs the gh CLI signed in and a GitHub remote' })
    const pending = buildMentionRows('gh', { remote: [], agentProfiles: [] }).find((row) => row.item.path === 'gh')
    expect(pending).toMatchObject({ inline: '@gh', item: { navigateTo: 'gh ' } })
    const ready = buildMentionRows('gh', { remote: [], agentProfiles: [], gitAvailability: { repo: 'ready', github: true } })
      .find((row) => row.item.path === 'gh')
    expect(ready).toMatchObject({ inline: '@gh', item: { navigateTo: 'gh ' } })
  })
})

describe('host request and empty copy', () => {
  it('asks the host with the session project and surfaces its answer', async () => {
    const request = vi.fn(async () => ({ ok: true, refs: [] }))
    await expect(requestGitMentionRefs({ request }, '/work/super-one', 'tag', 'v0')).resolves.toEqual({ ok: true, refs: [] })
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ type: 'list_git_mention_refs', projectPath: '/work/super-one', kind: 'tag', query: 'v0' }))
    const failing = vi.fn(async () => ({ error: 'offline' }))
    await expect(requestGitMentionRefs({ request: failing }, '/p', 'tag', '')).rejects.toThrow('offline')
  })

  it('names the phase, or the reason the host could not answer', () => {
    expect(gitEmptyLabel(parseGitMentionQuery('git')!)).toBe('No matching ref type')
    expect(gitEmptyLabel(parseGitMentionQuery('git branch x')!)).toBe('No matching branches')
    expect(gitEmptyLabel(parseGitMentionQuery('git tag x')!)).toBe('No matching tags')
    expect(gitEmptyLabel(parseGitMentionQuery('git tag x')!, { ok: false, reason: 'not-repo' })).toBe('Not a git repository')
  })
})

describe('GitHub rows', () => {
  const issue = { kind: 'issue' as const, id: '23', label: '#23', detail: 'Crash on start', author: 'me', state: 'open' as const }
  it('read as `#23 title` with the number first and both parts highlightable', () => {
    const [row] = gitRefItems([issue], '')
    expect(row).toMatchObject({ label: '#23 Crash on start', description: '', badge: 'open', rootPath: 'me' })
    expect(gitRefItems([issue], '2')[0]?.labelIndices).toEqual([1])
    // "Crash" starts 4 characters in, after `#23 `.
    expect(gitRefItems([issue], 'cr')[0]?.labelIndices).toEqual([4, 5])
  })
})
