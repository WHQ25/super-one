import type { RpcContext, RpcExtensionDispatch } from '@superone/runtime/server'
import { CODEX_RPC_METHODS, dispatchCodexRpc, type CodexAdminPort } from '@superone/runtime/server/rpc-codex'
import type { CodexExperimentService } from '../codex/codex-experiment-service'
import type { CodexPluginsService } from '../codex/codex-plugins-service'
import type { CodexMarketplaceService } from '../codex/codex-marketplace-service'

/** The Codex services this desktop's window uses, keyed by project folder. */
export interface DesktopCodexServices {
  service: Pick<CodexExperimentService,
    | 'getAuthStatus' | 'setAuth' | 'isRuntimeReady' | 'accounts' | 'getAccountStatus' | 'cancelAccountLogin' | 'logoutAccount'
    | 'getRateLimits' | 'getAccountUsage' | 'getServerDiagnostics' | 'getConfigRequirements' | 'consumeRateLimitReset'
    | 'loginMcpServerOauth' | 'detectExternalAgentConfig' | 'importExternalAgentConfig'
  >
  plugins: Pick<CodexPluginsService, 'listPlugins' | 'listMarketplacePlugins' | 'installPlugin' | 'uninstallPlugin'>
  marketplace: Pick<CodexMarketplaceService, 'add' | 'remove' | 'upgrade'>
}

/** The window's Codex services as the node's `codex.*` port, with projects addressed by id. */
function desktopCodexPort({ service, plugins, marketplace }: DesktopCodexServices, ctx: RpcContext): CodexAdminPort {
  const path = (projectId: string) => {
    const project = ctx.projects?.get(projectId)
    if (!project) throw Object.assign(new Error('project not found'), { code: 'not_found' })
    return project.path
  }
  return {
    getAuthStatus: (projectId) => service.getAuthStatus(path(projectId)),
    setAuth: (projectId, request) => service.setAuth(path(projectId), request),
    isBinaryReady: () => service.isRuntimeReady(),
    accounts: service.accounts,
    getAccountStatus: (apiProviderId) => service.getAccountStatus(apiProviderId),
    // The client is not at this desktop's screen: no localhost browser callback.
    startAccountLogin: (_projectId, accountId) => service.accounts.start('chatgptDeviceCode', accountId),
    cancelAccountLogin: (loginId) => service.cancelAccountLogin(loginId),
    logoutAccount: (apiProviderId) => service.logoutAccount(apiProviderId),
    getRateLimits: (projectId, apiProviderId, force, preferCached) => service.getRateLimits(path(projectId), apiProviderId, force, preferCached),
    getAccountUsage: (projectId, apiProviderId, threadId, force, preferCached) => service.getAccountUsage(path(projectId), apiProviderId, threadId, force, preferCached),
    getServerDiagnostics: (projectId, apiProviderId) => service.getServerDiagnostics(path(projectId), apiProviderId),
    getConfigRequirements: (projectId, apiProviderId) => service.getConfigRequirements(path(projectId), apiProviderId),
    consumeRateLimitReset: (projectId, apiProviderId, creditId) => service.consumeRateLimitReset(path(projectId), apiProviderId, creditId),
    // The authorization page opens on the client's screen, not this desktop's.
    loginMcpOauth: (projectId, serverName, apiProviderId, options, openUrl) =>
      service.loginMcpServerOauth(path(projectId), serverName, apiProviderId, openUrl, options),
    detectExternalAgent: (projectId, apiProviderId) => service.detectExternalAgentConfig(path(projectId), apiProviderId),
    importExternalAgent: (projectId, items, apiProviderId) => service.importExternalAgentConfig(path(projectId), items, apiProviderId),
    // Plugins and marketplaces follow the window's, which are not per API provider.
    listPlugins: (projectId) => plugins.listPlugins(path(projectId)),
    listMarketplacePlugins: (projectId) => plugins.listMarketplacePlugins(path(projectId)),
    installPlugin: (projectId, key) => plugins.installPlugin(path(projectId), key),
    uninstallPlugin: (projectId, key) => plugins.uninstallPlugin(path(projectId), key),
    marketplaceAdd: (projectId, request) => marketplace.add(path(projectId), request),
    marketplaceRemove: (projectId, marketplaceName) => marketplace.remove(path(projectId), marketplaceName),
    marketplaceUpgrade: (projectId, marketplaceName) => marketplace.upgrade(path(projectId), marketplaceName),
  }
}

/** The node's `codex.*` contract, as a CLI node serves it, over this desktop's Codex services. */
export function createDesktopCodexMethods(services: DesktopCodexServices): { dispatch: RpcExtensionDispatch; methods: ReadonlySet<string> } {
  return {
    dispatch: (method, payload, ctx) => dispatchCodexRpc(method, payload, { client: ctx.client, projects: ctx.projects, codex: desktopCodexPort(services, ctx) }),
    methods: CODEX_RPC_METHODS,
  }
}
