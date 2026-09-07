import type { RelayClient } from '@superone/relay-client'
import type { RemoteCommand } from '@superone/shared/agent-types'
import { randomId } from './ids'
import { mentionIconPngPayload } from './mentions'

export type MentionSearchResult = {
  items?: unknown[]
  agentTargets?: unknown
  capabilityIds?: unknown
  /** The directory the host actually searched — a worktree, not the project. */
  cwd?: string
  /**
   * Which of the requested options the host honoured. Absent on hosts that
   * predate them, which is exactly what makes it a capability probe: a scoped
   * request answered project-wide looks identical otherwise, and its top-20 may
   * have ranked every in-scope file out.
   */
  appliedOptions?: { scopeDir?: boolean; additionalDirs?: boolean; iconsById?: boolean }
  error?: string
}

export interface MentionSearchOptions {
  /** Confine the search to this directory, relative to the session's cwd. */
  scopeDir?: string
}

/**
 * Ask for icons by content id rather than by value.
 *
 * Every keystroke re-runs this search, and app icons are most of what comes
 * back. The device caches the bytes and fetches only the ids it has never seen;
 * a host too old to understand this keeps inlining them, which still works.
 */
const ICONS_BY_ID = true

/** Works before session creation as well as inside an active chat. */
export function requestMentionSearch(
  client: Pick<RelayClient, 'request'>,
  projectPath: string,
  query: string,
  options: MentionSearchOptions = {},
): Promise<MentionSearchResult> {
  return client.request({
    type: 'search_mentions',
    requestId: randomId(),
    projectPath,
    query,
    iconsById: ICONS_BY_ID,
    ...(options.scopeDir !== undefined ? { scopeDir: options.scopeDir } : {}),
  }) as Promise<MentionSearchResult>
}

/** Fetch icon bytes for ids the device has never seen. */
export async function requestMentionIcons(
  client: Pick<RelayClient, 'request'>,
  ids: readonly string[],
): Promise<Record<string, string>> {
  if (!ids.length) return {}
  const reply = await client.request({
    type: 'get_mention_icons', requestId: randomId(), ids: [...ids],
  } as RemoteCommand) as { icons?: unknown } | null
  const raw = reply?.icons
  if (!raw || typeof raw !== 'object') return {}
  const icons: Record<string, string> = {}
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    const png = mentionIconPngPayload(value)
    if (png) icons[id] = png
  }
  return icons
}
