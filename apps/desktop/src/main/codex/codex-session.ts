import type {
  AgentEvent,
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
import type { NotificationDispatcher } from './codex-notification-dispatcher'
import type { ForkListenerHandle } from './codex-fork-listener'
import type { CodexRunStreamCallbacks } from './codex-turn'

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
  event: AgentEvent
  resolve: (response: PendingCodexApprovalResponse) => void
  reject: (error: Error) => void
}

export interface CodexSession {
  /** SuperOne session id (Session class) — used to scope mini-app MCP tools to this session */
  superoneSessionId: string
  projectPath: string
  model?: string
  modelReasoningEffort?: CodexReasoningEffort
  serviceTier: string | null
  permissionPreset: CodexPermissionPreset
  threadId: string | null
  threadReady: boolean
  effectiveCwd: string | null
  runningController: AbortController | null
  pendingApprovals: Map<string, PendingCodexApproval>
  activeTurnId: string | null
  steerFn: ((input: string) => Promise<void>) | null
  interruptFn: (() => Promise<void>) | null
  connectionHandle: AppServerConnectionHandle | null
  connectionAuth: CodexProjectAuth | null
  connectionPromise: Promise<AppServerConnectionHandle> | null
  connectionPromiseAuth: CodexProjectAuth | null
  apiProviderId: string | null
  notificationDispatcher: NotificationDispatcher | null
  queueChangedFn: ((threadId: string) => void) | null
  forkListeners: Map<string, ForkListenerHandle>
  forkCallbacks: CodexRunStreamCallbacks | null
  systemPromptAppend?: string
}

function resolvePermissionPreset(preset?: CodexPermissionPreset): CodexPermissionPreset {
  const resolved = preset ?? DEFAULT_CODEX_PERMISSION_PRESET
  const profile = CODEX_PERMISSION_PRESETS[resolved] ?? DEFAULT_CODEX_PERMISSION_PROFILE
  return profile ? resolved : DEFAULT_CODEX_PERMISSION_PRESET
}

export function createCodexSession(
  superoneSessionId: string,
  projectPath: string,
  model?: string,
  threadId?: string,
  modelReasoningEffort?: CodexReasoningEffort,
  permissionPreset?: CodexPermissionPreset,
  apiProviderId?: string | null,
  systemPromptAppend?: string,
  serviceTier: string | null = null,
): CodexSession {
  return {
    superoneSessionId,
    projectPath,
    model,
    modelReasoningEffort,
    serviceTier,
    permissionPreset: resolvePermissionPreset(permissionPreset),
    threadId: threadId ?? null,
    threadReady: false,
    effectiveCwd: null,
    runningController: null,
    pendingApprovals: new Map<string, PendingCodexApproval>(),
    activeTurnId: null,
    steerFn: null,
    interruptFn: null,
    connectionHandle: null,
    connectionAuth: null,
    connectionPromise: null,
    connectionPromiseAuth: null,
    apiProviderId: apiProviderId ?? null,
    notificationDispatcher: null,
    queueChangedFn: null,
    forkListeners: new Map(),
    forkCallbacks: null,
    systemPromptAppend,
  }
}

export function tearDownForkRuntime(session: CodexSession, reason: string): void {
  const dispatcher = session.notificationDispatcher
  const forkListeners = Array.from(session.forkListeners.values())
  session.forkListeners.clear()
  session.forkCallbacks = null
  session.connectionHandle = null
  session.connectionAuth = null
  session.connectionPromise = null
  session.connectionPromiseAuth = null
  session.threadId = null
  session.threadReady = false
  session.effectiveCwd = null
  session.notificationDispatcher = null
  for (const listener of forkListeners) {
    try { listener.stop(reason) } catch { /* ignore */ }
  }
  if (dispatcher) {
    try { dispatcher.close(reason) } catch { /* ignore */ }
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
