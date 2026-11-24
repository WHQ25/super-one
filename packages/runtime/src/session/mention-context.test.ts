import { describe, expect, it, vi } from 'vitest'
import {
  buildMentionForkPreamble,
  enrichMentionContext,
  extractGitHubMentionTargets,
  extractSessionMentionIds,
  extractSessionMentionTargets,
  hasMentionContextTargets,
} from './mention-context'

describe('mention-context', () => {
  it('detects and deduplicates GitHub and session mention targets', () => {
    const text = [
      'Check <superone-github><kind>issue</kind><name>#23 Crash</name><id>23</id></superone-github>',
      'and <superone-github><kind>issue</kind><name>#23 Crash</name><id>23</id></superone-github>',
      'and <superone-github><kind>pr</kind><name>#45 Fix</name><id>45</id></superone-github>',
      'and <superone-git><kind>commit</kind><name>abc1234</name><id>abc1234</id></superone-git>',
      'with <superone-session><title>Prior</title><sessionId>s-1</sessionId></superone-session>',
      'and <superone-session><title>Self</title><sessionId>s-self</sessionId></superone-session>',
    ].join(' ')

    expect(hasMentionContextTargets(text)).toBe(true)
    expect(hasMentionContextTargets('plain text')).toBe(false)
    expect(extractGitHubMentionTargets(text)).toEqual([
      { kind: 'issue', id: '23' },
      { kind: 'pr', id: '45' },
    ])
    expect(extractSessionMentionIds(text, 's-self')).toEqual(['s-1'])
  })

  it('enriches GitHub issue and PR details with bounded comments and files', async () => {
    const gh = vi.fn(async (args: string[]) => {
      if (args[0] === 'issue') {
        return JSON.stringify({
          number: 23,
          title: 'Crash on startup',
          state: 'OPEN',
          author: { login: 'alice' },
          labels: [{ name: 'bug' }, { name: 'p1' }],
          assignees: [{ login: 'bob' }],
          milestone: { title: 'v1.2' },
          updatedAt: '2026-11-23T10:00:00Z',
          url: 'https://github.com/org/repo/issues/23',
          body: 'Steps to reproduce:\n1. Open app',
          comments: Array.from({ length: 10 }, (_, i) => ({
            author: { login: `user${i}` },
            createdAt: `2026-11-23T10:0${i}:00Z`,
            body: `Comment ${i}`,
          })),
        })
      }
      return JSON.stringify({
        number: 45,
        title: 'Fix startup crash',
        state: 'OPEN',
        isDraft: true,
        author: { login: 'bob' },
        baseRefName: 'main',
        headRefName: 'fix/crash',
        labels: [{ name: 'fix' }],
        reviewDecision: 'CHANGES_REQUESTED',
        mergeable: 'MERGEABLE',
        additions: 42,
        deletions: 7,
        changedFiles: 2,
        url: 'https://github.com/org/repo/pull/45',
        body: 'Fixes #23',
        files: [
          { path: 'src/index.ts', additions: 40, deletions: 5 },
          { path: 'src/index.test.ts', additions: 2, deletions: 2 },
        ],
        statusCheckRollup: [
          { name: 'typecheck', conclusion: 'SUCCESS' },
          { name: 'unit', conclusion: 'FAILURE' },
          { name: 'lint', status: 'IN_PROGRESS' },
        ],
        comments: [{ author: { login: 'carol' }, createdAt: '2026-11-23T11:00:00Z', body: 'Looks close' }],
        reviews: [{ author: { login: 'alice' }, state: 'CHANGES_REQUESTED', submittedAt: '2026-11-23T11:30:00Z', body: 'Add a test' }],
      })
    })

    const text = 'Look at <superone-github><kind>issue</kind><name>#23</name><id>23</id></superone-github> and <superone-github><kind>pr</kind><name>#45</name><id>45</id></superone-github>'
    const enriched = await enrichMentionContext(text, { gh })

    expect(enriched).toContain('<superone-github-context>')
    expect(enriched).toContain('### Issue #23: Crash on startup')
    expect(enriched).toContain('labels: bug, p1')
    expect(enriched).toContain('Recent comments (last 8 of 10):')
    expect(enriched).not.toContain('Comment 0\n')
    expect(enriched).toContain('Comment 9')

    expect(enriched).toContain('### PR #45: Fix startup crash')
    expect(enriched).toContain('state: DRAFT · branches: main <- fix/crash')
    expect(enriched).toContain('checks: 1 passed, 1 pending, 1 failed (unit)')
    expect(enriched).toContain('- src/index.ts (+40/-5)')
    expect(enriched).toContain('[@alice · review:CHANGES_REQUESTED · 2026-11-23T11:30:00Z]')
  })

  it('enriches mentioned session with meta and recent transcript blocks', async () => {
    const readSession = vi.fn(async (id: string) => ({
      sessionId: id,
      title: 'Auth refactor',
      harness: 'claude',
      model: 'claude-sonnet-4-6',
      branch: 'feat/auth',
      lastActiveAt: '2026-11-23T12:00:00Z',
      messageCount: 2,
      tags: ['auth', 'refactor'],
      messages: [
        {
          id: 'm1',
          role: 'user' as const,
          status: 'complete' as const,
          providerId: 'claude',
          content: [{ type: 'text' as const, text: 'Refactor token refresh' }],
          createdAt: '2026-11-23T11:55:00Z',
        },
        {
          id: 'm2',
          role: 'assistant' as const,
          status: 'complete' as const,
          providerId: 'claude',
          content: [
            { type: 'tool_use' as const, toolUseId: 't1', toolName: 'Edit', input: '{}' },
            { type: 'text' as const, text: 'Updated refreshToken() in auth.ts' },
          ],
          createdAt: '2026-11-23T11:56:00Z',
        },
      ],
    }))

    const text = 'Continue <superone-session><title>Auth refactor</title><sessionId>s-auth</sessionId></superone-session>'
    const enriched = await enrichMentionContext(text, { readSession })

    expect(enriched).toContain('<superone-session-context>')
    expect(enriched).toContain('### Session "Auth refactor" (sessionId: s-auth)')
    expect(enriched).toContain('harness: claude · model: claude-sonnet-4-6 · branch: feat/auth · messages: 2')
    expect(enriched).toContain('tags: auth, refactor')
    expect(enriched).toContain('Refactor token refresh')
    expect(enriched).toContain('Updated refreshToken() in auth.ts')
    expect(enriched).toContain('session_read')
  })

  it('never throws when gh or session reader fails', async () => {
    const text = 'Check <superone-github><kind>issue</kind><name>#99</name><id>99</id></superone-github> and <superone-session><title>Missing</title><sessionId>missing</sessionId></superone-session>'
    const enriched = await enrichMentionContext(text, {
      gh: async () => { throw new Error('gh not found') },
      readSession: async () => { throw new Error('db error') },
    })
    expect(enriched).toBe(text)
  })

  it('truncates pre-fetched session context at upToMessageId and includes cutoff guidance', async () => {
    const readSession = vi.fn(async () => ({
      sessionId: 's-src',
      title: 'Feature work',
      harness: 'acp-antigravity',
      messageCount: 4,
      messages: [
        { id: 'u1', role: 'user' as const, status: 'complete' as const, providerId: 'acp-antigravity', content: [{ type: 'text' as const, text: 'Step 1' }], createdAt: '2026-11-23T11:50:00Z' },
        { id: 'a1', role: 'assistant' as const, status: 'complete' as const, providerId: 'acp-antigravity', content: [{ type: 'text' as const, text: 'Done 1' }], createdAt: '2026-11-23T11:51:00Z' },
        { id: 'u2', role: 'user' as const, status: 'complete' as const, providerId: 'acp-antigravity', content: [{ type: 'text' as const, text: 'Future secret step' }], createdAt: '2026-11-23T11:52:00Z' },
        { id: 'a2', role: 'assistant' as const, status: 'complete' as const, providerId: 'acp-antigravity', content: [{ type: 'text' as const, text: 'Future secret reply' }], createdAt: '2026-11-23T11:53:00Z' },
      ],
    }))
    const preamble = buildMentionForkPreamble({
      sourceSessionId: 's-src',
      sourceTitle: 'Feature work',
      forkFromMessageId: 'a1',
      mode: 'worktree',
    })
    expect(extractSessionMentionTargets(preamble)).toEqual([{ sessionId: 's-src', upToMessageId: 'a1' }])
    expect(preamble).toContain('Do NOT read, request, or reference any messages or events after messageId "a1"')

    const enriched = await enrichMentionContext(`${preamble}\n\nTry alternative`, { readSession })
    expect(enriched).toContain('Step 1')
    expect(enriched).toContain('Done 1')
    expect(enriched).toContain('messages: 2 · cutoff: upToMessageId=a1')
    expect(enriched).not.toContain('Future secret step')
    expect(enriched).not.toContain('Future secret reply')
  })
})
