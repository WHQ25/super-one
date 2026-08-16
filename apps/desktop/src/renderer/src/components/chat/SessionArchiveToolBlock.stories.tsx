import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { encode as toonEncode } from '@toon-format/toon'
import {
  SessionArchiveToolBlock,
  type SessionArchiveToolName,
} from './SessionArchiveToolBlock'

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

// --- Fixtures (shape aligned with session-archive-tools handlers) ---

const PROJECTS = [
  {
    id: 'proj-aaaaaaaa-1111-4000-8000-aaaaaaaaaaaa',
    name: 'super-one',
    path: '/Users/me/Developer/Projects/super-one',
    lastActiveAt: '2026-08-10T12:00:00.000Z',
    isCurrent: true,
  },
  {
    id: 'proj-bbbbbbbb-2222-4000-8000-bbbbbbbbbbbb',
    name: 'other-app',
    path: '/Users/me/Developer/Projects/other-app',
    lastActiveAt: '2026-07-01T09:00:00.000Z',
  },
  {
    id: 'proj-cccccccc-3333-4000-8000-cccccccccccc',
    name: 'missing-repo',
    path: '/Volumes/gone/old-project',
    lastActiveAt: '2025-12-01T00:00:00.000Z',
    missing: true,
  },
]

const PROJECT_LIST_TOON = toonEncode({
  offset: 0,
  limit: 50,
  count: PROJECTS.length,
  total: PROJECTS.length,
  projects: PROJECTS,
})

const PROJECT_LIST_FILTERED_TOON = toonEncode({
  offset: 0,
  limit: 50,
  count: 1,
  total: 1,
  projects: [PROJECTS[1]],
})

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

const meta: Meta = {
  title: 'SuperOne/MCP Tools/Archive',
  parameters: { layout: 'padded' },
}

export default meta
type Story = StoryObj

export const DesignPrinciples: Story = {
  name: '0 · Design principles',
  render: () => (
    <StoryShell width={680}>
      <Note>
        Casing like collab: streaming “Listing projects…”, done “Projects Listed” / “Sessions Listed”.
        Summary slot holds counts, query quotes, session titles — not UUIDs.
        project_list is the place for path/name; session rows only carry projectId.
        Expand for detail. Cleanup: list first, then hide (no confirm) or delete (user dialog).
      </Note>
      <Section title="Collapsed stories (no expand needed to understand)">
        {block('project_list', {}, { result: PROJECT_LIST_TOON })}
        {block('session_list', { harness: 'claude' }, { status: 'streaming' })}
        {block('session_list', {}, { result: LIST_RESULT_TOON })}
        {block('session_search', { query: 'auth refresh' }, { result: SEARCH_RESULT_TOON })}
        {block('session_read', { sessionId: SESSIONS[0].id, view: 'user' }, {
          result: READ_USER_RESULT,
        })}
        {block('session_cleanup', { action: 'hide', sessionIds: [SESSIONS[3].id] }, {
          result: CLEANUP_HIDDEN,
        })}
      </Section>
    </StoryShell>
  ),
}

export const Gallery: Story = {
  name: 'Gallery (all tools)',
  render: () => (
    <StoryShell width={680}>
      <Section title="project_list (TOON)">
        {block('project_list', {}, { status: 'streaming' })}
        {block('project_list', { query: 'other' }, { status: 'streaming' })}
        {block('project_list', {}, { result: PROJECT_LIST_TOON })}
        {block('project_list', { query: 'other' }, { result: PROJECT_LIST_FILTERED_TOON })}
        {block('project_list', {}, {
          isError: true,
          result: JSON.stringify({
            status: 'error',
            message: 'Failed to read the session archive.',
          }),
        })}
      </Section>

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
    </StoryShell>
  ),
}

export const NestedNoExpand: Story = {
  name: 'Nested allowExpand=false',
  render: () => (
    <StoryShell>
      <Note>
        Subagent cards force allowExpand=false — same content as a one-line Compact header, no
        chevron / panel.
      </Note>
      {block('session_list', {}, { result: LIST_RESULT_TOON, allowExpand: false })}
      {block('session_search', { query: 'auth refresh' }, {
        result: SEARCH_RESULT_TOON,
        allowExpand: false,
      })}
      {block('session_read', { sessionId: SESSIONS[0].id, view: 'user' }, {
        result: READ_USER_RESULT,
        allowExpand: false,
      })}
      {block('session_cleanup', {
        action: 'hide',
        sessionIds: [SESSIONS[3].id],
      }, {
        result: CLEANUP_HIDDEN,
        allowExpand: false,
      })}
    </StoryShell>
  ),
}

