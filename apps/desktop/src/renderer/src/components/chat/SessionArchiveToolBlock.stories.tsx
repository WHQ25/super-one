import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { encode as toonEncode } from '@toon-format/toon'
import {
  SessionArchiveToolBlock,
  type SessionArchiveToolName,
} from './SessionArchiveToolBlock'
import { ToolBlock } from './ToolBlock'

/**
 * SuperOne session archive tool UI — design preview (Storybook only).
 *
 * Label grammar matches agent collab (`chat.toolBlock.collab` / SessionCollabToolBlock):
 * - Streaming: sentence case + …  e.g. "Listing projects…", "Listing sessions…"
 * - Done primary: Title Case noun + past participle (EN) e.g. "Projects Listed", "Conversation Read"
 * - Counts / empty in label or muted summary: "Found 2 hits", "4 sessions" (collab-style)
 * - Header never shows UUIDs; project path only in project_list expand (discovery tool)
 *
 * Wired into ToolBlock; stories remain the design/regression gallery.
 */

function StoryShell({ children, width = 640 }: { children: ReactNode; width?: number }) {
  return (
    <div className="@container space-y-4" style={{ maxWidth: width }}>
      {children}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <div className="space-y-1">{children}</div>
    </section>
  )
}

function Note({ children }: { children: ReactNode }) {
  return <p className="text-xs leading-relaxed text-muted-foreground">{children}</p>
}

function block(
  tool: SessionArchiveToolName,
  params: Record<string, unknown>,
  opts: {
    status?: 'streaming' | 'complete'
    result?: string
    isError?: boolean
    isDenied?: boolean
    allowExpand?: boolean
  } = {},
) {
  return (
    <SessionArchiveToolBlock
      toolName={tool}
      params={params}
      result={opts.result}
      isStreaming={opts.status === 'streaming'}
      isError={opts.isError}
      isDenied={opts.isDenied}
      allowExpand={opts.allowExpand}
    />
  )
}

const PREFIX = 'mcp__superone__'

function collabBlock(
  tool: string,
  input: Record<string, unknown>,
  opts: {
    status?: 'streaming' | 'complete'
    result?: string
    isError?: boolean
    elapsedSeconds?: number
  } = {},
) {
  return (
    <ToolBlock
      toolName={`${PREFIX}${tool}`}
      input={JSON.stringify(input)}
      status={opts.status ?? 'complete'}
      result={opts.result}
      isError={opts.isError}
      elapsedSeconds={opts.elapsedSeconds}
    />
  )
}

function sessionBlock(
  tool: 'session_rename' | 'session_tag' | 'session_tag_list',
  input: Record<string, unknown>,
  opts: { status?: 'streaming' | 'complete'; result?: string; isError?: boolean } = {},
) {
  return (
    <ToolBlock
      toolName={`${PREFIX}${tool}`}
      input={JSON.stringify(input)}
      status={opts.status ?? 'complete'}
      result={opts.result}
      isError={opts.isError}
    />
  )
}

// --- Fixtures (shape aligned with session-archive-tools handlers) ---

const SESSIONS = [
  {
    id: 'a1b2c3d4-1111-4000-8000-aaaaaaaaaaaa',
    title: 'Fix auth middleware refresh',
    harness: 'claude',
    messageCount: 48,
    sizeBytes: 128_400,
    createdAt: '2026-07-20T09:12:00.000Z',
    lastActiveAt: '2026-08-01T10:00:00.000Z',
    pinned: true,
    isSelf: false,
  },
  {
    id: 'b2c3d4e5-2222-4000-8000-bbbbbbbbbbbb',
    title: 'Codex refactor session list',
    harness: 'codex',
    messageCount: 22,
    createdAt: '2026-08-01T11:05:00.000Z',
    lastActiveAt: '2026-08-05T14:30:00.000Z',
    pinned: false,
    isSelf: false,
  },
  {
    id: 'c3d4e5f6-3333-4000-8000-cccccccccccc',
    title: 'Grok design review',
    harness: 'acp',
    acpAgentId: 'grok-build',
    messageCount: 15,
    createdAt: '2026-08-07T16:40:00.000Z',
    lastActiveAt: '2026-08-08T09:00:00.000Z',
    pinned: false,
    isSelf: true,
  },
  {
    id: 'd4e5f6a7-4444-4000-8000-dddddddddddd',
    title: 'Untitled',
    harness: 'claude',
    messageCount: 2,
    createdAt: '2026-06-15T08:00:00.000Z',
    lastActiveAt: '2026-07-01T00:00:00.000Z',
    pinned: false,
    isSelf: false,
  },
]

