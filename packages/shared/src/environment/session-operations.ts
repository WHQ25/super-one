import type { RewindFilesResult } from '../agent-types'

/** Optional session families: a host advertises only the operations it implements. */
export interface SessionOperationMethods {
  'session.rewind': { input: { checkpointId: string; mode: 'files' | 'conversation' | 'code+chat' }; result: RewindFilesResult }
  'session.previewRewind': { input: { checkpointId: string }; result: RewindFilesResult }
  'session.truncateAtCheckpoint': { input: { checkpointId: string }; result: boolean }
}
export type SessionOperationMethod = keyof SessionOperationMethods
export const SESSION_OPERATION_METHODS: ReadonlySet<string> = new Set([
  'session.rewind', 'session.previewRewind', 'session.truncateAtCheckpoint',
])
export const SESSION_OPERATION_READS: ReadonlySet<string> = new Set(['session.previewRewind'])
