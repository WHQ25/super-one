import type { PermissionRequest } from './agent-types'
import type { InputRequestMeta } from './input-request'

/** Input shares the permission transport; its origin determines presentation priority. */
export function isInputRequest(request: PermissionRequest | null | undefined): request is PermissionRequest & { inputRequest: InputRequestMeta } {
  return request?.requestKind === 'input_request' && request.inputRequest != null
}

export function isAppInputRequest(request: PermissionRequest | null | undefined): boolean {
  return isInputRequest(request) && request.inputRequest.origin.kind !== 'agent'
}

export function groupPendingPermissions(requests: readonly PermissionRequest[]) {
  const permissions: PermissionRequest[] = []
  const agentInputs: PermissionRequest[] = []
  const appInputs: PermissionRequest[] = []
  for (const request of requests) {
    if (isAppInputRequest(request)) appInputs.push(request)
    else if (isInputRequest(request)) agentInputs.push(request)
    else permissions.push(request)
  }
  return { permissions, agentInputs, appInputs }
}

/** Native phone prompts retain their presentation while lower-priority input waits. */
export function selectPendingPermission(
  requests: readonly PermissionRequest[],
  blocked: { question?: boolean; plan?: boolean; appConsent?: boolean } = {},
): PermissionRequest | null {
  const { permissions, agentInputs, appInputs } = groupPendingPermissions(requests)
  if (permissions.length) return permissions[0]!
  if (blocked.question) return null
  if (agentInputs.length) return agentInputs[0]!
  if (blocked.plan || blocked.appConsent) return null
  return appInputs[0] ?? null
}