/** Production list/search return TOON, not JSON. */
const LIST_RESULT_TOON = toonEncode({
  projectPath: '/Users/me/projects/super-one',
  offset: 0,
  limit: 20,
  count: SESSIONS.length,
  sessions: SESSIONS,
})

const LIST_FILTERED_TOON = toonEncode({
  projectPath: '/Users/me/projects/super-one',
  offset: 0,
  limit: 20,
  count: 1,
  sessions: [SESSIONS[0]],
})

const SEARCH_HITS = [
  {
    sessionId: SESSIONS[0].id,
    title: SESSIONS[0].title,
    harness: 'claude',
    messageId: 'msg-user-12',
    role: 'user',
    createdAt: '2026-08-01T10:02:00.000Z',
    snippet: '…help me fix login middleware to support refresh tokens…',
  },
  {
    sessionId: SESSIONS[0].id,
    title: SESSIONS[0].title,
    harness: 'claude',
    messageId: 'msg-asst-13',
    role: 'assistant',
    createdAt: '2026-08-01T10:03:00.000Z',
    snippet: '…added refresh validation in src/auth/middleware.ts…',
  },
]

const SEARCH_RESULT_TOON = toonEncode({
  query: 'auth refresh',
  count: SEARCH_HITS.length,
  hits: SEARCH_HITS,
})

const SEARCH_EMPTY_TOON = toonEncode({
  query: 'zzzz-no-match',
  count: 0,
  hits: [],
})

const READ_USER_RESULT = [
  `# Session ${SESSIONS[0].id} — user`,
  `title: ${SESSIONS[0].title} · harness: claude · messages: 48`,
  'page: 3 · cursor: null · hasMore: false · totalInView: 3',
  '',
  '## [msg-user-10] user · 2026-08-01T09:50:00.000Z',
  'Look at the auth middleware',
  '',
  '## [msg-user-12] user · 2026-08-01T10:02:00.000Z',
  'Help me fix login middleware to support refresh tokens',
  '',
  '## [msg-user-14] user · 2026-08-01T10:10:00.000Z',
  'Also add tests for expiry edge cases',
].join('\n')

const READ_ASSISTANT_RESULT = [
  `# Session ${SESSIONS[0].id} — assistant`,
  `title: ${SESSIONS[0].title} · harness: claude · messages: 48`,
  'page: 1 · cursor: null · hasMore: true · totalInView: 24',
  '',
  '## [msg-asst-13] assistant · 2026-08-01T10:03:00.000Z · tools:2',
  'Added refresh validation in `src/auth/middleware.ts`. Key changes:',
  '',
  '1. Verify refresh token signature',
  '2. Rotate on use',
  '3. Reject expired refresh with 401',
].join('\n')

const READ_TOOLS_RESULT = [
  `# Session ${SESSIONS[0].id} — tools`,
  `title: ${SESSIONS[0].title} · harness: claude · tools on page: 2`,
  'cursor: null · hasMore: false · totalSource: 1',
  '',
  '## message msg-asst-13 · 2 tools',
  '- Read  src/auth/middleware.ts',
  '  toolUseId: toolu_read_01',
  '- Edit  src/auth/middleware.ts',
  '  toolUseId: toolu_edit_01',
].join('\n')

const READ_META_RESULT = JSON.stringify({
  status: 'ok',
  view: 'meta',
  sessionId: SESSIONS[0].id,
  title: SESSIONS[0].title,
  harness: 'claude',
  model: 'claude-opus-4',
  messageCount: 48,
  lastActiveAt: '2026-08-01T10:15:00.000Z',
  pinned: true,
  branch: 'fix/auth-refresh',
  totalCostUsd: 1.24,
  contextTokens: 42000,
})

const READ_TOOL_DETAIL = JSON.stringify({
  status: 'ok',
  view: 'tool_detail',
  sessionId: SESSIONS[0].id,
  tool: {
    toolUseId: 'toolu_edit_01',
    toolName: 'Edit',
    messageId: 'msg-asst-13',
    input: JSON.stringify(
      { file_path: 'src/auth/middleware.ts', old_string: '...', new_string: '...' },
      null,
      2,
    ),
    status: 'complete',
    resultSummary: 'Applied 1 edit to src/auth/middleware.ts',
  },
})

const CLEANUP_HIDDEN = JSON.stringify({
  status: 'ok',
  action: 'hide',
  affected: [
    { id: SESSIONS[3].id, title: SESSIONS[3].title },
    { id: 'eeeeeeee-5555-4000-8000-eeeeeeeeeeee', title: 'Old experiment' },
  ],
  skippedPinned: [{ id: SESSIONS[0].id, title: SESSIONS[0].title }],
  skippedSelf: [],
})

