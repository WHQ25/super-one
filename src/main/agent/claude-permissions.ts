import { readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import log from '../logger'
import { isToolPreapproved } from '../mcp/superone-mcp-server'
import type { PermissionUpdate } from '@anthropic-ai/claude-agent-sdk'
import type { AgentEvent, QuestionAnnotations } from '../../shared/agent-types'

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

export function createCanUseTool(
  pendingPermissions: Map<string, PendingPermission>,
  pendingQuestions: Map<string, PendingQuestion>,
  pendingPlanApprovals: Map<string, PendingPlanApproval>,
  emit: (event: AgentEvent) => void
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
    }
  ) => {
    // Track Write/Edit to plan files (also tracked from event stream for auto-allowed calls)
    if (
      (toolName === 'Write' || toolName === 'Edit') &&
      typeof input.file_path === 'string'
    ) {
      trackPlanFile(input.file_path)
    }


    if (toolName.startsWith('mcp__widget__') || toolName === 'mcp__superone__read_miniapp_guide') {
      return { behavior: 'allow' as const, updatedInput: input, toolUseID: context.toolUseID }
    }

    if (isToolPreapproved(toolName)) {
      return { behavior: 'allow' as const, updatedInput: input, toolUseID: context.toolUseID }
    }

    // AskUserQuestion — different flow: emit question, wait for answers
    if (toolName === 'AskUserQuestion') {
      return handleAskUserQuestion(input, context, pendingQuestions, emit)
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
    emit(permEvent)

    const result = await new Promise<{ allow: boolean; alwaysAllow?: boolean; reason?: string; selectedSuggestions?: number[] }>((resolve) => {
      if (context.signal.aborted) {
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
  emit: (event: AgentEvent) => void
) {
  const requestId = `ask_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const questions = (input.questions as any[]) ?? []

  const questionEvent: AgentEvent = {
    type: 'ask_user_question',
    request: { requestId, questions },
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

  const annotations: QuestionAnnotations = { ...userAnnotations }
  for (const q of questions) {
    const answer = answers[q.question]
    if (!answer) continue
    const selected = q.options?.find((o: { label: string }) => o.label === answer)
    if (selected?.preview) {
      annotations[q.question] = { ...annotations[q.question], preview: selected.preview }
    }
  }

  return {
    behavior: 'allow' as const,
    updatedInput: {
      questions,
      answers,
      ...(Object.keys(annotations).length > 0 && { annotations }),
    },
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
): void {
  const pending = pendingPermissions.get(requestId)
  if (pending) {
    pendingPermissions.delete(requestId)
    pending.resolve({ allow, alwaysAllow, reason, selectedSuggestions })
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
  pendingPlanApprovals?: Map<string, PendingPlanApproval>
): void {
  for (const pending of pendingPermissions.values()) {
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
}