export const HeaderMustNotLeak: Story = {
  name: 'Header must not leak tokens/paths',
  render: () => (
    <StoryShell>
      <Note>
        Expand list/cleanup — projectPath may exist in list payload but must not appear in the
        collapsed summary line.
      </Note>
      {block('session_list', {}, { result: LIST_RESULT_TOON })}
      {block('session_cleanup', {
        action: 'hide',
        sessionIds: [SESSIONS[3].id],
      }, { result: CLEANUP_HIDDEN })}
    </StoryShell>
  ),
}

export const ListOnly: Story = {
  name: 'session_list',
  render: () => (
    <StoryShell>
      {block('session_list', {}, { status: 'streaming' })}
      {block('session_list', { harness: 'claude', query: 'auth' }, { status: 'streaming' })}
      {block('session_list', {}, { result: LIST_RESULT_TOON })}
      {block('session_list', { query: 'auth' }, { result: LIST_FILTERED_TOON })}
    </StoryShell>
  ),
}

export const SearchOnly: Story = {
  name: 'session_search',
  render: () => (
    <StoryShell>
      {block('session_search', { query: 'auth refresh' }, { status: 'streaming' })}
      {block('session_search', { query: 'auth refresh' }, { result: SEARCH_RESULT_TOON })}
      {block('session_search', { query: 'zzzz-no-match' }, { result: SEARCH_EMPTY_TOON })}
    </StoryShell>
  ),
}

export const ReadViews: Story = {
  name: 'session_read views',
  render: () => (
    <StoryShell>
      {block('session_read', { sessionId: SESSIONS[0].id, view: 'meta' }, {
        result: READ_META_RESULT,
      })}
      {block('session_read', { sessionId: SESSIONS[0].id, view: 'user' }, {
        result: READ_USER_RESULT,
      })}
      {block('session_read', { sessionId: SESSIONS[0].id, view: 'assistant' }, {
        result: READ_ASSISTANT_RESULT,
      })}
      {block('session_read', { sessionId: SESSIONS[0].id, view: 'tools', messageId: 'msg-asst-13' }, {
        result: READ_TOOLS_RESULT,
      })}
      {block('session_read', {
        sessionId: SESSIONS[0].id,
        view: 'tool_detail',
        toolUseId: 'toolu_edit_01',
      }, { result: READ_TOOL_DETAIL })}
    </StoryShell>
  ),
}

export const CleanupFlow: Story = {
  name: 'session_cleanup flow',
  render: () => (
    <StoryShell>
      <Section title="1. List (discover)">
        {block('session_list', { order: 'last_active_asc' }, { result: LIST_RESULT_TOON })}
      </Section>
      <Section title="2. Soft hide (no confirm)">
        {block('session_cleanup', { action: 'hide', sessionIds: [SESSIONS[3].id] }, {
          result: CLEANUP_HIDDEN,
        })}
      </Section>
      <Section title="3. Delete (user confirm dialog → done / cancelled)">
        {block('session_cleanup', {
          action: 'delete',
          sessionIds: [SESSIONS[3].id],
        }, { status: 'streaming' })}
        {block('session_cleanup', {
          action: 'delete',
          sessionIds: [SESSIONS[3].id],
        }, { result: CLEANUP_DELETED })}
        {block('session_cleanup', { action: 'delete', sessionIds: [SESSIONS[3].id] }, {
          result: JSON.stringify({ status: 'cancelled', action: 'delete' }),
        })}
      </Section>
    </StoryShell>
  ),
}

/** Typical handoff: list → search → read user → assistant → tools */
export const HandoffRecipe: Story = {
  name: 'Recipe: cross-harness handoff',
  render: () => (
    <StoryShell>
      <Note>
        Agent path for humans watching: locate prior work, pull user intent, then conclusions, tools
        only if needed. Each row stays scannable when collapsed.
      </Note>
      {block('session_list', { harness: 'claude', limit: 10 }, { result: LIST_RESULT_TOON })}
      {block('session_search', { query: 'auth refresh' }, { result: SEARCH_RESULT_TOON })}
      {block('session_read', { sessionId: SESSIONS[0].id, view: 'user', limit: 30 }, {
        result: READ_USER_RESULT,
      })}
      {block('session_read', {
        sessionId: SESSIONS[0].id,
        view: 'assistant',
        messageId: 'msg-asst-13',
        around: 0,
      }, { result: READ_ASSISTANT_RESULT })}
      {block('session_read', {
        sessionId: SESSIONS[0].id,
        view: 'tools',
        messageId: 'msg-asst-13',
      }, { result: READ_TOOLS_RESULT })}
    </StoryShell>
  ),
}
