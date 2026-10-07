import type { PermissionRequest, PlanApprovalRequest } from '@superone/shared/agent-types'
import { permissionSheetPresentation } from './permission-sheet-state'
import { permissionToolContent } from './prompts/prompt-content'
import { permissionDetailSummary } from '@superone/shared/permission-details'
import { permissionPresentation, permissionPresentationTitle } from '@superone/shared/permission-presentation'

/**
 * A decision the agent is waiting on. The sheet shows it; an outside tap puts
 * it away into a strip above the composer, and only an explicit close, deny or
 * answer resolves it. This module owns which prompts are put away and what the
 * strip says about each one.
 */
export type PendingPrompt =
  | { kind: 'permission'; request: PermissionRequest }
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
  pending: { permission: PermissionRequest | null; plan: PlanApprovalRequest | null },
  collapsed: ReadonlySet<string>,
): PendingPrompt[] {
  const prompts: PendingPrompt[] = []
  if (pending.permission) prompts.push({ kind: 'permission', request: pending.permission })
  if (pending.plan) prompts.push({ kind: 'plan', request: pending.plan })
  return prompts.filter((prompt) => collapsed.has(prompt.request.requestId))
}

export function permissionPromptTitle(request: PermissionRequest, translate: (source: string) => string = value => value): string {
  const presentation = permissionPresentation(request)
  if (presentation) return permissionPresentationTitle(presentation, translate)
  if (request.requestKind) return permissionSheetPresentation(request).title
  if (request.toolName === 'SandboxNetworkAccess') return 'Allow sandbox network access'
  return request.toolName.replace(/^mcp__.*?__/, '').replaceAll('_', ' ')
}

export function pendingPromptHeader(prompt: PendingPrompt, translate: (source: string) => string = value => value): PendingPromptHeader {
  switch (prompt.kind) {
    case 'permission': {
      const { request } = prompt
      const content = permissionToolContent(request)
      return {
        title: permissionPromptTitle(request, translate),
        detail: request.requestKind
          ? permissionSheetPresentation(request).description ?? ''
          : permissionDetailSummary(request, content.fileName || content.command || content.target || content.description),
      }
    }
    case 'plan':
      return { title: 'Plan review', detail: prompt.request.planFilePath.split(/[\\/]/).at(-1) ?? '' }
  }
}
