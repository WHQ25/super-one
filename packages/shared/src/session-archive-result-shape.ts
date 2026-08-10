/**
 * Shape detection for SuperOne session-archive tool results
 * (project_list / session_list / session_search / session_read / session_cleanup).
 *
 * These payloads are TOON tables or structured JSON that SessionArchiveToolBlock
 * parses, so the generic 4000-char ACP tool-result cap slices them mid-table and the
 * UI silently renders "0 sessions". Both ACP result mappers (@superone/acp
 * tool-result-map and desktop main acp-event-map) must agree on what to keep whole,
 * so the predicates live here instead of being copied per harness — adding a tool to
 * one copy and not the other is invisible to the type checker.
 */

/** Do not match session_list_agents or session_collab_*. */
export function isSessionArchiveToolName(toolName: string | undefined): boolean {
  if (!toolName) return false
  return /(?:^|__)(?:project_list|session_(?:list|search|read|cleanup))$/.test(toolName)
}

/** Production list/search payloads are TOON tables — a mid-string slice makes decode fail. */
export function looksLikeSessionArchiveToon(summary: string): boolean {
  return /(?:^|\n)(?:projects|sessions|hits)\[\d+\]/.test(summary.trim())
}

export function looksLikeSessionArchiveJson(obj: Record<string, unknown>): boolean {
  return Array.isArray(obj.sessions)
    || Array.isArray(obj.hits)
    || Array.isArray(obj.projects)
    || (typeof obj.action === 'string'
      && (Array.isArray(obj.deleted)
        || Array.isArray(obj.affected)
        || Array.isArray(obj.candidates)
        || Array.isArray(obj.failed)))
}
