/** Compact environment-scoped archive contract shared by tools and authenticated RPC. */
const SESSION_ARCHIVE_READ_TOOLS = ['project_list', 'session_list', 'session_search', 'session_read', 'session_tag_list'] as const
export type SessionArchiveTool = (typeof SESSION_ARCHIVE_READ_TOOLS)[number]
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
  return (SESSION_ARCHIVE_READ_TOOLS as readonly string[]).includes(name)
}
