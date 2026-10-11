import type { RewindFilesResult, PermissionMode, SandboxInfo, ContextUsageInfo, McpServerInfo, SideChatStartResult, ScheduledSend, ScheduledSendPatch } from '../agent-types'

/** Optional session families: a host advertises only the operations it implements. */
export interface SessionOperationMethods {
  'session.forceRecover': { input: { message?: string }; result: { ok: true } }
  'session.reportWorktreeRemoved': { input: Record<string, never>; result: null }
  'session.scheduledSend.get': { input: Record<string, never>; result: ScheduledSend | null }
  'session.scheduledSend.set': { input: { patch: ScheduledSendPatch }; result: ScheduledSend | null }
  'session.scheduledSend.clear': { input: Record<string, never>; result: null }
  'session.sideChatStart': { input: Record<string, never>; result: SideChatStartResult }
  'session.sideChatClose': { input: Record<string, never>; result: boolean }
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
  'session.reportWorktreeRemoved',
  'session.forceRecover',
  'session.scheduledSend.get', 'session.scheduledSend.set', 'session.scheduledSend.clear',
  'session.sideChatStart', 'session.sideChatClose',
  'session.contextUsage', 'session.mcpStatus', 'session.mcpAuthenticate',
  'session.stopTask', 'session.startQueued', 'session.reset',
  'session.rewind', 'session.previewRewind', 'session.truncateAtCheckpoint',
])
export const SESSION_OPERATION_READS: ReadonlySet<string> = new Set(['session.scheduledSend.get', 'session.previewRewind', 'session.contextUsage', 'session.mcpStatus'])

export interface SessionListOperationMethods {
  'sessionList.scheduledSends': { input: Record<string, never>; result: ScheduledSend[] }
  'sessionList.deleteOlderThan': { input: { projectId: string; cutoffDate: string }; result: string[] }
}
export type SessionListOperationMethod = keyof SessionListOperationMethods
export const SESSION_LIST_OPERATION_METHODS: ReadonlySet<string> = new Set(['sessionList.scheduledSends', 'sessionList.deleteOlderThan'])
export interface SessionListControl { sessionId: string; leaseId: string; generation: string }
