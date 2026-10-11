import type { RewindFilesResult, PermissionMode, SandboxInfo, ContextUsageInfo, McpServerInfo } from '../agent-types'

/** Optional session families: a host advertises only the operations it implements. */
export interface SessionOperationMethods {
  'session.contextUsage': { input: Record<string, never>; result: ContextUsageInfo | null }
  'session.mcpStatus': { input: Record<string, never>; result: McpServerInfo[] }
  'session.mcpAuthenticate': { input: { serverName: string }; result: null }
  'session.stopTask': { input: { taskId: string }; result: boolean }
  'session.startQueued': { input: Record<string, never>; result: boolean }
  'session.reset': { input: { newSessionId?: string }; result: { permissionMode: PermissionMode; sandboxInfo: SandboxInfo } | null }
  'session.rewind': { input: { checkpointId: string; mode: 'files' | 'conversation' | 'code+chat' }; result: RewindFilesResult }
  'session.previewRewind': { input: { checkpointId: string }; result: RewindFilesResult }
  'session.truncateAtCheckpoint': { input: { checkpointId: string }; result: boolean }
}
export type SessionOperationMethod = keyof SessionOperationMethods
export const SESSION_OPERATION_METHODS: ReadonlySet<string> = new Set([
  'session.contextUsage', 'session.mcpStatus', 'session.mcpAuthenticate',
  'session.stopTask', 'session.startQueued', 'session.reset',
  'session.rewind', 'session.previewRewind', 'session.truncateAtCheckpoint',
])
export const SESSION_OPERATION_READS: ReadonlySet<string> = new Set(['session.previewRewind', 'session.contextUsage', 'session.mcpStatus'])
