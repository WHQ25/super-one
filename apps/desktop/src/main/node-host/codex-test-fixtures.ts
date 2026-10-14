import { vi } from 'vitest'
import type { CodexAuthStatus, CodexSetAuthRequest } from '@superone/shared/agent-types'
import type { DesktopCodexServices } from './desktop-codex-methods'

/** B's window Codex services, answering without an app-server. */
export function fakeCodexServices() {
  const accounts = {
    list: vi.fn(async () => [{ id: 'cli', isDefault: true, signedIn: true, authMode: 'chatgpt', email: 'b@example.com' }]),
    setDefault: vi.fn(async () => {}),
    start: vi.fn(async (type: string, accountId?: string) => ({
      type, loginId: 'login-1', verificationUrl: 'https://auth.openai.com/device', userCode: 'ABCD-EFGH', accountId: accountId ?? 'acct-1',
    })),
  }
  const status = (request: CodexSetAuthRequest): CodexAuthStatus => ({
    mode: request.mode, resolvedMode: request.mode === 'auto' ? 'chatgpt' : request.mode, hasEnvApiKey: false, hasSessionApiKey: !!request.apiKey, isRunning: false,
  })
  const service = {
    accounts,
    isRuntimeReady: vi.fn(() => true),
    getAuthStatus: vi.fn(() => status({ mode: 'auto' })),
    setAuth: vi.fn((_path: string, request: CodexSetAuthRequest) => status(request)),
    getAccountStatus: vi.fn(async () => ({ signedIn: true, authMode: 'chatgpt', email: 'b@example.com', planType: 'pro', requiresOpenaiAuth: true })),
    cancelAccountLogin: vi.fn(async () => {}),
    logoutAccount: vi.fn(async () => ({ signedIn: false })),
    getRateLimits: vi.fn(async () => ({ limitId: 'codex', primary: { usedPercent: 40, windowDurationMins: 300, resetsAt: 1 } })),
    getAccountUsage: vi.fn(async () => null),
    getServerDiagnostics: vi.fn(async () => null),
    getConfigRequirements: vi.fn(async () => null),
    consumeRateLimitReset: vi.fn(async () => 'reset' as const),
    loginMcpServerOauth: vi.fn(async () => ({ success: true })),
    detectExternalAgentConfig: vi.fn(async () => []),
    importExternalAgentConfig: vi.fn(async () => ({ successCount: 0, failureCount: 0 })),
  }
  const plugins = {
    listPlugins: vi.fn(async () => [{ key: 'demo@mp', name: 'demo', installed: true }]),
    listMarketplacePlugins: vi.fn(async () => [{ key: 'demo@mp', name: 'demo', installed: true }, { key: 'other@mp', name: 'other', installed: false }]),
    installPlugin: vi.fn(async () => {}),
    uninstallPlugin: vi.fn(async () => {}),
  }
  const marketplace = {
    add: vi.fn(async () => ({ marketplaceName: 'mp', installedRoot: '/mp', alreadyAdded: false })),
    remove: vi.fn(async () => {}),
    upgrade: vi.fn(async () => ({ selectedMarketplaces: [], upgradedRoots: [], errors: [] })),
  }
  return { service, plugins, marketplace, services: { service, plugins, marketplace } as unknown as DesktopCodexServices }
}
