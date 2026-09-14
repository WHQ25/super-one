export function toolResult(value: unknown, isError = false) {
  return {
    content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value) }],
    ...(isError ? { isError: true as const } : {}),
  }
}

export function clampLimit(raw: unknown, fallback: number, max: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback
  return Math.max(1, Math.min(max, Math.floor(raw)))
}

export interface ArchiveSessionRow {
  id: string
  title: string | null
  created_at: string
  last_user_msg_at: string
  is_worktree: number | null
  is_pinned: number | null
  is_hidden: number | null
  git_branch: string | null
  worktree_path: string | null
  is_automation: number | null
  provider_id: string | null
  provider: string | null
  acp_agent_id: string | null
  parent_session_id: string | null
  message_count: number
  /**
   * Approximate transcript payload for ranking only (SQLite LENGTH on TEXT =
   * character length of content_json + metadata_json). Not disk page-file bytes.
   * Null when not computed (default list order skips the subquery).
   */
  size_bytes: number | null
  selected_model: string | null
  total_cost_usd: number | null
  context_tokens: number | null
  project_id: string | null
  tags_json: string | null
}