const CLEANUP_DELETED = JSON.stringify({
  status: 'ok',
  action: 'delete',
  deleted: [
    { id: SESSIONS[3].id, title: SESSIONS[3].title },
    { id: 'eeeeeeee-5555-4000-8000-eeeeeeeeeeee', title: 'Old experiment' },
  ],
  skippedPinned: [{ id: SESSIONS[0].id, title: SESSIONS[0].title }],
  skippedSelf: [],
})

const LAUNCHES_ONE = {
  launches: [
    {
      launchId: 'reviewer',
      agentId: 'acp-base',
      name: 'DiffBot',
      role: 'Reviewer',
      summary: 'Review the diff (read-only)',
      task: 'Review the diff and report issues only.',
    },
  ],
}

const LAUNCHES_TWO = {
  launches: [
    {
      launchId: 'alpha',
      agentId: 'claude-base',
      name: 'Alice',
      role: 'Reviewer',
      summary: 'Review focused test failures',
      task: 'Review the focused test failures and report the root cause.',
    },
    {
      launchId: 'beta',
      agentId: 'codex-base',
      name: 'Bob',
      role: 'Implementer',
      summary: 'Implement the approved fix',
      task: 'Implement the approved fix.',
    },
  ],
}

const CRED_A = 's1sc_demo_credential_aaaa'
const CRED_B = 's1sc_demo_credential_bbbb'

const START_RESULT = {
  status: 'started',
  sessionId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  reused: false,
  name: 'DiffBot',
  role: 'Reviewer',
  title: 'DiffBot - Reviewer',
  config: {
    model: 'grok-4.5',
    effort: 'high',
    permissionMode: 'default',
    sandboxMode: 'off',
    cwd: '/Users/me/projects/super-one',
    name: 'DiffBot',
    role: 'Reviewer',
  },
}

const meta: Meta = {
  title: 'Tool UI/SuperOne MCP/Session',
  parameters: { layout: 'padded' },
}

export default meta
type Story = StoryObj

