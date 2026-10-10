import { OPERATION_SCOPES } from '@superone/shared/environment'

const CLIENT_SCOPED = new Set(['client.markSeen', 'client.appendLog'])
const ACCESS_METHODS = new Set(['client.mintNodeCode', 'client.pairNode'])
const WRITE_WORKSPACE = new Set(['files.mkdir', 'files.upload', 'files.uploadComplete', 'widget.saveTemplate'])
const READ_WORKSPACE = new Set(['files.read', 'files.listDir', 'files.videoPoster', 'files.search', 'git.worktreeInfo'])

export function phoneMethodScopes(method: string, sessionOperation: boolean, payload?: Record<string, unknown>) {
  if (method === 'mcpApps.request') {
    const operation = (payload?.request as { operation?: string } | undefined)?.operation
    return operation === 'writeResource' ? OPERATION_SCOPES.writeWorkspace : operation === 'load' ? OPERATION_SCOPES.readSession : OPERATION_SCOPES.operateSession
  }
  if (sessionOperation) return OPERATION_SCOPES.operateSession
  if (ACCESS_METHODS.has(method)) return OPERATION_SCOPES.manageAccess
  if (CLIENT_SCOPED.has(method)) return OPERATION_SCOPES.readEnvironment
  if (WRITE_WORKSPACE.has(method)) return OPERATION_SCOPES.writeWorkspace
  if (READ_WORKSPACE.has(method)) return OPERATION_SCOPES.readWorkspace
  if (method === 'git.setDefaultClonePath') return OPERATION_SCOPES.adminNode
  return OPERATION_SCOPES.readSession
}
