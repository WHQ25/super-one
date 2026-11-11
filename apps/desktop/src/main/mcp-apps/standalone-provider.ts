import { homedir } from 'node:os'
import { mcpServerConfigFingerprint } from '@superone/runtime/mcp-apps/identity'
import type { McpServerConfig } from '@superone/shared/agent-types'
import {
  hasMcpAppEntrypoint,
  parseMcpAppStandaloneSessionId,
  type McpAppEntrypointHarness,
} from '@superone/shared/mcp-app-entrypoints'
import {
  mcpAppResourceUri,
  McpAppsError,
  type McpAppOrigin,
  type McpAppsBinding,
  type McpAppsProvider,
  type McpToolDescriptor,
} from '@superone/shared/mcp-apps'
import { listCodexMcpConfigs } from '../codex-config-service'
import { listMcpConfigs } from '../mcp-config-service'
import { readClaudeMcpToken } from './claude-mcp-token'
import { getMcpAppEntrypointsStore, isTrustedProjectStdioServer } from './entrypoints-cache'
import { HostClients, hostClientConfig, type HostClientConfig, type HostClientTokenSource } from './host-client'
import { untilAborted } from './host-tools'

export interface StandaloneServerResolution {
  harness: McpAppEntrypointHarness
  projectPath: string
  cwd: string
  config: McpServerConfig
  hcConfig: HostClientConfig
  fingerprint: string
}

export interface StandaloneServerDeps {
  claudeConfigs?: (projectPath: string) => McpServerConfig[]
  codexConfigs?: (projectPath: string) => McpServerConfig[]
  isTrustedProjectStdio?: (projectPath: string, harness: McpAppEntrypointHarness, serverName: string) => boolean
}

const clientsByHarness: Record<McpAppEntrypointHarness, HostClients> = {
  claude: new HostClients('superone-mcp-apps-global-claude'),
  codex: new HostClients('superone-mcp-apps-global-codex'),
}

let activeDeps: StandaloneServerDeps = {}

export function setStandaloneMcpAppsDepsForTest(deps: StandaloneServerDeps = {}): void {
  activeDeps = deps
}

export function closeStandaloneMcpAppsClients(): void {
  for (const harness of ['claude', 'codex'] as const) {
    clientsByHarness[harness].close()
    clientsByHarness[harness] = new HostClients(`superone-mcp-apps-global-${harness}`)
  }
}

export function resolveStandaloneServerConfig(
  sessionId: string,
  serverName: string,
): StandaloneServerResolution {
  const standalone = parseMcpAppStandaloneSessionId(sessionId)
  if (!standalone) {
    throw new McpAppsError('not_connected', 'MCP Apps session unavailable')
  }
  const listConfigs = standalone.harness === 'claude'
    ? (activeDeps.claudeConfigs ?? listMcpConfigs)
    : (activeDeps.codexConfigs ?? listCodexMcpConfigs)
  const isTrusted = activeDeps.isTrustedProjectStdio ?? isTrustedProjectStdioServer
  const config = listConfigs(standalone.projectPath).find(item =>
    item.name === serverName
    && !item.disabled
    && !(standalone.harness === 'codex' && item.name === 'codex_apps'),
  )
  if (!config || (!standalone.projectPath && config.scope === 'project')) {
    throw new McpAppsError('not_connected', 'This MCP server is not available')
  }
  const hcConfig = hostClientConfig(config)
  if (!hcConfig) {
    throw new McpAppsError('not_connected', 'This MCP server cannot be reached directly')
  }
  if (
    config.scope === 'project'
    && hcConfig.type === 'stdio'
    && !isTrusted(standalone.projectPath, standalone.harness, serverName)
  ) {
    throw new McpAppsError('denied', 'Project stdio MCP server is not trusted yet')
  }
  return {
    harness: standalone.harness,
    projectPath: standalone.projectPath,
    cwd: standalone.projectPath || homedir(),
    config,
    hcConfig,
    fingerprint: mcpServerConfigFingerprint(config),
  }
}

export function getStandaloneMcpAppsProvider(
  binding: McpAppsBinding,
  origin: McpAppOrigin,
): McpAppsProvider {
  if (binding.node !== 'local' || origin.providerSessionId !== binding.session) {
    throw new McpAppsError('invalid', 'MCP App session binding mismatch')
  }
  const initial = resolveStandaloneServerConfig(binding.session, binding.server)
  if (initial.fingerprint !== binding.configFingerprint) {
    throw new McpAppsError('not_connected', 'MCP App server configuration changed')
  }
  const token: HostClientTokenSource | undefined = initial.harness === 'claude'
    ? {
        read: httpConfig => readClaudeMcpToken(null, binding.server, httpConfig),
        renew: async () => {},
      }
    : undefined

  return clientsByHarness[initial.harness].provider(binding, {
    config: () => resolveStandaloneServerConfig(binding.session, binding.server).config,
    cwd: () => resolveStandaloneServerConfig(binding.session, binding.server).cwd,
    credentialScope: () => JSON.stringify([initial.harness, initial.projectPath]),
    providerSessionId: () => binding.session,
    assertBinding: () => {
      const current = resolveStandaloneServerConfig(binding.session, binding.server)
      if (current.fingerprint !== binding.configFingerprint) {
        throw new McpAppsError('not_connected', 'MCP App server configuration changed')
      }
    },
    token,
  })
}

export async function findStandaloneGlobalEntrypointCandidate(
  sessionId: string,
  serverName: string,
  toolName: string,
  signal: AbortSignal,
): Promise<{
  binding: McpAppsBinding
  origin: McpAppOrigin
  tool: McpToolDescriptor
  resourceUri: string
}> {
  const resolved = resolveStandaloneServerConfig(sessionId, serverName)
  const binding: McpAppsBinding = {
    node: 'local',
    session: sessionId,
    server: serverName,
    configGeneration: 0,
    configFingerprint: resolved.fingerprint,
    hostClient: true,
  }
  const origin: McpAppOrigin = { providerSessionId: sessionId }
  const provider = getStandaloneMcpAppsProvider(binding, origin)
  try {
    const tools = [...(await untilAborted(provider.tools(), signal)).values()]
    getMcpAppEntrypointsStore().recordSessionTools(
      resolved.projectPath,
      resolved.harness,
      serverName,
      resolved.fingerprint,
      tools,
    )
    const tool = tools.find(item => item.name === toolName && hasMcpAppEntrypoint(item, 'global'))
    const resourceUri = tool ? mcpAppResourceUri(tool) : undefined
    if (!tool || !resourceUri) {
      throw new McpAppsError('denied', 'This MCP App does not declare that entrypoint')
    }
    return { binding, origin, tool, resourceUri }
  } finally {
    provider.dispose()
  }
}
