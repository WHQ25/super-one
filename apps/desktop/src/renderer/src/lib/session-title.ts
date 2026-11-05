import type { ChatMessage } from '@superone/shared/agent-types'
import { stripMiniAppMarkup } from '@superone/shared/miniapp-prompt-tags'
import { SESSION_TITLE_MAX_CHARS } from '@superone/shared/session-title'
import type { ChatStore } from '@/stores/chat-store/types'

export const DEFAULT_SESSION_TITLE = 'New session'

export function getSessionTitle(messages: ChatMessage[] | undefined): string | null {
  for (const message of messages ?? []) {
    if (message.role !== 'user') continue
    const text = stripMiniAppMarkup(message.content
      .flatMap((block) => block.type === 'text' ? [block.text.trim()] : [])
      .filter(Boolean)
      .join(' ')).trim()
    if (text) return text.slice(0, SESSION_TITLE_MAX_CHARS)
  }
  return null
}

/** Named titles outrank message summaries; an unnamed list row must not replace a summary. */
export function resolveSessionTitle(
  agentTitle: string | null | undefined,
  messages: ChatMessage[] | undefined,
  savedTitle: string | null | undefined,
  terminal: string = DEFAULT_SESSION_TITLE,
): string {
  if (agentTitle != null) return agentTitle
  const namedTitle = savedTitle === DEFAULT_SESSION_TITLE || savedTitle === 'Untitled' ? null : savedTitle
  return namedTitle ?? getSessionTitle(messages) ?? savedTitle ?? terminal
}

/** One source selection for headers, sidebar rows, and the session switcher. */
export function selectSessionTitle(
  state: Pick<ChatStore, 'projectSessions' | 'agentTitles'>,
  projectPath: string | null | undefined,
  sessionId: string | null | undefined,
  persistedTitle?: string | null,
): string {
  const project = projectPath ? state.projectSessions[projectPath] : undefined
  const session = sessionId ? project?._sessions[sessionId] : undefined
  const savedTitle = project?.sessions?.find((entry) => entry.sessionId === sessionId)?.title
    ?? persistedTitle
  return resolveSessionTitle(
    // Explicit live titles remain authoritative even when a user deliberately
    // names a session "New session" or "Untitled". Only list fallbacks yield.
    (sessionId ? state.agentTitles[sessionId] : undefined) ?? session?._title,
    session?.messages,
    savedTitle,
  )
}
