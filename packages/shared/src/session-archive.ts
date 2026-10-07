/** Compact environment-scoped archive contract shared by tools and authenticated RPC. */
export type SessionArchiveTool = 'project_list' | 'session_list' | 'session_search' | 'session_read'
export interface SessionArchiveRequest {
  tool: SessionArchiveTool
  args: Record<string, unknown>
  /** The caller's session when this archive owns it; used for default project/self. */
  sourceSessionId?: string
}
export interface ArchiveToolResult {
  [key: string]: unknown
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}
export function isSessionArchiveReadTool(name: string): name is SessionArchiveTool {
  return ['project_list', 'session_list', 'session_search', 'session_read'].includes(name)
}
