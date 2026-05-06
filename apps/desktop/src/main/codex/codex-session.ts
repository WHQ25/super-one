import type {
  CodexPermissionPreset,
  CodexReasoningEffort,
  ElicitationFormField,
} from '@superone/shared/agent-types'
import {
  CODEX_PERMISSION_PRESETS,
  DEFAULT_CODEX_PERMISSION_PRESET,
  DEFAULT_CODEX_PERMISSION_PROFILE,
} from '@superone/shared/agent-types'
import type { AppServerConnectionHandle, CodexProjectAuth } from './app-server-connection'

export interface AppServerUserInputQuestion {
  id: string
  header: string
  question: string
  isOther: boolean
  options: string[]
}

export type CodexApprovalDecision = 'accept' | 'acceptForSession' | 'decline' | 'cancel'

export type CodexElicitationAction = 'accept' | 'decline' | 'cancel'

export interface CodexElicitationResponse {
  action: CodexElicitationAction
  content: Record<string, unknown> | null
  _meta: { persist?: 'always' } | null
}

export type PendingCodexApprovalResponse =
  | { decision: CodexApprovalDecision }
  | { answers: Record<string, { answers: string[] }> }
  | CodexElicitationResponse

export interface PendingCodexApproval {
  responseKind: 'decision' | 'user_input' | 'elicitation'
  questions?: AppServerUserInputQuestion[]
  formFields?: ElicitationFormField[]
  resolve: (response: PendingCodexApprovalResponse) => void
  reject: (error: Error) => void
}

export interface CodexSession {
  projectPath: string
  model?: string
  modelReasoningEffort?: CodexReasoningEffort
  permissionPreset: CodexPermissionPreset
  threadId: string | null
  threadReady: boolean
  effectiveCwd: string | null
  runningController: AbortController | null
  pendingApprovals: Map<string, PendingCodexApproval>
  activeTurnId: string | null
  steerFn: ((input: string) => Promise<void>) | null
  connectionHandle: AppServerConnectionHandle | null
  connectionAuth: CodexProjectAuth | null
}

function resolvePermissionPreset(preset?: CodexPermissionPreset): CodexPermissionPreset {
  const resolved = preset ?? DEFAULT_CODEX_PERMISSION_PRESET
  const profile = CODEX_PERMISSION_PRESETS[resolved] ?? DEFAULT_CODEX_PERMISSION_PROFILE
  return profile ? resolved : DEFAULT_CODEX_PERMISSION_PRESET
}

export function createCodexSession(
  projectPath: string,
  model?: string,
  threadId?: string,
  modelReasoningEffort?: CodexReasoningEffort,
  permissionPreset?: CodexPermissionPreset,
): CodexSession {
  return {
    projectPath,
    model,
    modelReasoningEffort,
    permissionPreset: resolvePermissionPreset(permissionPreset),
    threadId: threadId ?? null,
    threadReady: false,
    effectiveCwd: null,
    runningController: null,
    pendingApprovals: new Map<string, PendingCodexApproval>(),
    activeTurnId: null,
    steerFn: null,
    connectionHandle: null,
    connectionAuth: null,
  }
}

export function codexSessionNeedsRebuild(
  existing: CodexSession,
  _requestedModel?: string,
  requestedThreadId?: string,
  _requestedReasoningEffort?: CodexReasoningEffort,
  _requestedPermissionPreset?: CodexPermissionPreset,
): boolean {
  if (requestedThreadId && requestedThreadId !== existing.threadId) return true
  return false
}
