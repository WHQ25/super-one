import type { RpcContext, RpcExtensionDispatch, RpcResult } from '@superone/runtime/server'
import { asRecord, mapThrown, requireScopes } from '@superone/runtime/server/rpc-helpers'
import { collectHarnessResources } from '@superone/runtime/session'
import { OPERATION_SCOPES, type AuthScope } from '@superone/shared/environment'
import type { ClaudeResources } from '@superone/shared/agent-types'
import type { HarnessCatalog } from '../harness/harness-catalog'

/** What the catalog methods read: the window's probes and caches. */
export type DesktopCatalog = Pick<HarnessCatalog, 'connectClaude' | 'listModels'>

type Handler = (p: Record<string, unknown>, ctx: RpcContext) => Promise<unknown>

function optionalProvider(p: Record<string, unknown>): string | null {
  return typeof p.apiProviderId === 'string' && p.apiProviderId.trim() ? p.apiProviderId.trim() : null
}

/**
 * The node catalog contract a CLI node serves (`harness.resources`,
 * `provider.listModels`), answered from this desktop's window catalogs so
 * every client is offered the models the window would offer.
 */
export function createDesktopCatalogMethods(catalog: DesktopCatalog): { dispatch: RpcExtensionDispatch; methods: ReadonlySet<string> } {
  const handlers: Record<string, { scopes: readonly AuthScope[]; run: Handler }> = {
    'provider.listModels': {
      scopes: OPERATION_SCOPES.readEnvironment,
      run: async (p) => catalog.listModels(String(p.harness ?? p.harnessId ?? 'claude'), optionalProvider(p)),
    },
    'harness.resources': {
      // Project skills, commands and agents come with the models.
      scopes: [...OPERATION_SCOPES.readEnvironment, ...OPERATION_SCOPES.readWorkspace],
      run: async (p, ctx) => {
        const projectId = typeof p.projectId === 'string' ? p.projectId : ''
        if (!projectId) throw Object.assign(new Error('projectId required'), { code: 'invalid_argument' })
        const project = ctx.projects?.get(projectId)
        if (!project) throw Object.assign(new Error('project not found'), { code: 'not_found' })
        const harnessId = typeof p.harnessId === 'string' && p.harnessId.trim() ? p.harnessId.trim() : null
        const apiProviderId = optionalProvider(p)
        // One Claude probe answers models, account, slash commands and output styles.
        let claude: Promise<ClaudeResources> | null = null
        const claudeResources = () => (claude ??= catalog.connectClaude(false, apiProviderId))
        return collectHarnessResources({
          projectPath: project.path,
          listModels: () => [],
          probeModels: async (harness) => harness === 'claude' ? (await claudeResources()).models : catalog.listModels(harness, apiProviderId),
          probeAccount: async () => (await claudeResources()).account,
          probeSlashCommands: async () => (await claudeResources()).slashCommands,
          probeOutputStyles: async () => (await claudeResources()).outputStyles,
          apiProviderId,
          harnessId,
        })
      },
    },
  }

  const dispatch: RpcExtensionDispatch = async (method, payload, ctx): Promise<RpcResult | null> => {
    const handler = Object.hasOwn(handlers, method) ? handlers[method] : undefined
    if (!handler) return null
    const denied = requireScopes(ctx.client, handler.scopes)
    if (denied) return denied
    try {
      return { result: await handler.run(asRecord(payload), ctx) }
    } catch (err) {
      return mapThrown(err)
    }
  }
  return { dispatch, methods: new Set(Object.keys(handlers)) }
}
