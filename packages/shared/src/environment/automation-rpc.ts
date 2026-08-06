/**
 * Node automation management RPC contracts.
 *
 * Electron-free. Desktop remote gateway calls these against a remote
 * environment; local desktop still uses in-process AutomationService.
 * Shapes align with `@superone/shared/agent-types` Automation for UI reuse.
 */

import type {
  AgentRunConfig,
  AutomationRunStatus,
  AutomationSchedule,
  CreateAutomationRequest,
  UpdateAutomationRequest,
} from '../agent-types'

/** Wire shape returned by automation.list / create / update. */
export interface NodeAutomation {
  id: string
  projectId: string
  projectPath: string
  name: string
  prompt: string
  agentConfig: AgentRunConfig
  schedule: AutomationSchedule
  enabled: boolean
  lastRunAt?: string
  lastRunStatus?: AutomationRunStatus
  lastRunSessionId?: string
  nextRunAt?: string
  createdAt: string
  updatedAt: string
}

export interface AutomationListRequest {
  projectId: string
}

export interface AutomationListResult {
  automations: NodeAutomation[]
}

export interface AutomationCreateRequest extends CreateAutomationRequest {
  projectId: string
}

export interface AutomationCreateResult {
  automation: NodeAutomation
}

export interface AutomationUpdateRequest extends UpdateAutomationRequest {
  automationId: string
  /** Optional scope check; when set must match the row's project. */
  projectId?: string
}

export interface AutomationUpdateResult {
  automation: NodeAutomation
}

export interface AutomationDeleteRequest {
  automationId: string
  projectId?: string
}

export interface AutomationDeleteResult {
  ok: true
}

export interface AutomationRunNowRequest {
  automationId: string
  projectId?: string
}

export interface AutomationRunNowResult {
  automationId: string
  status: string
  sessionId?: string
}
