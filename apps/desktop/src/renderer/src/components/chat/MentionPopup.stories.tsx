import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useRef, useState } from 'react'
import type { GitMentionCapabilities, GitMentionRef, GitMentionRefsResult } from '@superone/shared/git-mention-query'
import type { McpMentionSearchResult, McpMentionSource } from '@superone/shared/mcp-app-mentions'
import { useAppStore } from '@/stores/app'
import { useChatStore } from '@/stores/chat'
import { MentionPopup, type MentionPopupHandle } from './MentionPopup'
import { mockIpc } from '../../../../../.storybook/mock-ipc'

const PROJECT = '/storybook/mention-popup'

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString()

const REFS: Record<GitMentionRef['kind'], GitMentionRef[]> = {
  branch: [
    { kind: 'branch', id: 'main', label: 'main', detail: 'fix(computer-use): keep overlay hide and host-exit handlers alive', date: hoursAgo(3), current: true },
    { kind: 'branch', id: 'feat/git-mention', label: 'feat/git-mention', detail: 'feat(chat): add @git mention', date: hoursAgo(30) },
    { kind: 'branch', id: 'fix/overlay-race', label: 'fix/overlay-race', detail: 'fix(overlay): first paint race', date: hoursAgo(80) },
  ],
  commit: [
    { kind: 'commit', id: 'f14bf73fabcdef0123456789abcdef0123456789', label: 'f14bf73', detail: 'fix(computer-use): keep overlay hide and host-exit handlers alive', author: 'Hangqi', date: hoursAgo(3) },
    { kind: 'commit', id: 'd49201dcabcdef0123456789abcdef0123456789', label: 'd49201d', detail: 'chore(release): bump version to 0.68.0-alpha', author: 'Hangqi', date: hoursAgo(26) },
    { kind: 'commit', id: 'd9fc01d5abcdef0123456789abcdef0123456789', label: 'd9fc01d', detail: 'test(settings): cover jevFastLoopEnabled in the general domain guide', author: 'Hangqi', date: hoursAgo(50) },
  ],
  worktree: [
    { kind: 'worktree', id: '/Users/me/Developer/super-one', label: 'main', detail: '/Users/me/Developer/super-one', current: true },
    { kind: 'worktree', id: '/Users/me/.worktrees/super-one/feat-git-mention', label: 'feat/git-mention', detail: '/Users/me/.worktrees/super-one/feat-git-mention' },
  ],
  tag: [
    { kind: 'tag', id: 'v0.68.0-alpha', label: 'v0.68.0-alpha', detail: 'chore(release): bump version to 0.68.0-alpha', date: hoursAgo(26) },
    { kind: 'tag', id: 'v0.67.0', label: 'v0.67.0', detail: 'release 0.67.0', date: hoursAgo(300) },
  ],
  issue: [
    { kind: 'issue', id: '28', label: '#28', detail: 'ACP/Grok: subagents can call session_rename / session_tag (main-thread lock is heuristic)', author: 'WHQ25', date: hoursAgo(5), state: 'open', host: 'github' },
    { kind: 'issue', id: '23', label: '#23', detail: 'Crash on start when the profile directory is read-only', author: 'someone', date: hoursAgo(40), state: 'open', host: 'github' },
    { kind: 'issue', id: '7', label: '#7', detail: 'Old crash report', author: 'you', date: hoursAgo(900), state: 'closed', host: 'github' },
  ],
  pr: [
    { kind: 'pr', id: '64', label: '#64', detail: 'feat(chat): add @git and @gh mentions', author: 'WHQ25', date: hoursAgo(1), state: 'draft', host: 'github' },
    { kind: 'pr', id: '62', label: '#62', detail: 'feat(mobile): inline network attachments', author: 'WHQ25', date: hoursAgo(60), state: 'merged', host: 'github' },
    { kind: 'pr', id: '63', label: '#63', detail: 'chore(deps): bump fflate from 0.8.2 to 0.8.3 in /packages/relay-client', author: 'app/dependabot', date: hoursAgo(70), state: 'closed', host: 'github' },
  ],
}