export const Gallery: Story = {
  name: 'Gallery',
  render: () => (
    <StoryShell width={680}>
      <Note>Session archive, lifecycle, and collaboration tools with streaming, complete, denied, and error states.</Note>
      <Section title="session_list (TOON)">
        {block('session_list', {}, { status: 'streaming' })}
        {block('session_list', { harness: 'claude' }, { status: 'streaming' })}
        {block('session_list', {}, { result: LIST_RESULT_TOON })}
        {block('session_list', { query: 'auth' }, { result: LIST_FILTERED_TOON })}
        {block('session_list', {}, {
          isError: true,
          result: JSON.stringify({
            status: 'error',
            message: 'No project path for the current session.',
          }),
        })}
        {block('session_list', {}, { isDenied: true, result: '[denied] User denied permission' })}
      </Section>

      <Section title="session_search (TOON)">
        {block('session_search', { query: 'auth refresh' }, { status: 'streaming' })}
        {block('session_search', { query: 'auth refresh' }, { result: SEARCH_RESULT_TOON })}
        {block('session_search', { query: 'zzzz-no-match' }, { result: SEARCH_EMPTY_TOON })}
        {block('session_search', { query: 'x' }, {
          isError: true,
          result: JSON.stringify({ status: 'error', message: 'query is required' }),
        })}
      </Section>

      <Section title="session_read — views">
        {block('session_read', { sessionId: SESSIONS[0].id, view: 'meta' }, { status: 'streaming' })}
        {block('session_read', { sessionId: SESSIONS[0].id, view: 'meta' }, {
          result: READ_META_RESULT,
        })}
        {block('session_read', { sessionId: SESSIONS[0].id, view: 'user', limit: 20 }, {
          status: 'streaming',
        })}
        {block('session_read', { sessionId: SESSIONS[0].id, view: 'user', limit: 20 }, {
          result: READ_USER_RESULT,
        })}
        {block('session_read', { sessionId: SESSIONS[0].id, view: 'assistant', limit: 10 }, {
          result: READ_ASSISTANT_RESULT,
        })}
        {block('session_read', { sessionId: SESSIONS[0].id, view: 'text' }, {
          result: READ_USER_RESULT.replace('— user', '— text'),
        })}
        {block('session_read', {
          sessionId: SESSIONS[0].id,
          view: 'tools',
          messageId: 'msg-asst-13',
        }, { result: READ_TOOLS_RESULT })}
        {block('session_read', {
          sessionId: SESSIONS[0].id,
          view: 'tool_detail',
          toolUseId: 'toolu_edit_01',
        }, { result: READ_TOOL_DETAIL })}
      </Section>

      <Section title="session_cleanup">
        {block('session_cleanup', { action: 'hide', sessionIds: [SESSIONS[3].id] }, {
          status: 'streaming',
        })}
        {block('session_cleanup', {
          action: 'hide',
          sessionIds: [SESSIONS[3].id, 'eeeeeeee-5555-4000-8000-eeeeeeeeeeee'],
        }, { result: CLEANUP_HIDDEN })}
        {block('session_cleanup', { action: 'delete', sessionIds: [SESSIONS[3].id] }, {
          status: 'streaming',
        })}
        {block('session_cleanup', {
          action: 'delete',
          sessionIds: [SESSIONS[3].id, SESSIONS[1].id],
        }, { result: CLEANUP_DELETED })}
        {block('session_cleanup', { action: 'delete', sessionIds: [SESSIONS[3].id] }, {
          result: JSON.stringify({
            status: 'cancelled',
            action: 'delete',
            message: 'User did not approve session deletion.',
          }),
        })}
        {block('session_cleanup', { action: 'delete', sessionIds: [SESSIONS[3].id] }, {
          result: JSON.stringify({
            status: 'rejected',
            action: 'delete',
            message: 'User did not approve session deletion.',
          }),
        })}
      </Section>

      <Section title="session_rename">
        {sessionBlock('session_rename', { title: 'Tool UI grouping' }, { result: JSON.stringify({ status: 'ok' }) })}
      </Section>
      <Section title="session_tag">
        {sessionBlock('session_tag', { add: ['storybook', 'workflow'] }, { status: 'streaming' })}
        {sessionBlock('session_tag', { remove: ['workflow'] }, { result: JSON.stringify({ action: 'remove', removed: 1 }) })}
        {sessionBlock('session_tag', { add: ['private'] }, { result: '[denied] User denied permission', isError: true })}
      </Section>
      <Section title="session_tag_list">
        {sessionBlock('session_tag_list', {}, { result: JSON.stringify({ tags: ['storybook', 'tool-ui'] }) })}
      </Section>

      <Section title="session_collab_request">
        {collabBlock('session_collab_request', LAUNCHES_ONE, { status: 'streaming', elapsedSeconds: 1 })}
        {collabBlock('session_collab_request', LAUNCHES_ONE, {
          result: JSON.stringify({
            status: 'approved',
            launches: [{
              launchId: 'reviewer',
              agentId: 'acp-base',
              name: 'DiffBot',
              role: 'Reviewer',
              title: 'DiffBot - Reviewer',
              credential: CRED_A,
            }],
          }),
        })}
        {collabBlock('session_collab_request', LAUNCHES_TWO, { status: 'streaming', elapsedSeconds: 2 })}
        {collabBlock('session_collab_request', LAUNCHES_TWO, {
          result: JSON.stringify({
            status: 'approved',
            launches: [
              { launchId: 'alpha', name: 'Alice', role: 'Reviewer', title: 'Alice - Reviewer', credential: CRED_A },
              { launchId: 'beta', name: 'Bob', role: 'Implementer', title: 'Bob - Implementer', credential: CRED_B },
            ],
          }),
        })}
      </Section>

      <Section title="session_collab_start">
        {collabBlock('session_collab_start', { credential: CRED_A }, { status: 'streaming', elapsedSeconds: 4 })}
        {collabBlock('session_collab_start', { credential: CRED_A }, { result: JSON.stringify(START_RESULT) })}
      </Section>

      <Section title="session_collab_send (Send icon) — To + Markdown body">
        {collabBlock('session_collab_send', {
          credential: CRED_A,
          content: 'ping-1 — please reply with status.',
        }, { status: 'streaming', elapsedSeconds: 1 })}
        {collabBlock('session_collab_send', {
          credential: CRED_A,
          content: [
            '## Auth review brief',
            '',
            'Please review the auth changes and **report issues only**.',
            '',
            '### Focus',
            '- permission checks',
            '- token expiry',
            '- CSRF',
            '',
            'Ignore style nits. Return a short verdict plus `file:line` bullets when you find problems.',
            '',
            'This trailing paragraph is long enough that the Markdown body should clamp until expanded in the tool UI.',
          ].join('\n'),
        }, {
          result: JSON.stringify({
            status: 'sent',
            messageId: 'msg-1',
            sequence: 1,
            peerSessionId: 'child-diffbot',
            to: {
              name: 'DiffBot',
              role: 'Reviewer',
              title: 'DiffBot - Reviewer',
              sessionId: 'child-diffbot',
            },
          }),
        })}
      </Section>

      <Section title="session_collab_retrieve (Inbox icon) — From + Markdown body">
        {collabBlock('session_collab_retrieve', { credentials: [CRED_A] }, { status: 'streaming', elapsedSeconds: 1 })}
        {collabBlock('session_collab_retrieve', { credentials: [CRED_A] }, {
          result: JSON.stringify({
            status: 'empty',
            peers: [{
              credential: CRED_A,
              name: 'DiffBot',
              role: 'Reviewer',
              title: 'DiffBot - Reviewer',
              sessionId: 'child-diffbot',
            }],
            messages: [],
          }),
        })}
        {collabBlock('session_collab_retrieve', { credentials: [CRED_A] }, {
          result: JSON.stringify({
            status: 'messages',
            peers: [{
              credential: CRED_A,
              name: 'DiffBot',
              role: 'Reviewer',
              title: 'DiffBot - Reviewer',
              sessionId: 'child-diffbot',
            }],
            messages: [{
              content: [
                '## Verdict: **needs fix**',
                '',
                '| Area | Issue |',
                '| --- | --- |',
                '| Auth | missing CSRF on POST `/login` |',
                '| Token | refresh path races logout |',
                '',
                '```ts',
                'if (!csrf.valid(req)) return 403',
                '```',
                '',
                'Line 4+ keeps going so clamp/expand is exerciseable in Storybook.',
              ].join('\n'),
              fromSessionId: 'child-diffbot',
              from: {
                name: 'DiffBot',
                role: 'Reviewer',
                title: 'DiffBot - Reviewer',
                sessionId: 'child-diffbot',
              },
            }],
          }),
        })}
      </Section>
    </StoryShell>
  ),
}

