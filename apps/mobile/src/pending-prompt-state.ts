import type { AskUserQuestionRequest, PermissionRequest, PlanApprovalRequest } from '@superone/shared/agent-types'
import { permissionSheetPresentation } from './permission-sheet-state'
import { permissionToolContent } from './prompts/prompt-content'

/**
 * A decision the agent is waiting on. The sheet shows it; an outside tap puts
 * it away into a strip above the composer, and only an explicit close, deny or
 * answer resolves it. This module owns which prompts are put away and what the
 * strip says about each one.
 */
export type PendingPrompt =
  | { kind: 'permission'; request: PermissionRequest }
  | { kind: 'question'; request: AskUserQuestionRequest }
  | { kind: 'plan'; request: PlanApprovalRequest }

/** Title the sheet header and the strip share; detail is the strip's one-liner. */
export type PendingPromptHeader = { title: string; detail: string }

export function collapsePrompt(collapsed: ReadonlySet<string>, requestId: string): ReadonlySet<string> {
  if (collapsed.has(requestId)) return collapsed
  return new Set(collapsed).add(requestId)
}

export function expandPrompt(collapsed: ReadonlySet<string>, requestId: string): ReadonlySet<string> {
  if (!collapsed.has(requestId)) return collapsed
  const next = new Set(collapsed)
  next.delete(requestId)
  return next
}

/** The put-away prompts still pending, in the order the strips stack. */
export function collapsedPendingPrompts(
  pending: { permission: PermissionRequest | null; plan: PlanApprovalRequest | null; question: AskUserQuestionRequest | null },
  collapsed: ReadonlySet<string>,
): PendingPrompt[] {
  const prompts: PendingPrompt[] = []
  if (pending.permission) prompts.push({ kind: 'permission', request: pending.permission })
  if (pending.question) prompts.push({ kind: 'question', request: pending.question })
  if (pending.plan) prompts.push({ kind: 'plan', request: pending.plan })
  return prompts.filter((prompt) => collapsed.has(prompt.request.requestId))
}

export function permissionPromptTitle(request: PermissionRequest): string {
  if (request.requestKind) return permissionSheetPresentation(request).title
  if (request.toolName === 'SandboxNetworkAccess') return 'Allow sandbox network access'
  return request.toolName.replace(/^mcp__.*?__/, '').replaceAll('_', ' ')
}

function firstLine(text: string): string {
  return text.split('\n').find((line) => line.trim())?.trim() ?? ''
}

export function pendingPromptHeader(prompt: PendingPrompt): PendingPromptHeader {
  switch (prompt.kind) {
    case 'permission': {
      const { request } = prompt
      const content = permissionToolContent(request)
      return {
        title: permissionPromptTitle(request),
        detail: request.requestKind
          ? permissionSheetPresentation(request).description ?? ''
          : content.fileName || content.command || content.target || content.description,
      }
    }
    case 'question': {
      const { questions } = prompt.request
      return {
        title: questions.length === 1 ? 'Question' : 'Questions',
        detail: firstLine(questions[0]?.question ?? ''),
      }
    }
    case 'plan':
      return { title: 'Plan review', detail: prompt.request.planFilePath.split(/[\\/]/).at(-1) ?? '' }
  }
}
