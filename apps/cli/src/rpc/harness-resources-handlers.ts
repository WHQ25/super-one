/**
 * harness.resources / harness.connect RPC — aggregate discovery for remote projects.
 *
 * Models come from the node provider store; skills/commands/agents/prompts from
 * node-local FS. Does not use desktop CONNECT_* caches.
 */

import {
  OPERATION_SCOPES,
  hasAllScopes,
  type AuthScope,
  type RpcErrorCode,
} from '@superone/shared/environment'
import { collectHarnessResources } from '@superone/runtime/session'
import type { ModelOption } from '@superone/shared/agent-types'
import type { AuthenticatedClient } from '../auth/auth-service'
import type { ProjectRegistry } from '../workspace/project-registry'
import type { ProviderStore } from '../provider/provider-store'
import { listHarnessModels } from '../provider/resolve-service'

export interface HarnessResourcesRpcResult {
  result?: unknown
  error?: { code: RpcErrorCode; message: string; details?: Record<string, unknown> }
}

export interface HarnessResourcesRpcContext {
  client: AuthenticatedClient
  projects: ProjectRegistry
  providers: ProviderStore
  /** Override home for skill/command discovery (tests). */
  homeDir?: string
}

function requireScopes(
  client: AuthenticatedClient,
  scopes: readonly AuthScope[],
): HarnessResourcesRpcResult | null {
  if (!hasAllScopes(client.scopes, scopes)) {
    return { error: { code: 'forbidden', message: `missing scopes: ${scopes.join(', ')}` } }
  }
  return null
}

function asRecord(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
}

function mapThrown(err: unknown): HarnessResourcesRpcResult {
  const e = err as { code?: string; message?: string }
  const code = (e.code as RpcErrorCode | undefined) ?? 'internal'
  return { error: { code, message: e.message || 'internal error' } }
}

/**
 * Dispatch harness.resources | harness.connect. Returns null for other methods.
 */
export async function dispatchHarnessResourcesRpc(
  method: string,
  payload: unknown,
  ctx: HarnessResourcesRpcContext,
): Promise<HarnessResourcesRpcResult | null> {
  if (method !== 'harness.resources' && method !== 'harness.connect') return null
  return handleHarnessResources(payload, ctx)
}

async function handleHarnessResources(
  payload: unknown,
  ctx: HarnessResourcesRpcContext,
): Promise<HarnessResourcesRpcResult> {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readEnvironment)
  if (denied) return denied
  // Skills/agents need project path — require workspace read when projectId set.
  const p = asRecord(payload)
  const projectId = String(p.projectId ?? '')
  if (!projectId) {
    return { error: { code: 'invalid_argument', message: 'projectId required' } }
  }
  const deniedWs = requireScopes(ctx.client, OPERATION_SCOPES.readWorkspace)
  if (deniedWs) return deniedWs

  try {
    const project = ctx.projects.get(projectId)
    if (!project) {
      return { error: { code: 'not_found', message: 'project not found' } }
    }
    ctx.projects.touch(projectId)

    const harnessId =
      typeof p.harnessId === 'string' && p.harnessId.trim() ? p.harnessId.trim() : null
    const apiProviderId =
      typeof p.apiProviderId === 'string' && p.apiProviderId.trim()
        ? p.apiProviderId.trim()
        : p.apiProviderId === null
          ? null
          : undefined

    const listModels = (hid: string, apiId?: string | null): ModelOption[] => {
      return listHarnessModels(ctx.providers, hid, apiId ?? null) as ModelOption[]
    }

    const bundle = await collectHarnessResources({
      projectPath: project.path,
      homeDir: ctx.homeDir,
      listModels,
      apiProviderId: apiProviderId ?? null,
      harnessId,
    })

    return { result: bundle }
  } catch (err) {
    return mapThrown(err)
  }
}
