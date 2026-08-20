import { readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import log from '../logger'
import { isToolPreapproved, isBuiltInSuperoneTool } from '../mcp/superone-mcp-server'
import { isMainThreadOnlySuperoneTool, superoneBareToolName } from '@superone/shared/superone-host-owned-tools'
import { readAppSettings } from '../app-settings-service'
import type { ElicitationRequest, ElicitationResult, PermissionUpdate } from '@anthropic-ai/claude-agent-sdk'
import type { AgentEvent, PermissionMode, QuestionAnnotations } from '@superone/shared/agent-types'
import { answeredQuestionDelta, buildAnsweredQuestionInput } from '@superone/shared/ask-user-question'
import { parseElicitationSchema } from './elicitation-schema'
import { trace } from './event-trace'

export interface PendingPermission {
  resolve: (result: { allow: boolean; alwaysAllow?: boolean; reason?: string; selectedSuggestions?: number[] }) => void
  suggestions?: PermissionUpdate[]
  toolUseID: string
  event: AgentEvent
}

export interface QuestionResponse {
  answers: Record<string, string>
  annotations?: QuestionAnnotations
}

export interface PendingQuestion {
  resolve: (response: QuestionResponse | null) => void
  event: AgentEvent
}

export interface PendingPlanApproval {
  resolve: (result: { approved: boolean; feedback?: string }) => void
  event: AgentEvent
}

export interface PendingElicitation {
  resolve: (result: ElicitationResult) => void
  event: AgentEvent
}

/**
 * Factory for the SDK's Options.onElicitation callback. Mirrors createCanUseTool's
 * emit-then-suspend pattern: emit a permission_request event, park the Promise in
 * pendingElicitations, and let respondToElicitation() (driven by the renderer over the
 * shared PERMISSION_RESPONSE IPC channel) resolve it.
 *
 * The SDK auto-declines every elicitation when no onElicitation is provided
 * (sdk.mjs processControlRequest: `return {action:"decline"}`), so wiring this up also
 * enables the generic JSON-Schema form path as a side effect.
 */
export function createOnElicitation(
  pendingElicitations: Map<string, PendingElicitation>,
  emit: (event: AgentEvent) => void,
) {
  return async (request: ElicitationRequest, options: { signal: AbortSignal }): Promise<ElicitationResult> => {
    if (request.mode === 'url') {
      // No browser-auth UI this round.
      return { action: 'decline' }
    }

    const elicitationForm = parseElicitationSchema(request.requestedSchema ?? null)
    const requestId = `elicit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

    const permEvent: AgentEvent = {
      type: 'permission_request',
      request: {
        requestId,
        toolName: request.serverName,
        toolUseId: requestId,
        input: {},
        allowAlwaysAllow: false,
        requestKind: 'mcp_elicitation',
        serverName: request.serverName,
        message: request.message,
        ...(request.description ? { subtitle: request.description } : {}),
        ...(elicitationForm.length > 0 ? { elicitationForm } : {}),
      },
    }
    trace('permission.flow', 'elicit_emit', { serverName: request.serverName }, requestId)
    log.info('[onElicitation] emit permission_request requestId=%s serverName=%s', requestId, request.serverName)
    emit(permEvent)

    return new Promise<ElicitationResult>((resolve) => {
      if (options.signal.aborted) {
        trace('permission.flow', 'elicit_resolve', { source: 'signal_already_aborted' }, requestId)
        resolve({ action: 'cancel' })
        return
      }
      pendingElicitations.set(requestId, { resolve, event: permEvent })
      // Note: no listener for future abort events, same as createCanUseTool —
      // cleanup is handled by rejectAllPending() on session reset/interrupt.
    })
  }
}

/**
 * Resolve a parked elicitation from the renderer's PERMISSION_RESPONSE IPC.
 * formAnswers carries the flat content record: the generic form values on accept,
 * or `{ feedback }` on reject-with-reason.
 */
export function respondToElicitation(
  pendingElicitations: Map<string, PendingElicitation>,
  requestId: string,
  allow: boolean,
  decision?: 'cancel',
  formAnswers?: Record<string, unknown>,
): boolean {
  const pending = pendingElicitations.get(requestId)
  if (!pending) return false
  pendingElicitations.delete(requestId)
  trace('permission.flow', 'elicit_resolve', { source: 'response', allow, cancel: decision === 'cancel' }, requestId)
  if (decision === 'cancel') {
    pending.resolve({ action: 'cancel' })
    return true
  }
  if (allow) {
    const content = formAnswers && Object.keys(formAnswers).length > 0
      ? (formAnswers as Record<string, string | number | boolean | string[]>)
      : undefined
    pending.resolve({ action: 'accept', ...(content ? { content } : {}) })
    return true
  }
  const feedback = typeof formAnswers?.feedback === 'string' ? formAnswers.feedback : undefined
  pending.resolve({ action: 'decline', ...(feedback ? { content: { feedback } } : {}) })
  return true
}

export function createCanUseTool(
  pendingPermissions: Map<string, PendingPermission>,
  pendingQuestions: Map<string, PendingQuestion>,
  pendingPlanApprovals: Map<string, PendingPlanApproval>,
  emit: (event: AgentEvent) => void,
  onPermissionModeApplied?: (mode: PermissionMode) => void,
  getMessageId?: () => string,
) {
  const plansDir = join(homedir(), '.claude', 'plans')
  let trackedPlanFilePath: string | null = null

  /** Track a file path — if it's a plan file, remember it for ExitPlanMode. */
  function trackPlanFile(filePath: string): void {
    if (filePath.startsWith(plansDir) && filePath.endsWith('.md')) {
      trackedPlanFilePath = filePath
    }
  }

  const canUseTool = async (
    toolName: string,
    input: Record<string, unknown>,
    context: {
      decisionReason?: string
      blockedPath?: string
      suggestions?: PermissionUpdate[]
      toolUseID: string
      signal: AbortSignal
      agentID?: string
    }
  ) => {
    trace('permission.flow', 'canUseTool_enter', { toolName, toolUseId: context.toolUseID, agentId: context.agentID })
    // Track Write/Edit to plan files (also tracked from event stream for auto-allowed calls)
    if (
      (toolName === 'Write' || toolName === 'Edit') &&
      typeof input.file_path === 'string'
    ) {
      trackPlanFile(input.file_path)
    }

    if (isMainThreadOnlySuperoneTool(toolName) && context.agentID) {
      const bare = superoneBareToolName(toolName)
      trace('permission.flow', 'main_thread_tool_blocked_subagent', { toolName: bare, agentId: context.agentID, toolUseId: context.toolUseID })
      return {
        behavior: 'deny' as const,
        message: `Denied: ${bare} can only be called from the main thread. You are running inside a subagent (Task/Agent worker) and must not retry this call.`,
        toolUseID: context.toolUseID,
      }
    }

    if (isBuiltInSuperoneTool(toolName)) {
      return { behavior: 'allow' as const, updatedInput: input, toolUseID: context.toolUseID }
    }

    // Args-aware: miniapp_call resolves appId+tool from input (see miniapp-call-policy).
    if (isToolPreapproved(toolName, input as Record<string, unknown>)) {
      return { behavior: 'allow' as const, updatedInput: input, toolUseID: context.toolUseID }
    }

    // AskUserQuestion — different flow: emit question, wait for answers
    if (toolName === 'AskUserQuestion') {
      return handleAskUserQuestion(input, context, pendingQuestions, emit, getMessageId)
    }

    // ExitPlanMode — show plan approval UI
    if (toolName === 'ExitPlanMode') {
      return handlePlanApproval(input, trackedPlanFilePath, context, pendingPlanApprovals, emit)
    }

    const requestId = `perm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

    if (context.suggestions?.length) {
      log.debug('[canUseTool] suggestions:', JSON.stringify(context.suggestions, null, 2))
    }

    const permEvent: AgentEvent = {
      type: 'permission_request',
      request: {
        requestId,
        toolName,
        toolUseId: context.toolUseID,
        input,
        decisionReason: context.decisionReason,
        blockedPath: context.blockedPath,
        allowAlwaysAllow: (context.suggestions?.length ?? 0) > 0,
        suggestions: context.suggestions as Array<Record<string, unknown>> | undefined,
      },
    }
    trace('permission.flow', 'emit_request', { toolName, toolUseId: context.toolUseID, signalAborted: context.signal.aborted }, requestId)
    log.info('[canUseTool] emit permission_request requestId=%s toolName=%s toolUseId=%s', requestId, toolName, context.toolUseID)
    emit(permEvent)

    const result = await new Promise<{ allow: boolean; alwaysAllow?: boolean; reason?: string; selectedSuggestions?: number[] }>((resolve) => {
      if (context.signal.aborted) {
        trace('permission.flow', 'resolve', { source: 'signal_already_aborted', allow: false }, requestId)
        resolve({ allow: false })
        return
      }

      pendingPermissions.set(requestId, {
        resolve,
        suggestions: context.suggestions,
        toolUseID: context.toolUseID,
        event: permEvent,
      })
      // Note: We intentionally do NOT listen for future abort events.
      // The SDK may fire abort while the user is still deciding on the
      // permission prompt. Cleanup is handled by rejectAllPending() on
      // session reset/interrupt.
    })

    const pending = pendingPermissions.get(requestId)
    const toolUseID = pending?.toolUseID ?? context.toolUseID

    if (result.allow) {
      let updatedPermissions: PermissionUpdate[] | undefined
      if (result.selectedSuggestions && context.suggestions) {
        updatedPermissions = context.suggestions.filter((_, i) => result.selectedSuggestions!.includes(i))
      } else if (result.alwaysAllow) {
        updatedPermissions = context.suggestions
      }
      if (onPermissionModeApplied && updatedPermissions?.length) {
        const sessionSetMode = [...updatedPermissions].reverse().find(
          (p) => p.type === 'setMode' && (p.destination ?? 'session') === 'session',
        ) as Extract<PermissionUpdate, { type: 'setMode' }> | undefined
        if (sessionSetMode) {
          trace('permission.flow', 'applied_setMode', { requestId, mode: sessionSetMode.mode })
          try { onPermissionModeApplied(sessionSetMode.mode as PermissionMode) } catch (err) {
            log.warn('[canUseTool] onPermissionModeApplied error:', err)
          }
        }
      }
      return {
        behavior: 'allow' as const,
        updatedInput: input,
        updatedPermissions,
        toolUseID,
      }
    }
    const denyMsg = result.reason || 'User denied permission'
    return { behavior: 'deny' as const, message: `[denied] ${denyMsg}`, toolUseID }
  }

  return { canUseTool, trackPlanFile }
}

async function handleAskUserQuestion(
  input: Record<string, unknown>,
  context: { toolUseID: string; signal: AbortSignal },
  pendingQuestions: Map<string, PendingQuestion>,
  emit: (event: AgentEvent) => void,
  getMessageId?: () => string
) {
  const requestId = `ask_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const questions = (input.questions as any[]) ?? []

  const previewFormat = readAppSettings().agentPreference.claude.askUserQuestionPreviewFormat
  const questionEvent: AgentEvent = {
    type: 'ask_user_question',
    request: { requestId, questions, previewFormat },
  }
  emit(questionEvent)

  const response = await new Promise<QuestionResponse | null>((resolve) => {
    if (context.signal.aborted) {
      resolve(null)
      return
    }

    pendingQuestions.set(requestId, { resolve, event: questionEvent })
    // Note: We intentionally do NOT listen for future abort events.
    // Cleanup is handled by rejectAllPending() on session reset/interrupt.
  })

  if (response === null) {
    return { behavior: 'deny' as const, message: 'User dismissed the question', toolUseID: context.toolUseID }
  }

  const { answers, annotations: userAnnotations } = response

  const updatedInput = buildAnsweredQuestionInput({
    questions,
    answers,
    annotations: userAnnotations,
    previewFormat,
  })

  // updatedInput reaches the tool executor but not the UI — back-fill the block.
  const messageId = getMessageId?.()
  if (messageId) emit(answeredQuestionDelta(messageId, context.toolUseID, updatedInput))

  return {
    behavior: 'allow' as const,
    updatedInput,
    toolUseID: context.toolUseID,
  }
}

/** Read plan content from a tracked file path. */
function readPlanFile(filePath: string | null): { path: string; content: string } | null {
  if (!filePath) return null
  try {
    return { path: filePath, content: readFileSync(filePath, 'utf-8') }
  } catch {
    return null
  }
}

async function handlePlanApproval(
  input: Record<string, unknown>,
  trackedPlanFilePath: string | null,
  context: { toolUseID: string; signal: AbortSignal },
  pendingPlanApprovals: Map<string, PendingPlanApproval>,
  emit: (event: AgentEvent) => void
) {
  const requestId = `plan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const sdkPlanPath = typeof input.planFilePath === 'string' ? input.planFilePath : null
  const planFile = readPlanFile(sdkPlanPath ?? trackedPlanFilePath)
  const allowedPrompts = Array.isArray(input.allowedPrompts)
    ? (input.allowedPrompts as Array<{ tool: string; prompt: string }>)
    : []

  const planEvent: AgentEvent = {
    type: 'plan_approval',
    request: {
      requestId,
      planContent: planFile?.content ?? '',
      planFilePath: planFile?.path ?? '',
      allowedPrompts,
    },
  }
  emit(planEvent)

  const result = await new Promise<{ approved: boolean; feedback?: string }>((resolve) => {
    if (context.signal.aborted) {
      resolve({ approved: false, feedback: 'Aborted' })
      return
    }
    pendingPlanApprovals.set(requestId, { resolve, event: planEvent })
  })

  if (result.approved) {
    return {
      behavior: 'allow' as const,
      updatedInput: input,
      toolUseID: context.toolUseID,
    }
  }
  return {
    behavior: 'deny' as const,
    message: result.feedback || 'User rejected the plan',
    toolUseID: context.toolUseID,
  }
}

export function respondToPlanApproval(
  pendingPlanApprovals: Map<string, PendingPlanApproval>,
  requestId: string,
  approved: boolean,
  feedback?: string
): void {
  const pending = pendingPlanApprovals.get(requestId)
  if (pending) {
    pendingPlanApprovals.delete(requestId)
    pending.resolve({ approved, feedback })
  }
}

export function respondToPermission(
  pendingPermissions: Map<string, PendingPermission>,
  requestId: string,
  allow: boolean,
  alwaysAllow?: boolean,
  reason?: string,
  selectedSuggestions?: number[]
): boolean {
  const pending = pendingPermissions.get(requestId)
  if (pending) {
    pendingPermissions.delete(requestId)
    trace('permission.flow', 'resolve', { source: 'response', allow, alwaysAllow, reason }, requestId)
    pending.resolve({ allow, alwaysAllow, reason, selectedSuggestions })
    return true
  } else {
    trace('permission.flow', 'resolve_miss', { reason: 'not_in_pending_map', allow }, requestId)
    return false
  }
}

export function respondToQuestion(
  pendingQuestions: Map<string, PendingQuestion>,
  requestId: string,
  answers: Record<string, string>,
  annotations?: QuestionAnnotations
): void {
  const pending = pendingQuestions.get(requestId)
  if (pending) {
    pendingQuestions.delete(requestId)
    pending.resolve({ answers, annotations })
  }
}

export function dismissQuestion(
  pendingQuestions: Map<string, PendingQuestion>,
  requestId: string
): void {
  const pending = pendingQuestions.get(requestId)
  if (pending) {
    pendingQuestions.delete(requestId)
    pending.resolve(null)
  }
}

export function rejectAllPending(
  pendingPermissions: Map<string, PendingPermission>,
  pendingQuestions?: Map<string, PendingQuestion>,
  pendingPlanApprovals?: Map<string, PendingPlanApproval>,
  pendingElicitations?: Map<string, PendingElicitation>,
  reason: string = 'unspecified'
): void {
  if (pendingPermissions.size > 0 || pendingQuestions?.size || pendingPlanApprovals?.size || pendingElicitations?.size) {
    trace('permission.flow', 'reject_all', {
      reason,
      permCount: pendingPermissions.size,
      questionCount: pendingQuestions?.size ?? 0,
      planCount: pendingPlanApprovals?.size ?? 0,
      elicitationCount: pendingElicitations?.size ?? 0,
      permIds: [...pendingPermissions.keys()],
      stack: new Error().stack?.split('\n').slice(1, 6).join(' | '),
    })
  }
  for (const [requestId, pending] of pendingPermissions.entries()) {
    trace('permission.flow', 'resolve', { source: 'reject_all', reason, allow: false }, requestId)
    pending.resolve({ allow: false })
  }
  pendingPermissions.clear()
  if (pendingQuestions) {
    for (const pending of pendingQuestions.values()) {
      pending.resolve(null)
    }
    pendingQuestions.clear()
  }
  if (pendingPlanApprovals) {
    for (const pending of pendingPlanApprovals.values()) {
      pending.resolve({ approved: false })
    }
    pendingPlanApprovals.clear()
  }
  if (pendingElicitations) {
    for (const [requestId, pending] of pendingElicitations.entries()) {
      trace('permission.flow', 'elicit_resolve', { source: 'reject_all', reason }, requestId)
      pending.resolve({ action: 'cancel' })
    }
    pendingElicitations.clear()
  }
}
