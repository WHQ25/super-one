import { describe, expect, it, vi } from 'vitest'
import { mcpServerConfigFingerprint } from '@superone/runtime/mcp-apps/identity'
import type { McpServerConfig } from '@superone/shared/agent-types'
import type { BackendStartOptions } from '../types'

vi.mock('../../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

vi.mock('../../shell-path', async (original) => ({
  ...(await original<typeof import('../../shell-path')>()),
  ensureShellPath: async () => {},
  isShellPathReady: () => true,
}))

vi.mock('../../agent/resolve-cli', () => ({
  getNodeRuntime: vi.fn(() => ({})),
}))

vi.mock('../../database', () => ({
  getActiveProviderRaw: vi.fn(() => null),
}))

const mcpConfigs = vi.hoisted(() => ({
  list: [] as McpServerConfig[],
}))

vi.mock('../../codex-config-service', () => ({
  listCodexMcpConfigs: vi.fn(() => mcpConfigs.list),
}))

const prewarmMocks = vi.hoisted(() => ({
  prewarmCodexConnection: vi.fn(async () => ({
    connection: { request: vi.fn(async () => ({})), onNotification: vi.fn(() => () => {}), onRequest: vi.fn(() => () => {}) },
    onClosed: vi.fn(() => () => {}),
    close: vi.fn(async () => {}),
  })),
  prewarmCodexSession: vi.fn(async (_handle: unknown, session: { threadId: string | null; threadReady: boolean }) => {
    session.threadId = 'thr-host-empty'
    session.threadReady = true
    return 'thr-host-empty'
  }),
}))

vi.mock('../../codex/codex-turn', async (original) => ({
  ...(await original<typeof import('../../codex/codex-turn')>()),
  prewarmCodexConnection: prewarmMocks.prewarmCodexConnection,
  prewarmCodexSession: prewarmMocks.prewarmCodexSession,
}))

import { CodexBackend, type CodexServiceDeps } from './codex-backend'

function makeStartOpts(): BackendStartOptions {
  return {
    sessionId: 'sess-empty',
    projectPath: '/tmp/proj',
    cwd: '/tmp/proj',
    config: { apiKey: 'codex-key', model: 'gpt-5.4' },
    permissionMode: 'default',
    abortController: new AbortController(),
  }
}

function makeFakeService(): CodexServiceDeps {
  return {
    getProjectAuth: () => ({ mode: 'auto' }),
    onAuthChanged: () => () => {},
    listModels: async () => ({ models: [], defaultModel: null }),
    getRateLimits: async () => ({ snapshots: [], credits: null, planType: null }),
  } as unknown as CodexServiceDeps
}

describe('CodexBackend MCP Apps host bindings on empty sessions', () => {
  it('bootstraps a Codex thread and returns host bindings before the first turn runs', async () => {
    const bitsConfig: McpServerConfig = {
      name: 'bits-and-bolts',
      type: 'http',
      url: 'https://bits-and-bolts.example/mcp',
      scope: 'user',
    }
    mcpConfigs.list = [bitsConfig, { name: 'codex_apps', type: 'http', url: 'https://apps.example', scope: 'user' }]

    const backend = new CodexBackend(makeFakeService())
    const providerIds: string[] = []
    backend.onProviderSessionId((id) => providerIds.push(id))

    await backend.start(makeStartOpts())
    const bindings = await backend.getMcpAppsHostBindings()

    expect(prewarmMocks.prewarmCodexSession).toHaveBeenCalledTimes(1)
    expect(providerIds).toEqual(['thr-host-empty'])
    expect(bindings).toEqual([
      {
        binding: {
          node: 'local',
          session: 'sess-empty',
          server: 'bits-and-bolts',
          account: undefined,
          configGeneration: 0,
          configFingerprint: mcpServerConfigFingerprint(bitsConfig),
        },
        origin: { providerSessionId: 'thr-host-empty' },
      },
    ])

    await backend.close()
  })
})
