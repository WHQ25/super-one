import { describe, expect, it } from 'vitest'
import { orderDirectSearchGroups, shouldDirectSearch } from './mention-direct-search'
import { fileMentionMatchKey, mentionMatchKey } from './mention-match-tier'

const BASE = [
  'capability', 'agent-profile', 'session-project', 'session',
  'git-kind', 'git-branch', 'git-commit', 'git-worktree', 'git-tag',
  'git-issue', 'git-pr', 'desktop-app', 'agent', 'miniapp', 'mcp:tracker', 'file',
] as const

describe('shouldDirectSearch', () => {
  it('opens for a plain name, including a slash, and stays shut for portals and one letter', () => {
    expect(shouldDirectSearch('main')).toBe(true)
    expect(shouldDirectSearch('ma')).toBe(true)
    expect(shouldDirectSearch('m')).toBe(false)
    expect(shouldDirectSearch('  x ')).toBe(false)
    expect(shouldDirectSearch('src/main')).toBe(true)
    expect(shouldDirectSearch('feat/')).toBe(true)
    expect(shouldDirectSearch('session')).toBe(false)
    expect(shouldDirectSearch('session auth')).toBe(false)
    expect(shouldDirectSearch('git branch')).toBe(false)
    expect(shouldDirectSearch('gh 12')).toBe(false)
  })

  it('treats a portal the host cannot serve as plain text', () => {
    expect(shouldDirectSearch('gh', ['git'])).toBe(true)
    expect(shouldDirectSearch('git', ['git'])).toBe(false)
  })
})

const HEAD = [
  'capability', 'agent-profile', 'session-project',
  'git-kind', 'git-commit', 'git-issue', 'git-pr',
  'desktop-app', 'agent', 'miniapp', 'mcp:tracker',
] as const

describe('orderDirectSearchGroups', () => {
  it('keeps a missing-key tie as branch, worktree, tag, session, file', () => {
    expect(orderDirectSearchGroups(BASE, {})).toEqual([
      ...HEAD,
      'git-branch', 'git-worktree', 'git-tag', 'session', 'file',
    ])
  })

  it('orders the block by the best key and breaks an equal key toward branches', () => {
    const same = mentionMatchKey('feat/x', 'feat')
    expect(orderDirectSearchGroups(BASE, {
      file: same,
      session: same,
      'git-branch': same,
      'git-worktree': same,
      'git-tag': same,
    })).toEqual([
      ...HEAD,
      'git-branch', 'git-worktree', 'git-tag', 'session', 'file',
    ])
  })

  it('puts a whole-segment branch above a prefix directory name and a weaker session', () => {
    expect(orderDirectSearchGroups(BASE, {
      'git-branch': mentionMatchKey('feat/popup', 'feat'),
      file: fileMentionMatchKey('docs/features/', 'feat'),
      session: mentionMatchKey('Refeature the popup', 'feat'),
    }).slice(-5)).toEqual(['git-branch', 'file', 'session', 'git-worktree', 'git-tag'])
    expect(orderDirectSearchGroups(BASE, {
      'git-branch': mentionMatchKey('feat/popup', 'feat'),
      file: fileMentionMatchKey('features', 'feat'),
    }).slice(-5)).toEqual(['git-branch', 'file', 'git-worktree', 'git-tag', 'session'])
  })
})
