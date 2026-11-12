import type { CodexPermissionPreset, SendMessageRequest } from '../agent-types'

export type SessionSendSelections = Pick<SendMessageRequest, 'priority' | 'agent' | 'inputRequest'> & {
  steer?: 'now'
  modelParams?: Record<string, string>
  permissionPreset?: CodexPermissionPreset
  serviceTier?: string | null
  threadId?: string
}

export const SESSION_SEND_SELECTION_KEYS: readonly (keyof SessionSendSelections)[] = ['priority', 'agent', 'inputRequest', 'steer', 'modelParams', 'permissionPreset', 'serviceTier', 'threadId']
