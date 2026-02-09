import type { PermissionUpdate } from '@anthropic-ai/claude-agent-sdk'
import type { AgentEvent } from '../../shared/agent-types'

export interface PendingPermission {
  resolve: (result: { allow: boolean; alwaysAllow?: boolean }) => void
  suggestions?: PermissionUpdate[]
  toolUseID: string
}

export interface PendingQuestion {
  resolve: (answers: Record<string, string> | null) => void
}

export function createCanUseTool(
  pendingPermissions: Map<string, PendingPermission>,
  pendingQuestions: Map<string, PendingQuestion>,
  emit: (event: AgentEvent) => void
) {
  return async (
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
    // AskUserQuestion — different flow: emit question, wait for answers
    if (toolName === 'AskUserQuestion') {
      return handleAskUserQuestion(input, context, pendingQuestions, emit)
    }

    const requestId = `perm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

    emit({
      type: 'permission_request',
      request: {
        requestId,
        toolName,
        input,
        decisionReason: context.decisionReason,
        blockedPath: context.blockedPath,
        allowAlwaysAllow: (context.suggestions?.length ?? 0) > 0,
      },
    })

    const result = await new Promise<{ allow: boolean; alwaysAllow?: boolean }>((resolve) => {
      // If already aborted before prompting, deny immediately
      if (context.signal.aborted) {
        resolve({ allow: false })
        return
      }

      pendingPermissions.set(requestId, {
        resolve,
        suggestions: context.suggestions,
        toolUseID: context.toolUseID,
      })
      // Note: We intentionally do NOT listen for future abort events.
      // The SDK may fire abort while the user is still deciding on the
      // permission prompt. Cleanup is handled by rejectAllPending() on
      // session reset/interrupt.
    })

    const pending = pendingPermissions.get(requestId)
    const toolUseID = pending?.toolUseID ?? context.toolUseID

    if (result.allow) {
      return {
        behavior: 'allow' as const,
        updatedInput: input,
        updatedPermissions: result.alwaysAllow ? context.suggestions : undefined,
        toolUseID,
      }
    }
    return { behavior: 'deny' as const, message: 'User denied permission', toolUseID }
  }
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

  emit({
    type: 'ask_user_question',
    request: { requestId, questions },
  })

  const answers = await new Promise<Record<string, string> | null>((resolve) => {
    if (context.signal.aborted) {
      resolve(null)
      return
    }

    pendingQuestions.set(requestId, { resolve })
    // Note: We intentionally do NOT listen for future abort events.
    // Cleanup is handled by rejectAllPending() on session reset/interrupt.
  })

  if (answers === null) {
    return { behavior: 'deny' as const, message: 'User dismissed the question', toolUseID: context.toolUseID }
  }

  return {
    behavior: 'allow' as const,
    updatedInput: { questions, answers },
    toolUseID: context.toolUseID,
  }
}

export function respondToPermission(
  pendingPermissions: Map<string, PendingPermission>,
  requestId: string,
  allow: boolean,
  alwaysAllow?: boolean
): void {
  const pending = pendingPermissions.get(requestId)
  if (pending) {
    pendingPermissions.delete(requestId)
    pending.resolve({ allow, alwaysAllow })
  }
}

export function respondToQuestion(
  pendingQuestions: Map<string, PendingQuestion>,
  requestId: string,
  answers: Record<string, string>
): void {
  const pending = pendingQuestions.get(requestId)
  if (pending) {
    pendingQuestions.delete(requestId)
    pending.resolve(answers)
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
  pendingQuestions?: Map<string, PendingQuestion>
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
}
