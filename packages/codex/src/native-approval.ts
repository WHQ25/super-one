import type { PermissionRequest } from '@superone/shared/agent-types'

export const CODEX_NATIVE_APPROVAL_METHODS = new Set([
  'item/commandExecution/requestApproval', 'item/fileChange/requestApproval',
])
export type CodexNativeApprovalDecision = 'accept' | 'acceptForSession' | 'decline' | 'cancel'
const string = (value: unknown): string | undefined => typeof value === 'string' ? value : undefined
const record = (value: unknown): Record<string, unknown> | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined

/** Host interaction identity is separate from the raw RPC and provider item/checkpoint IDs. */
export function codexNativeApprovalRequest(requestId: string, method: string, params: Record<string, unknown>): PermissionRequest | undefined {
  if (!CODEX_NATIVE_APPROVAL_METHODS.has(method)) return
  const human = params.kind === 'humanCommand'
  if (params.kind != null && !['humanCommand', 'command', 'writeStdin'].includes(String(params.kind))) return
  const additionalPermissions = record(params.additionalPermissions)
  const decisions = params.availableDecisions
  const allowAlwaysAllow = !human && !additionalPermissions && (!Array.isArray(decisions) || decisions.includes('acceptForSession'))
  if (method === 'item/fileChange/requestApproval') {
    const path = string(params.grantRoot)
    return { requestId, toolName: 'FileChange', input: { ...(path ? { file_path: path } : {}), kind: 'grant_root' },
      decisionReason: string(params.reason), blockedPath: path, allowAlwaysAllow }
  }
  const network = record(params.networkApprovalContext)
  const toolName = network ? 'SandboxNetworkAccess' : 'Bash'
  const input = { command: string(params.command) ?? '', ...(string(params.cwd) ? { cwd: params.cwd } : {}),
    ...(network ? { host: network.host, protocol: network.protocol, ...(network.port !== undefined ? { port: network.port } : {}) } : {}) }
  return { requestId, toolName, input,
    ...(additionalPermissions ? { permissionDetails: { action: 'shell', resources: [], source: { toolName, input }, metadata: { additionalPermissions } } } : {}),
    decisionReason: string(params.reason), allowAlwaysAllow, ...(human ? { requiresHumanApproval: true } : {}) }
}

/** Enforce one-time human checkpoints even if a stale/foreign host returns a persistent decision. */
export function codexNativeApprovalResult(params: Record<string, unknown>, result: unknown): { decision: CodexNativeApprovalDecision } {
  let decision = record(result)?.decision
  if (decision === 'acceptForSession' && (params.kind === 'humanCommand' || record(params.additionalPermissions)
    || Array.isArray(params.availableDecisions) && !params.availableDecisions.includes('acceptForSession'))) decision = 'accept'
  return { decision: ['accept', 'acceptForSession', 'decline', 'cancel'].includes(String(decision)) ? decision as CodexNativeApprovalDecision : 'decline' }
}