export const SessionList: Story = {
  name: 'session_list',
  render: () => (
    <StoryShell>
      <Section title="session_list">
        {block('session_list', {}, { status: 'streaming' })}
        {block('session_list', {}, { result: LIST_RESULT_TOON })}
        {block('session_list', { query: 'auth' }, { result: LIST_FILTERED_TOON })}
        {block('session_list', {}, {
          isError: true,
          result: JSON.stringify({ status: 'error', message: 'No project path for the current session.' }),
        })}
      </Section>
    </StoryShell>
  ),
}

export const SessionSearch: Story = {
  name: 'session_search',
  render: () => (
    <StoryShell>
      <Section title="session_search">
        {block('session_search', { query: 'auth refresh' }, { status: 'streaming' })}
        {block('session_search', { query: 'auth refresh' }, { result: SEARCH_RESULT_TOON })}
        {block('session_search', { query: 'zzzz-no-match' }, { result: SEARCH_EMPTY_TOON })}
        {block('session_search', { query: 'x' }, {
          isError: true,
          result: JSON.stringify({ status: 'error', message: 'query is required' }),
        })}
      </Section>
    </StoryShell>
  ),
}

export const SessionRead: Story = {
  name: 'session_read',
  render: () => (
    <StoryShell>
      <Section title="session_read">
        {block('session_read', { sessionId: SESSIONS[0].id, view: 'meta' }, { status: 'streaming' })}
        {block('session_read', { sessionId: SESSIONS[0].id, view: 'meta' }, { result: READ_META_RESULT })}
        {block('session_read', { sessionId: SESSIONS[0].id, view: 'user', limit: 20 }, { result: READ_USER_RESULT })}
        {block('session_read', { sessionId: SESSIONS[0].id, view: 'tools', messageId: 'msg-asst-13' }, { result: READ_TOOLS_RESULT })}
      </Section>
    </StoryShell>
  ),
}

export const SessionCleanup: Story = {
  name: 'session_cleanup',
  render: () => (
    <StoryShell>
      <Section title="session_cleanup">
        {block('session_cleanup', { action: 'hide', sessionIds: [SESSIONS[3].id] }, { status: 'streaming' })}
        {block('session_cleanup', { action: 'hide', sessionIds: [SESSIONS[3].id] }, { result: CLEANUP_HIDDEN })}
        {block('session_cleanup', { action: 'delete', sessionIds: [SESSIONS[3].id] }, { result: CLEANUP_DELETED })}
        {block('session_cleanup', { action: 'delete', sessionIds: [SESSIONS[3].id] }, {
          result: JSON.stringify({ status: 'cancelled', action: 'delete', message: 'User did not approve session deletion.' }),
        })}
      </Section>
    </StoryShell>
  ),
}
