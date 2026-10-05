import type { PermissionRequest } from '@superone/shared/agent-types'
import { isInputRequest, selectPendingPermission } from '@superone/shared/input-request-presentation'
import type { SchemaFormResource } from '@superone/shared/schema-form'
import type { SchemaFormDraft } from './prompts/use-schema-form-state'

export interface InputRequestDraft extends SchemaFormDraft {
  resources: ReadonlyMap<string, SchemaFormResource[]>
}

/** Higher-priority native sheets and transcript questions keep their existing entry points. */
export function mobileInputSurfaces(session: {
  pendingPermissions: PermissionRequest[]
  pendingQuestion: unknown
  pendingPlanApproval: unknown
}) {
  const pending = selectPendingPermission(session.pendingPermissions, {
    question: !!session.pendingQuestion, plan: !!session.pendingPlanApproval,
  })
  return {
    permission: isInputRequest(pending) ? null : pending,
    input: isInputRequest(pending) ? pending : null,
    showPlan: !pending && !session.pendingQuestion,
  }
}

/** Cache belongs to the shell, which stays mounted while the user changes sessions. */
export class InputRequestDrafts {
  private readonly entries = new Map<string, InputRequestDraft>()
  private key(projectPath: string, sessionId: string, requestId: string) { return JSON.stringify([projectPath, sessionId, requestId]) }
  get(projectPath: string, sessionId: string, requestId: string) { return this.entries.get(this.key(projectPath, sessionId, requestId)) }
  set(projectPath: string, sessionId: string, requestId: string, draft: InputRequestDraft) {
    this.entries.set(this.key(projectPath, sessionId, requestId), draft)
  }
  reconcile(projectPath: string, sessionId: string, pending: readonly PermissionRequest[]) {
    const prefix = JSON.stringify([projectPath, sessionId]).slice(0, -1) + ','
    const live = new Set(pending.filter(isInputRequest).map(request => this.key(projectPath, sessionId, request.requestId)))
    for (const key of this.entries.keys()) if (key.startsWith(prefix) && !live.has(key)) this.entries.delete(key)
  }
  clear() { this.entries.clear() }
}
