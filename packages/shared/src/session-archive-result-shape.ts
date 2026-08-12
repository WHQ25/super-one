/**
 * Shape detection for SuperOne session-archive tool results
 * (project_list / session_list / session_search / session_read / session_cleanup).
 *
 * These payloads are TOON tables or structured JSON. SessionArchiveToolBlock parses
 * list/search/read/cleanup; session_tag_list is hidden in chat but the agent still
 * needs the full table. The generic 4000-char ACP tool-result cap slices mid-table.
 * Both ACP result mappers (@superone/acp tool-result-map and desktop main
 * acp-event-map) must agree on what to keep whole, so the predicates live here.
 */

/** Do not match session_list_agents or session_collab_*. */
export function isSessionArchiveToolName(toolName: string | undefined): boolean {
  if (!toolName) return false
  return /(?:^|__)(?:project_list|session_(?:list|search|read|cleanup|tag_list))$/.test(toolName)
}

/** Production list/search payloads are TOON tables — a mid-string slice makes decode fail. */
export function looksLikeSessionArchiveToon(summary: string): boolean {
  return /(?:^|\n)(?:projects|sessions|hits|tags)\[\d+\]/.test(summary.trim())
}

export function looksLikeSessionArchiveJson(obj: Record<string, unknown>): boolean {
  return Array.isArray(obj.sessions)
    || Array.isArray(obj.hits)
    || Array.isArray(obj.projects)
    || Array.isArray(obj.tags)
    || (typeof obj.action === 'string'
      && (Array.isArray(obj.deleted)
        || Array.isArray(obj.affected)
        || Array.isArray(obj.candidates)
        || Array.isArray(obj.failed)))
}
