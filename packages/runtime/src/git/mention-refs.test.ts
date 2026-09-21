import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gitRun } from './run'
import { listGitMentionRefs, probeGitMentionCapabilities } from './mention-refs'

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

let repo = ''
let worktree = ''
let firstSha = ''
let secondSha = ''

beforeAll(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'mention-refs-')))
  git(repo, 'init', '-b', 'main')
  git(repo, 'config', 'user.email', 'test@example.com')
  git(repo, 'config', 'user.name', 'Test')
  writeFileSync(join(repo, 'a.txt'), 'a\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-m', 'feat: first commit')
  firstSha = git(repo, 'rev-parse', 'HEAD')
  git(repo, 'tag', '-a', 'v0.1.0', '-m', 'release 0.1.0')
  writeFileSync(join(repo, 'b.txt'), 'b\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-m', 'fix(popup): second commit')
  secondSha = git(repo, 'rev-parse', 'HEAD')
  git(repo, 'branch', 'feat/mention')
  worktree = join(repo, '..', `mention-refs-wt-${process.pid}`)
  git(repo, 'worktree', 'add', worktree, 'feat/mention')
})

afterAll(() => {
  rmSync(worktree, { recursive: true, force: true })
  rmSync(repo, { recursive: true, force: true })
})

const runIn = (cwd: string) => (args: string[]) => gitRun(cwd, args)

