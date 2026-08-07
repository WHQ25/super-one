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
import type { HarnessManager } from '../session/harness-manager'
import { listHarnessModels, listHarnessProviderModels } from '../provider/resolve-service'
import { resolveClaudeBinaryPath } from '../session/claude-turn-runner'
import { getNodeClaudeModelCatalog } from '../session/claude-model-catalog'

export interface HarnessResourcesRpcResult {
  result?: unknown
  error?: { code: RpcErrorCode; message: string; details?: Record<string, unknown> }
}

export interface HarnessResourcesRpcContext {
  client: AuthenticatedClient
  projects: ProjectRegistry
  providers: ProviderStore
  /** Harness catalog — resolves the managed Claude binary for the model probe. */
  harnesses?: HarnessManager
  /** Override home for skill/command discovery (tests). */
  homeDir?: string
  /** Injectable model probe (tests). Default: probe the node's Claude harness. */
  probeModels?: (harnessId: string, cwd: string) => Promise<ModelOption[]>
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

/** Probe the node's own harness for its model catalog (claude only today). */
function defaultProbeModels(
  ctx: HarnessResourcesRpcContext,
): (harnessId: string, cwd: string) => Promise<ModelOption[]> {
  return async (harnessId, cwd) => {
    if (harnessId !== 'claude') return []
    const binaryPath = resolveClaudeBinaryPath({ harnesses: ctx.harnesses })
    if (!binaryPath) {
      // Same resolver the turn runner uses, so this also predicts why sends
      // fail with "Claude Agent SDK binary not available".
      console.warn(
        '[harness.resources] claude model probe skipped: no Agent SDK binary on this node ' +
          '(reinstall the optional platform package or set SUPERONE_CLAUDE_BINARY)',
      )
      return []
    }
    return getNodeClaudeModelCatalog({ cwd, binaryPath })
  }
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
      return listHarnessProviderModels(ctx.providers, hid, apiId ?? null) as ModelOption[]
    }

    // No bound credential: ask the harness on this node what it serves. The
    // built-in slug table only stands in when that probe comes back empty.
    const probeModels = async (hid: string): Promise<ModelOption[]> => {
      const probe = ctx.probeModels ?? defaultProbeModels(ctx)
      const probed = await probe(hid, project.path)
      if (probed.length > 0) return probed
      // Substituting the built-in slug table is a lie the client cannot detect —
      // it looks like a real catalog. Say so here so `journalctl -u superone`
      // explains a stale picker instead of leaving it to guesswork.
      console.warn(
        `[harness.resources] ${hid} probe returned no models; serving the built-in fallback table`,
      )
      return listHarnessModels(ctx.providers, hid, apiProviderId ?? null) as ModelOption[]
    }

    const bundle = await collectHarnessResources({
      projectPath: project.path,
      homeDir: ctx.homeDir,
      listModels,
      probeModels,
      apiProviderId: apiProviderId ?? null,
      harnessId,
    })

    return { result: bundle }
  } catch (err) {
    return mapThrown(err)
  }
}