/** Per-story git answers; the popup asks on mount and on every kind/query change. */
let capabilities: GitMentionCapabilities = { repo: 'ready', github: true }
const defaultRefs = (kind: GitMentionRef['kind'], query: string): GitMentionRefsResult => {
  const needle = query.trim().toLowerCase().replace(/^#/, '')
  // GitHub kinds: open only until a query is typed, like `gh issue list` does.
  const pool = (kind === 'issue' || kind === 'pr') && !needle ? REFS[kind].filter((r) => r.state === 'open' || r.state === 'draft') : REFS[kind]
  return { ok: true, refs: pool.filter((r) => !needle || r.id.toLowerCase().startsWith(needle) || r.label.toLowerCase().includes(needle) || r.detail.toLowerCase().includes(needle)) }
}
let refsResult = defaultRefs

mockIpc('app', 'getAppSettings', async () => ({ computerUseEnabled: false, cdpEnabled: false }))
mockIpc('app', 'onAppSettingsChange', () => () => {})
mockIpc('app', 'getGitMentionCapabilities', async () => capabilities)
mockIpc('app', 'listGitMentionRefs', async (_root: unknown, kind: unknown, query: unknown) =>
  refsResult(kind as GitMentionRef['kind'], String(query ?? '')))
mockIpc('agent', 'listDirectory', async () => [])
mockIpc('agent', 'searchMentions', async () => [])
mockIpc('app', 'listComputerUseInstalledApps', async () => [])

/** Bits & Bolts' real icon: one hard-coded dark stroke, tinted to the theme. */
const CAD_ICON = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path fill="none" stroke="#27272a" stroke-width="3" stroke-linejoin="round" d="M9.5 4.75h13L29 16l-6.5 11.25h-13L3 16zM13 10.8h6l3 5.2-3 5.2h-6L10 16z"/></svg>')
/** A two-colour logo, shown as the image it is. */
const TRACKER_ICON = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="4" fill="#2563eb"/><path d="M4 8h8" stroke="#fff" stroke-width="2"/></svg>')
const PARTS: McpMentionSource = {
  server: 'bits-and-bolts', tool: 'search_mentions', title: 'Bits & Bolts', icon: CAD_ICON,
  items: [
    { uri: 'cad://parts/hex-bolt-m8', label: 'Hex bolt M8 × 40', detail: 'hex-bolt-m8.step' },
    { uri: 'cad://parts/hex-nut-m8', label: 'Hex nut M8', detail: 'hex-nut-m8.step' },
    { uri: 'cad://parts/washer-m8', label: 'Flat washer M8' },
  ],
}
const TICKETS: McpMentionSource = {
  server: 'tracker', tool: 'mentions', title: 'tracker', icon: TRACKER_ICON,
  items: [{ uri: 'tracker://issues/412', label: 'Bolt torque table is out of date', detail: 'ENG-412 · open' }],
}

/**
 * How the composer's session answers `mentions/search` in a story. `answer` gets the query;
 * a pending promise stands for a harness that is still starting.
 */
type McpAnswer = (query: string) => Promise<{ ok: true; value: McpMentionSearchResult } | { ok: false; error: { code: string; message: string } }>
const answerWith = (value: McpMentionSearchResult): McpAnswer => async () => ({ ok: true, value })
let mcpSession = 0

function Preview({ query, repo = true, github = true, refs, width = 560, mcp, typeAfter }: { query: string; repo?: boolean; github?: boolean; refs?: typeof refsResult; width?: number; mcp?: McpAnswer; typeAfter?: string }) {
  // A fresh session per render keeps the hook's known-sections cache from leaking between stories.
  const [mcpRoute] = useState(() => mcp ? { projectPath: PROJECT, sessionId: `story-mcp-${++mcpSession}` } : null)
  if (mcp) {
    const env = (window as unknown as { environment?: Record<string, unknown> }).environment ?? {}
    ;(window as unknown as { environment: Record<string, unknown> }).environment = { ...env, mcpAppMentionSearch: (_project: string, _session: string, q: string) => mcp(q) }
  }
  const [ready, setReady] = useState(false)
  const [selected, setSelected] = useState(0)
  const [current, setCurrent] = useState(query)
  const [log, setLog] = useState<string[]>([])
  const ref = useRef<MentionPopupHandle>(null)
  useEffect(() => {
    capabilities = { repo: repo ? 'ready' : 'not-repo', github: repo && github }
    refsResult = refs ?? defaultRefs
    const prevApp = useAppStore.getState()
    const prevChat = useChatStore.getState()
    useChatStore.getState().ensureSession(PROJECT)
    useChatStore.setState({ activeProject: PROJECT })
    useAppStore.setState({ currentFolder: PROJECT, _worktrees: {}, recentFolders: [{ path: PROJECT, name: 'super-one' }] as never })
    setCurrent(query)
    setReady(true)
    return () => {
      useAppStore.setState({ currentFolder: prevApp.currentFolder, _worktrees: prevApp._worktrees, recentFolders: prevApp.recentFolders })
      useChatStore.setState(prevChat)
    }
  }, [query, repo, github, refs])
  useEffect(() => {
    if (typeAfter === undefined) return
    const timer = setTimeout(() => setCurrent(typeAfter), 800)
    return () => clearTimeout(timer)
  }, [typeAfter])
  if (!ready) return null
  return (
    <div className="flex flex-col gap-2" style={{ width, maxWidth: '100%' }}>
      {/* The popup renders `bottom-full` above the composer; the spacer stands in for it. */}
      <div className="relative mt-80 h-0">
        <MentionPopup
          ref={ref}
          query={current}
          selectedIndex={selected}
          onSetSelectedIndex={setSelected}
          mcpRoute={mcpRoute}
          onClose={() => setLog((l) => [...l, 'close'])}
          onSelect={(value, action, kind, displayName) => {
            if (action === 'navigate') {
              setCurrent(value)
              setSelected(0)
              return
            }
            setLog((l) => [...l, `${kind ?? 'file'} · ${displayName ?? value} → ${value}`])
          }}
        />
      </div>
      <div className="rounded-md border border-border bg-muted/40 px-2 py-1 font-mono text-xs text-muted-foreground">
        @{current}
      </div>
      {log.length > 0 ? (
        <ul className="rounded-md border border-border px-2 py-1 font-mono text-xs">
          {log.map((line, i) => <li key={i}>{line}</li>)}
        </ul>
      ) : null}
    </div>
  )
}

const meta = {
  title: 'Chat/MentionPopup',
  component: Preview,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Preview>

export default meta
type Story = StoryObj<typeof meta>

/** Bare `@`: supported capabilities and portals in catalog order; Debug is retired. */
export const Catalog: Story = { args: { query: '' } }

/** Typing `@debug` no longer offers a built-in capability. */
export const RetiredDebug: Story = { args: { query: 'debug' } }

/** `@gi` ranks the Git portal by keyword; Tab / click enters `@git `. */
export const GitPortalMatch: Story = { args: { query: 'gi' } }

/** Outside a repository the Git portal stays listed but disabled, with the reason. */
export const GitPortalNotARepo: Story = { args: { query: 'gi', repo: false } }

/**
 * Without a signed-in `gh` (or a GitHub remote) the GitHub portal stays listed
 * but disabled and `@gh …` types as plain text; Git is untouched.
 */
export const GhPortalUnavailable: Story = { args: { query: 'g', github: false } }

/** `@gh `: pick issue or pull request. Tab completes `gh issue `. */
export const GhPickKind: Story = { args: { query: 'gh ' } }

/** `@gh issue `: open issues, newest activity first, title primary with `#n` beside it. */
export const GhIssues: Story = { args: { query: 'gh issue ' } }

/** `@gh issue 7`: a number finds that issue exactly, closed ones included. */
export const GhIssueByNumber: Story = { args: { query: 'gh issue 7' } }

/** `@gh issue crash`: text goes to GitHub search across all states; the title highlights. */
export const GhIssueSearch: Story = { args: { query: 'gh issue crash' } }

/** `@gh pr `: draft / merged / closed pills tell the states apart. */
export const GhPullRequests: Story = { args: { query: 'gh pr fe' } }

/** `@git `: pick a ref kind. Tab completes `git branch `. */
export const GitPickKind: Story = { args: { query: 'git ' } }

/** `@git branch `: current branch first with its pill, others with their age. */
export const GitBranches: Story = { args: { query: 'git branch ' } }

/** `@git commit over`: short sha, subject inline, author · age at the end. */
export const GitCommitSearch: Story = { args: { query: 'git commit over' } }

/** `@git commit d49`: a sha prefix highlights inside the hash instead of the subject. */
export const GitCommitShaSearch: Story = { args: { query: 'git commit d49' } }

/** A narrow popup drops sha and author · age under the subject instead of squeezing it away. */
export const GitCommitNarrow: Story = { args: { query: 'git commit ', width: 340 } }

/** Narrow branches: the subject moves under the name; age and the `current` pill stay on the first line. */
export const GitBranchesNarrow: Story = { args: { query: 'git branch ', width: 340 } }

/** `@git worktree `: branch as the name, checkout path beside it. */
export const GitWorktrees: Story = { args: { query: 'git worktree ' } }

/** `@git tag `: newest first with the tag message. */
export const GitTags: Story = { args: { query: 'git tag ' } }

/** A filter that matches nothing names the kind that came back empty. */
export const GitNoMatches: Story = { args: { query: 'git tag v9' } }

/** The host could not answer — e.g. an older remote node — so the list explains instead of staying blank. */
export const GitUnsupportedNode: Story = {
  args: { query: 'git branch ', refs: () => ({ ok: false, reason: 'unsupported' }) },
}

/** Long labels and subjects truncate on one line; the sha stays readable. */
export const GitLongContent: Story = {
  args: {
    query: 'git branch ',
    refs: () => ({
      ok: true,
      refs: [{
        kind: 'branch',
        id: 'feature/extremely-long-branch-name-that-keeps-going-and-going-past-the-popup-width',
        label: 'feature/extremely-long-branch-name-that-keeps-going-and-going-past-the-popup-width',
        detail: 'feat: a subject line that is far longer than any popup row could reasonably show without truncating somewhere sensible',
        date: hoursAgo(5),
      }],
    }),
  },
}

/** Bare `@` in a session whose MCP servers declare `mentions/search`: one section per server, before files. */
export const McpServerItems: Story = { args: { query: '', mcp: answerWith({ sources: [PARTS, TICKETS] }) } }

/** Items stay in the server's own order and text; nothing is highlighted because the server did the matching. */
export const McpServerItemsFiltered: Story = {
  args: { query: 'hex', mcp: answerWith({ sources: [{ ...PARTS, items: PARTS.items.slice(0, 2) }, { ...TICKETS, items: [] }] }) },
}

/**
 * Typing after the first answer: sections the session is known to have show "Searching…" until
 * the server answers (here it never does).
 */
export const McpSearching: Story = {
  args: { query: '', typeAfter: 'hex', mcp: async (q) => q ? new Promise(() => {}) : { ok: true, value: { sources: [{ ...PARTS, items: [] }] } } },
}

/** One server failed and another is still starting: the failed one says so, the rest is flagged. */
export const McpFailedAndIncomplete: Story = {
  args: { query: 'bolt', mcp: answerWith({ incomplete: true, sources: [{ ...PARTS, items: [], failed: true }] }) },
}

/** The lookup itself failed (e.g. the harness could not start). */
export const McpUnavailable: Story = {
  args: { query: '', mcp: async () => ({ ok: false, error: { code: 'not_connected', message: 'Harness failed to start' } }) },
}

/**
 * No server declares `mentions/search` — every Claude session today, since its SDK withholds the
 * extension metadata — so the popup is exactly the usual one.
 */
export const McpNoServers: Story = { args: { query: '', mcp: answerWith({ sources: [] }) } }

/** Long titles and details truncate; a narrow popup moves the detail under the title. */
export const McpLongContentNarrow: Story = {
  args: {
    query: 'flange',
    width: 340,
    mcp: answerWith({ sources: [{
      ...PARTS,
      title: 'Bits & Bolts parts library with an unusually long server title',
      items: [
        { uri: 'cad://parts/flange', label: 'Weld-neck flange DN150 PN40 with raised face and a very long catalogue description', detail: 'weld-neck-flange-dn150-pn40-raised-face-extended.step' },
        { uri: 'cad://parts/flange-gasket', label: 'Spiral wound gasket', detail: 'spiral-wound-gasket.step' },
      ],
    }] }),
  },
}
