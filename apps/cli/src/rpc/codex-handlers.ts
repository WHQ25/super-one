/**
 * The node's `codex.*` family (`@superone/runtime/server/rpc-codex`) over the
 * CLI's Codex admin service. Auth is process-memory only (see
 * codex-admin-service projectAuthById).
 */

import type { RpcResult } from '@superone/runtime/server'
import { CODEX_RPC_METHODS, dispatchCodexRpc as dispatchCodexFamily } from '@superone/runtime/server/rpc-codex'
import type { AuthenticatedClient } from '../auth/auth-service'
import type { ProjectRegistry } from '../workspace/project-registry'
import type { HarnessManager } from '../session/harness-manager'
import type { ProviderStore } from '../provider/provider-store'
import { createCodexAdminService } from '../session/codex-admin-service'
import type { CodexSpawnFn } from '@superone/codex'

export interface CodexRpcContext {
  nodeHome?: string
  client: AuthenticatedClient
  projects: ProjectRegistry
  harnesses: HarnessManager
  providers: ProviderStore
  binaryPath?: string | null
  spawnFn?: CodexSpawnFn
}

export { CODEX_RPC_METHODS }

export async function dispatchCodexRpc(method: string, payload: unknown, ctx: CodexRpcContext): Promise<RpcResult | null> {
  if (!method.startsWith('codex.')) return null
  const codex = createCodexAdminService({
    nodeHome: ctx.nodeHome,
    binaryPath: ctx.binaryPath,
    harnesses: ctx.harnesses,
    providers: ctx.providers,
    spawnFn: ctx.spawnFn,
    resolveProjectPath: (projectId) => ctx.projects.get(projectId)?.path ?? null,
  })
  return await dispatchCodexFamily(method, payload, { client: ctx.client, projects: ctx.projects, codex })
    ?? { error: { code: 'not_found', message: `unknown method: ${method}` } }
}
