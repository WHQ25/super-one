/**
 * harness.resources / harness.connect RPC — aggregate discovery for remote projects.
 *
 * OpenCode V2 comes from the node's native location catalog. Other resources
 * use node providers and local files. Does not use desktop CONNECT_* caches.
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
import { getNodeClaudeCatalog } from '../session/claude-model-catalog'
import { claudeAccountProbeEnv, claudeCatalogCacheScope } from '../session/claude-probe-env'
import { getNodeCodexModelCatalog } from '../session/codex-model-catalog'
import { EMPTY_CLAUDE_CATALOG, type ClaudeCatalogProbe } from '@superone/claude'
import { discoverOpenCodeV2Resources } from '@superone/opencode/launch'
import { resolveNodeOpenCodeProvider } from '../provider/opencode-provider'

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
  /** Injectable model probe (tests). Default: probe the node's Claude and Codex harnesses. */
  probeModels?: (harnessId: string, cwd: string) => Promise<ModelOption[]>
  /**
   * Injectable Claude metadata probe (tests). When `probeModels` is set, this
   * is skipped so a test that replaces the model probe does not spawn Claude.
   */
  probeClaudeCatalog?: (cwd: string) => Promise<ClaudeCatalogProbe>
  experimentalClaudeOpenAiChatEnabled?: boolean
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

/**
 * One Claude metadata probe for this request: models, account, slash commands
 * and output styles. A test that injects `probeModels` skips it.
 */
function claudeCatalogFor(
  ctx: HarnessResourcesRpcContext,
  apiProviderId: string | null,
  cwd: string,
  force = false,
): (() => Promise<ClaudeCatalogProbe>) | null {
  if (ctx.probeModels) return null
  if (ctx.probeClaudeCatalog) {
    const probe = ctx.probeClaudeCatalog
    let pending: Promise<ClaudeCatalogProbe> | null = null
    return () => (pending ??= probe(cwd))
  }
  const binaryPath = resolveClaudeBinaryPath({ harnesses: ctx.harnesses })
  if (!binaryPath) {
    // Same resolver the turn runner uses, so this also predicts why sends
    // fail with "Claude Agent SDK binary not available".
    console.warn(
      '[harness.resources] claude model probe skipped: no Agent SDK binary on this node ' +
        '(reinstall the optional platform package or set SUPERONE_CLAUDE_BINARY)',
    )
    return async () => EMPTY_CLAUDE_CATALOG
  }
  let pending: Promise<ClaudeCatalogProbe> | null = null
  return () => (pending ??= getNodeClaudeCatalog({
    cwd,
    binaryPath,
    env: claudeAccountProbeEnv(apiProviderId),
    accountScope: claudeCatalogCacheScope(apiProviderId),
    force,
  }))
}

/** Probe the node's own harness for its model catalog (Claude and Codex). */
function defaultProbeModels(
  ctx: HarnessResourcesRpcContext,
  apiProviderId: string | null,
  claudeCatalog: (() => Promise<ClaudeCatalogProbe>) | null,
  force = false,
): (harnessId: string, cwd: string) => Promise<ModelOption[]> {
  return async (harnessId) => {
    if (harnessId === 'codex') {
      try {
        return await getNodeCodexModelCatalog({
          apiProviderId,
          harnesses: ctx.harnesses,
          force,
        })
      } catch (err) {
        console.warn(
          '[harness.resources] codex model probe failed:',
          err instanceof Error ? err.message : err,
        )
        return []
      }
    }
    if (harnessId !== 'claude' || !claudeCatalog) return []
    return (await claudeCatalog()).models
  }
}

function mapThrown(err: unknown): HarnessResourcesRpcResult {
  const e = err as { code?: string; message?: string }
  const code = (e.code as RpcErrorCode | undefined) ?? 'internal'
  return { error: { code, message: e.message || 'internal error' } }
}

export const HARNESS_RESOURCES_RPC_METHODS: ReadonlySet<string> = new Set(['harness.resources', 'harness.connect'])

/**
 * Dispatch harness.resources | harness.connect. Returns null for other methods.
 */
export async function dispatchHarnessResourcesRpc(
  method: string,
  payload: unknown,
  ctx: HarnessResourcesRpcContext,
): Promise<HarnessResourcesRpcResult | null> {
  if (!HARNESS_RESOURCES_RPC_METHODS.has(method)) return null
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
    const providerOptions = {
      experimentalClaudeOpenAiChatEnabled:
        ctx.experimentalClaudeOpenAiChatEnabled ?? false,
    }
    const openCodeProvider = !harnessId || harnessId === 'opencode' ? resolveNodeOpenCodeProvider(ctx.providers, apiProviderId) : null
    const nativeOpenCode = !ctx.probeModels && (!harnessId || harnessId === 'opencode')
      ? await discoverOpenCodeV2Resources(project.path, { harnesses: ctx.harnesses, env: openCodeProvider?.env })
      : null

    const listModels = (hid: string, apiId?: string | null): ModelOption[] => {
      if (hid === 'opencode' && openCodeProvider) return openCodeProvider.models
      return listHarnessProviderModels(
        ctx.providers,
        hid,
        apiId ?? null,
        providerOptions,
      ) as ModelOption[]
    }

    const force = p.force === true
    const claudeCatalog = claudeCatalogFor(ctx, apiProviderId ?? null, project.path, force)

    // No bound credential: ask the harness on this node what it serves. The
    // built-in slug table only stands in when that probe comes back empty.
    const probeModels = async (hid: string): Promise<ModelOption[]> => {
      if (hid === 'opencode' && nativeOpenCode) return nativeOpenCode.models
      const probe = ctx.probeModels ?? defaultProbeModels(ctx, apiProviderId ?? null, claudeCatalog, force)
      const probed = await probe(hid, project.path)
      if (probed.length > 0) return probed
      // Substituting the built-in slug table is a lie the client cannot detect —
      // it looks like a real catalog. Say so here so `journalctl -u superone`
      // explains a stale picker instead of leaving it to guesswork.
      console.warn(
        `[harness.resources] ${hid} probe returned no models; serving the built-in fallback table`,
      )
      return listHarnessModels(
        ctx.providers,
        hid,
        apiProviderId ?? null,
        providerOptions,
      ) as ModelOption[]
    }

    const bundle = await collectHarnessResources({
      projectPath: project.path,
      homeDir: ctx.homeDir,
      listModels,
      probeModels,
      ...(claudeCatalog ? {
        probeAccount: async () => (await claudeCatalog()).account,
        probeSlashCommands: async () => (await claudeCatalog()).slashCommands,
        probeOutputStyles: async () => (await claudeCatalog()).outputStyles,
      } : {}),
      apiProviderId: apiProviderId ?? null,
      harnessId,
    })

    if (nativeOpenCode) bundle.opencode = { ...nativeOpenCode, ...(openCodeProvider ? { models: openCodeProvider.models } : {}), permissionModes: [] }

    return { result: bundle }
  } catch (err) {
    return mapThrown(err)
  }
}
