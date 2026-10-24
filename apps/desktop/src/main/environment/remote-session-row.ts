/**
 * Sidebar row for a session listed by a remote node.
 *
 * Every current harness id is listed on purpose: a new HarnessId fails this
 * file's typecheck until it is mapped. `acp-grok` is the catalog id whose
 * session harness is `acp`; only that literal implies `grok-build`. A custom
 * ACP agent stays unnamed until the row carries its own agent id.
 */
import type { HarnessId, SessionHistoryEntry } from '@superone/shared/agent-types'
import { providerSessionIdFromResume } from '@superone/shared/environment'
import { parseTagsJson } from '@superone/shared/session-tags'

const REMOTE_LISTED_HARNESS = {
  claude: true,
  codex: true,
  acp: true,
  opencode: true,
  cursor: true,
  dsh: true,
} satisfies Record<HarnessId, true>

function listedProvider(rawHarness: string): HarnessId {
  if (rawHarness === 'acp-grok') return 'acp'
  return Object.hasOwn(REMOTE_LISTED_HARNESS, rawHarness) ? rawHarness as HarnessId : 'claude'
}

/** Map a node session record (or gateway list item) to the sidebar history row. */
export function mapRemoteSessionRow(raw: unknown): SessionHistoryEntry {
  const s = (raw ?? {}) as {
    sessionId?: string
    title?: string | null
    updatedAt?: number
    createdAt?: number
    harnessId?: string
    providerId?: string
    transcript?: unknown[]
    /** Slim session.list rows prefer this over shipping the full transcript. */
    messageCount?: number
    isPinned?: boolean
    isHidden?: boolean
    /** Absolute host cwd when the session is bound to a worktree (or an explicit root). */
    cwd?: string | null
    /** Bare harness session/thread id (desktop Copy Session ID). */
    providerSessionId?: string | null
    /** Prefixed resume token from node SessionRuntime. */
    providerResume?: string | null
    acpAgentId?: string | null
    tags?: unknown
    /** Spawn parent on this host. List rows omit it for roots. */
    parentSessionId?: string | null
    /** Present only when the owning host stored an explicit unread receipt. */
    unread?: boolean
  }
  const sessionId = String(s.sessionId ?? '')
  const ts = s.updatedAt ?? s.createdAt ?? Date.now()
  const cwd = typeof s.cwd === 'string' && s.cwd.trim() ? s.cwd.trim() : null
  const messageCount =
    typeof s.messageCount === 'number' && Number.isFinite(s.messageCount)
      ? Math.max(0, Math.floor(s.messageCount))
      : Array.isArray(s.transcript)
        ? s.transcript.length
        : 0
  const providerSessionId =
    (typeof s.providerSessionId === 'string' && s.providerSessionId.trim()
      ? s.providerSessionId.trim()
      : null) ?? providerSessionIdFromResume(s.providerResume)
  const rawHarness = String(s.harnessId || s.providerId || 'claude')
  const listedAgentId = typeof s.acpAgentId === 'string' && s.acpAgentId.trim()
    ? s.acpAgentId.trim()
    : null
  const acpAgentId = listedAgentId ?? (rawHarness === 'acp-grok' ? 'grok-build' : null)
  const tags = parseTagsJson(s.tags)
  const parentSessionId = typeof s.parentSessionId === 'string' && s.parentSessionId.trim()
    ? s.parentSessionId.trim()
    : null
  return {
    sessionId,
    title: (s.title && String(s.title).trim()) || 'New session',
    lastActiveAt: new Date(ts).toISOString(),
    provider: listedProvider(rawHarness),
    messageCount,
    isPinned: Boolean(s.isPinned),
    isHidden: Boolean(s.isHidden),
    worktreePath: cwd ?? undefined,
    isWorktree: Boolean(cwd),
    ...(providerSessionId ? { providerSessionId } : {}),
    ...(acpAgentId ? { acpAgentId } : {}),
    ...(parentSessionId ? { parentSessionId } : {}),
    ...(tags.length ? { tags } : {}),
    ...(s.unread === true ? { unread: true } : {}),
  }
}
