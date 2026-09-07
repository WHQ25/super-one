/**
 * The `@session` grammar moved to `@superone/shared/session-mention-query` so
 * the mobile composer can reuse it. What stays here is the desktop's page
 * loader: sessions come through `window.environment`, which a shared module
 * must not know about.
 */
import { listSessionsPage, sessionsPageHasMore } from '@/lib/session-list-ops'
import {
  loadSessionMentionPage as loadSessionMentionPageWith,
  type SessionMentionLoadState,
  type SessionMentionRow,
  type SessionMentionScope,
  type ProjectOption,
} from '@superone/shared/session-mention-query'

export {
  SESSION_MENTION_NAV_PREFIX,
  SESSION_MENTION_KEYWORD,
  SESSION_MENTION_PAGE_SIZE,
  SESSION_MENTION_ARGUMENT_HINT,
  isSessionMentionQuery,
  mentionQueryAllowsSpaces,
  remainingSessionArgumentHint,
  buildSessionProjectOptions,
  parseSessionMentionQuery,
  listSessionProjectChoices,
  titleMatches,
  titleMatchIndices,
  initialSessionMentionLoadState,
  type SessionMentionScope,
  type SessionMentionPhase,
  type ParsedSessionMentionQuery,
  type ProjectOption,
  type SessionMentionRow,
  type SessionMentionLoadState,
} from '@superone/shared/session-mention-query'

export function loadSessionMentionPage(args: {
  scope: SessionMentionScope
  titleQuery: string
  projects: ProjectOption[]
  state: SessionMentionLoadState
  pageSize?: number
}): Promise<{ rows: SessionMentionRow[]; next: SessionMentionLoadState }> {
  return loadSessionMentionPageWith({
    ...args,
    loadPage: async (projectKey, limit, offset) => {
      const sessions = await listSessionsPage(projectKey, { limit, offset })
      return { sessions, hasMore: sessionsPageHasMore(sessions, limit) }
    },
  })
}
