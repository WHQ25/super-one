import type { ClaudeSteerPriority, CodexPermissionPreset, SendMessageRequest } from '../agent-types'

/** Native turn selections used by an existing phone composer on a desktop host. */
export type SessionSendSelections = Pick<SendMessageRequest, 'priority' | 'agent' | 'inputRequest'> & {
  steer?: ClaudeSteerPriority
  modelParams?: Record<string, string>
  permissionPreset?: CodexPermissionPreset
  serviceTier?: string | null
  threadId?: string
}

export const SESSION_SEND_SELECTION_KEYS: readonly (keyof SessionSendSelections)[] = ['priority', 'agent', 'inputRequest', 'steer', 'modelParams', 'permissionPreset', 'serviceTier', 'threadId']