describe('listGitMentionRefs', () => {
  it('lists branches with the checked-out one first', async () => {
    const result = await listGitMentionRefs('branch', '', runIn(repo))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.refs.map((r) => r.id)).toEqual(['main', 'feat/mention'])
    expect(result.refs[0]).toMatchObject({ kind: 'branch', current: true, detail: 'fix(popup): second commit' })
    expect(result.refs[1]?.current).toBe(false)
  })

  it('filters branches by fuzzy name', async () => {
    const result = await listGitMentionRefs('branch', 'MENT', runIn(repo))
    expect(result.ok && result.refs.map((r) => r.id)).toEqual(['feat/mention'])
    const scattered = await listGitMentionRefs('branch', 'ftmn', runIn(repo))
    expect(scattered.ok && scattered.refs.map((r) => r.id)).toEqual(['feat/mention'])
  })

  it('lists recent commits newest first with short labels', async () => {
    const result = await listGitMentionRefs('commit', '', runIn(repo))
    expect(result.ok && result.refs.map((r) => r.id)).toEqual([secondSha, firstSha])
    expect(result.ok && result.refs[0]).toMatchObject({
      label: secondSha.slice(0, 7),
      detail: 'fix(popup): second commit',
      author: 'Test',
    })
  })

  it('searches commits by fuzzy subject and by sha prefix', async () => {
    const byMessage = await listGitMentionRefs('commit', 'FIRST', runIn(repo))
    expect(byMessage.ok && byMessage.refs.map((r) => r.id)).toEqual([firstSha])
    // Scattered letters of "fix(popup): second commit" — substring grep would miss this.
    const fuzzy = await listGitMentionRefs('commit', 'fxpscnd', runIn(repo))
    expect(fuzzy.ok && fuzzy.refs.map((r) => r.id)).toEqual([secondSha])
    const bySha = await listGitMentionRefs('commit', firstSha.slice(0, 6), runIn(repo))
    expect(bySha.ok && bySha.refs.map((r) => r.id)).toEqual([firstSha])
  })

  it('lists tags with their message', async () => {
    const result = await listGitMentionRefs('tag', '', runIn(repo))
    expect(result.ok && result.refs).toEqual([
      expect.objectContaining({ kind: 'tag', id: 'v0.1.0', label: 'v0.1.0', detail: 'release 0.1.0' }),
    ])
    const miss = await listGitMentionRefs('tag', 'v9', runIn(repo))
    expect(miss.ok && miss.refs).toEqual([])
  })

  it('lists worktrees and marks the one we run in', async () => {
    const fromMain = await listGitMentionRefs('worktree', '', runIn(repo))
    expect(fromMain.ok && fromMain.refs.map((r) => [r.label, r.current])).toEqual([
      ['main', true],
      ['feat/mention', false],
    ])
    // Fuzzy over the branch name; the checkout path is not searched.
    const fromWt = await listGitMentionRefs('worktree', 'ftmn', runIn(worktree))
    expect(fromWt.ok && fromWt.refs).toEqual([
      expect.objectContaining({ kind: 'worktree', label: 'feat/mention', current: true, id: realpathSync(worktree) }),
    ])
  })

  it('reports a non-repository folder', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mention-refs-plain-'))
    try {
      const result = await listGitMentionRefs('branch', '', runIn(dir))
      expect(result).toEqual({ ok: false, reason: 'not-repo' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

/** A `gh` that answers from a canned issue / PR table, recording what it was asked. */
function fakeGh(items: Array<Record<string, unknown>>) {
  const calls: string[][] = []
  const run = async (args: string[]) => {
    calls.push(args)
    if (args[0] === 'repo') return JSON.stringify({ nameWithOwner: 'o/r' })
    const [, verb, arg] = args
    if (verb === 'view') {
      const hit = items.find((i) => String(i.number) === arg)
      if (!hit) throw Object.assign(new Error('not found'), { stderr: 'GraphQL: Could not resolve' })
      return JSON.stringify(hit)
    }
    const search = args[args.indexOf('--search') + 1]
    const state = args[args.indexOf('--state') + 1]
    return JSON.stringify(items.filter((i) =>
      (state === 'all' || String(i.state).toLowerCase() === 'open')
      && (!args.includes('--search') || String(i.title).toLowerCase().includes(search.toLowerCase())),
    ))
  }
  return { run, calls }
}

const ISSUES = [
  { number: 23, title: 'Crash on start', state: 'OPEN', author: { login: 'me' }, updatedAt: '2026-09-01T00:00:00Z' },
  { number: 7, title: 'Old crash report', state: 'CLOSED', author: { login: 'you' }, updatedAt: '2026-01-01T00:00:00Z' },
]

describe('GitHub kinds through gh', () => {
  it('lists open items by default and searches all states with a query', async () => {
    const gh = fakeGh(ISSUES)
    const open = await listGitMentionRefs('issue', '', { git: runIn('/'), gh: gh.run })
    expect(open.ok && open.refs).toEqual([
      { kind: 'issue', id: '23', label: '#23', detail: 'Crash on start', date: '2026-09-01T00:00:00Z', author: 'me', state: 'open', host: 'github' },
    ])
    expect(gh.calls[0]).toEqual(['issue', 'list', '--limit', '50', '--json', 'number,title,state,author,updatedAt', '--state', 'open'])

    const searched = await listGitMentionRefs('issue', 'crash', { git: runIn('/'), gh: gh.run })
    expect(searched.ok && searched.refs.map((r) => [r.id, r.state])).toEqual([['23', 'open'], ['7', 'closed']])
    expect(gh.calls[1]).toContain('--search')
  })

  it('puts the exact number first, with or without #', async () => {
    const gh = fakeGh(ISSUES)
    for (const q of ['7', '#7']) {
      const result = await listGitMentionRefs('issue', q, { git: runIn('/'), gh: gh.run })
      expect(result.ok && result.refs.map((r) => r.id)).toEqual(['7'])
    }
    expect(gh.calls.some((c) => c[1] === 'view' && c[2] === '7')).toBe(true)
  })

  it('marks draft and merged pull requests', async () => {
    const gh = fakeGh([
      { number: 1, title: 'wip', state: 'OPEN', isDraft: true },
      { number: 2, title: 'done', state: 'MERGED' },
    ])
    const result = await listGitMentionRefs('pr', 'w', { git: runIn('/'), gh: gh.run })
    expect(result.ok && result.refs.map((r) => r.state)).toEqual(['draft'])
    expect(gh.calls[0]?.[5]).toBe('number,title,state,author,updatedAt,isDraft')
  })

  it('reports gh as unavailable when no runner or no binary', async () => {
    expect(await listGitMentionRefs('pr', '', runIn('/'))).toEqual({ ok: false, reason: 'gh-unavailable' })
    const missing = async () => { throw Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' }) }
    expect(await listGitMentionRefs('pr', '', { git: runIn('/'), gh: missing })).toEqual({ ok: false, reason: 'gh-unavailable' })
    const signedOut = async () => { throw Object.assign(new Error('x'), { stderr: 'To get started with GitHub CLI, please run: gh auth login\nmore' }) }
    expect(await listGitMentionRefs('issue', '', { git: runIn('/'), gh: signedOut })).toEqual({
      ok: false, reason: 'error', error: 'To get started with GitHub CLI, please run: gh auth login',
    })
  })

  it('probes repo and github capabilities as one answer', async () => {
    expect(await probeGitMentionCapabilities({ git: runIn(repo) })).toEqual({ repo: 'ready', github: false })
    expect(await probeGitMentionCapabilities({ git: runIn(repo), gh: fakeGh([]).run })).toEqual({ repo: 'ready', github: true })
    const noRemote = async () => { throw new Error('none of the git remotes configured for this repository point to a known GitHub host') }
    expect(await probeGitMentionCapabilities({ git: runIn(repo), gh: noRemote })).toEqual({ repo: 'ready', github: false })
    const plain = mkdtempSync(join(tmpdir(), 'mention-refs-plain-'))
    try {
      expect(await probeGitMentionCapabilities({ git: runIn(plain), gh: fakeGh([]).run })).toEqual({ repo: 'not-repo', github: false })
    } finally {
      rmSync(plain, { recursive: true, force: true })
    }
  })
})
