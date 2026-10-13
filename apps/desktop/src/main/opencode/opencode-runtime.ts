import { buildOpenCodeHostPermissionRules as hostPermissionRules, reconcileOpenCodePermissions as nativePermissions } from '@superone/opencode/permissions'
import { superoneSystemPrompt } from '@superone/shared/superone-system-prompt'
import type { McpLocalConfig, McpRemoteConfig, PermissionRuleset } from '@opencode-ai/sdk/v2'
import type {
  ContextUsageInfo,
  EffortLevel,
  ImageAttachment,
  McpServerConfig,
  McpServerInfo,
  ModelOption,
  OpenCodeResources,
  PermissionMode,
  SlashCommandInfo,
  SendMessageRequest,
} from '@superone/shared/agent-types'
import {
  OpenCodeClient,
  parseOpenCodeAgents,
  parseModels,
  parseOpenCodeCommands,
  startOpenCodeServer,
  toOpenCodeMcpConfig,
  withOpenCodeLocalCommands,
  type OpenCodeEvent,
  type OpenCodeServerHandle,
} from './opencode-client'
import type { OpenCodeV2Event } from './opencode-v2-types'
import { startOpenCodeSessionServer } from '@superone/opencode/owned-service'
import { startOpenCodeCatalogServer } from '@superone/opencode/launch'
import { app } from 'electron'
import { join } from 'node:path'
import { nativeForkBoundary } from '@superone/opencode/native-history'
import { listMcpConfigs } from '../mcp-config-service'
import log from '../logger'
import {
  getSuperoneMcpHttpConfig,
  getSuperoneMcpStdioConfig,
} from '../mcp/superone-mcp-stdio-state'
import { listAllHostOwnedSuperoneBareNamesForRecognition, listOpenCodeAutoAllowSuperoneBareNames } from '../mcp/superone-host-owned-tools'

const SUPERONE_MCP_NAME = 'superone'

export type { OpenCodeRuntimeConfig, OpenCodeRuntimeEvent, OpenCodeFileChange, OpenCodeRuntimeOptions, OpenCodeRuntime } from '@superone/opencode/runtime-types'
import type { OpenCodeRuntimeConfig, OpenCodeRuntimeEvent, OpenCodeRuntimeOptions, OpenCodeRuntime } from '@superone/opencode/runtime-types'

/**
 * SuperOne-owned MCP tools that must not block OpenCode turns.
 * Names come from superone-host-owned-tools (Claude/Codex/ACP parity).
 */
export function buildOpenCodeHostPermissionRules(): PermissionRuleset {
  return hostPermissionRules(listOpenCodeAutoAllowSuperoneBareNames())
}
export function reconcileOpenCodePermissions(existing: PermissionRuleset = []): PermissionRuleset {
  return nativePermissions(existing, listOpenCodeAutoAllowSuperoneBareNames(), listAllHostOwnedSuperoneBareNamesForRecognition())
}

function eventSessionId(event: OpenCodeEvent): string | undefined {
  if (!('properties' in event) || !event.properties || typeof event.properties !== 'object') return undefined
  const sessionId = (event.properties as { sessionID?: unknown }).sessionID
  return typeof sessionId === 'string' ? sessionId : undefined
}

export { errorMessage, closeServer, withAbortSignal } from '@superone/opencode/runtime-helpers'
import { errorMessage, closeServer, withAbortSignal } from '@superone/opencode/runtime-helpers'

/** Protocol-specific MCP registration; `host` marks SuperOne's own server. */
export type { OpenCodeMcpRegistrar } from '@superone/opencode/runtime-types'
import type { OpenCodeMcpRegistrar } from '@superone/opencode/runtime-types'

/**
 * Register the project's MCP servers plus SuperOne's host server (shared HTTP,
 * falling back to stdio) and disconnect the ones no longer configured.
 */
export async function syncMcpServers<T>(
  registrar: OpenCodeMcpRegistrar<T>,
  cwd: string,
  sessionId: string,
  previousNames: Set<string>,
): Promise<Set<string>> {
  const configs = new Map(
    listMcpConfigs(cwd).flatMap((config) => {
      if (config.name === SUPERONE_MCP_NAME) return []
      const mapped = registrar.toConfig(config, false)
      return mapped ? [[config.name, mapped] as const] : []
    }),
  )
  const superoneHttp = getSuperoneMcpHttpConfig(sessionId)
  const superoneStdio = getSuperoneMcpStdioConfig(sessionId)
  const hasSuperone = Boolean(superoneHttp || superoneStdio)
  const nextNames = new Set(configs.keys())
  if (hasSuperone) nextNames.add(SUPERONE_MCP_NAME)

  for (const name of previousNames) {
    if (!nextNames.has(name)) await registrar.disconnect(name).catch(() => undefined)
  }
  await Promise.all([...configs].map(([name, config]) => registrar.add(name, config)))

  const addHost = async (config: Omit<McpServerConfig, 'name' | 'scope'>) => {
    const mapped = registrar.toConfig({ name: SUPERONE_MCP_NAME, scope: 'project', ...config }, true)
    if (mapped) await registrar.add(SUPERONE_MCP_NAME, mapped)
  }

  if (superoneHttp) {
    try {
      await addHost({ type: 'http', url: superoneHttp.url, headers: superoneHttp.headers })
      return nextNames
    } catch (err) {
      if (!superoneStdio) throw err
      log.warn('[opencode] shared HTTP MCP registration failed; falling back to stdio:', err)
      await registrar.disconnect(SUPERONE_MCP_NAME).catch(() => undefined)
    }
  }

  if (superoneStdio) {
    await addHost({ type: 'stdio', command: superoneStdio.command, args: superoneStdio.args, env: superoneStdio.env })
  }
  return nextNames
}

function openCodeV1McpRegistrar(client: OpenCodeClient): OpenCodeMcpRegistrar<McpLocalConfig | McpRemoteConfig> {
  return {
    toConfig: (config, host) => {
      const mapped = toOpenCodeMcpConfig(config)
      return host && mapped?.type === 'local' ? { ...mapped, timeout: 60_000 } : mapped
    },
    add: (name, config) => client.addMcp(name, config),
    disconnect: (name) => client.disconnectMcp(name),
  }
}

export function startOpenCodeServerFromConfig(
  config: OpenCodeRuntimeConfig,
  cwd: string,
  signal?: AbortSignal,
): Promise<OpenCodeServerHandle> {
  return startOpenCodeServer({
    binaryPath: config.binaryPath,
    cwd,
    env: config.env,
    serverUrl: config.serverUrl,
    serverPassword: config.serverPassword,
    timeoutMs: config.startupTimeoutMs,
    signal,
  })
}

export async function createOpenCodeRuntime(opts: OpenCodeRuntimeOptions): Promise<OpenCodeRuntime> {
  const server = opts.config.serviceHome ? await startOpenCodeSessionServer({ ...opts.config, sessionId: opts.sessionId, nativeSessionId: opts.providerSessionId,
    hostMcp: getSuperoneMcpHttpConfig(opts.sessionId),
    cwd: opts.cwd, signal: opts.signal, timeoutMs: opts.config.startupTimeoutMs }) : await startOpenCodeServerFromConfig(opts.config, opts.cwd, opts.signal)
  if (server.protocol === 'v2') {
    try {
      const { createOpenCodeV2Runtime } = await import('./opencode-v2-runtime')
      return await createOpenCodeV2Runtime(server, opts)
    } catch (error) {
      await closeServer(server)
      throw error
    }
  }
  let closing = false
  try {
    const client = new OpenCodeClient({ baseUrl: server.url, directory: opts.cwd, password: server.password })
    const mcpRegistrar = openCodeV1McpRegistrar(client)
    let mcpNames = await withAbortSignal(syncMcpServers(mcpRegistrar, opts.cwd, opts.sessionId, new Set()), opts.signal)
    const [providers, agents, commands] = await withAbortSignal(
      Promise.all([client.providerList(), client.agents(), client.commands()]),
      opts.signal,
    )
    const permission = buildOpenCodeHostPermissionRules()
    const session = opts.providerSessionId
      ? { id: opts.providerSessionId }
      : await withAbortSignal(client.createSession(permission), opts.signal)
    if (opts.providerSessionId) {
      const existing = await withAbortSignal(client.sessionPermissions(session.id), opts.signal)
      await withAbortSignal(client.updatePermission(session.id, reconcileOpenCodePermissions(existing)), opts.signal)
    }

    const abortController = new AbortController()
    const [stream, initialTodos, pendingInteractions] = await withAbortSignal(
      Promise.all([
        client.eventStream(abortController.signal),
        client.todos(session.id).catch(() => []),
        client.pendingInteractions(session.id).catch(() => ({ permissions: [], questions: [] })),
      ]),
      opts.signal,
    )
    const subscriptionPromise = (async () => {
      try {
        for await (const event of stream) {
          if (event.type === 'mcp.tools.changed') {
            opts.onEvent(event)
            continue
          }
          const sessionId = eventSessionId(event)
          if (sessionId !== session.id) continue
          opts.onEvent(event)
        }
        if (!closing && !abortController.signal.aborted) {
          opts.onEvent({ type: 'runtime.error', properties: { message: 'OpenCode event stream closed unexpectedly' } })
        }
      } catch (error) {
        if (!closing && !abortController.signal.aborted) {
          opts.onEvent({ type: 'runtime.error', properties: { message: errorMessage(error) } })
        }
      }
    })()

    if (server.exited) {
      void server.exited.then(({ code, signal }) => {
        if (!closing) {
          opts.onEvent({
            type: 'runtime.error',
            properties: { message: `OpenCode server exited unexpectedly (${code ?? signal ?? 'unknown'})` },
          })
        }
      })
    }

    let selectedAgent = opts.permissionMode === 'plan' ? 'plan' : undefined
    const selectAgent = (agent: string | undefined) => (selectedAgent = agent ?? selectedAgent)
    const models = parseModels(providers)
    const parsedAgents = parseOpenCodeAgents(agents)
    return {
      sessionId: session.id,
      get agent() { return selectedAgent },
      models,
      agents: parsedAgents,
      commands: withOpenCodeLocalCommands(parseOpenCodeCommands(commands)),
      snapshotEvents: [
        { id: 'snapshot-todos', type: 'todo.updated', properties: { sessionID: session.id, todos: initialTodos } },
        ...pendingInteractions.permissions.map((request) => ({
          id: `snapshot-${request.id}`,
          type: 'permission.v2.asked' as const,
          properties: request,
        })),
        ...pendingInteractions.questions.map((request) => ({
          id: `snapshot-${request.id}`,
          type: 'question.v2.asked' as const,
          properties: request,
        })),
      ],
      setTitle: (title) => client.updateSessionTitle(session.id, title),
      prompt: (text, model, effort, images, agent) => client.promptAsync(session.id, {
        text,
        model,
        variant: effort,
        images,
        agent: selectAgent(agent),
        system: superoneSystemPrompt(opts.systemPromptAppend),
      }),
      command: (name, args, model, effort, images, agent) => client.command(session.id, {
        command: name,
        arguments: args,
        model,
        variant: effort,
        images,
        agent: selectAgent(agent),
      }),
      shell: (command, model, agent) => client.shell(session.id, {
        command,
        model,
        agent: selectAgent(agent) ?? parsedAgents[0]?.id ?? 'build',
      }),
      init: (model) => client.initSession(session.id, model),
      compact: (model) => client.summarize(session.id, model),
      share: () => client.shareSession(session.id),
      unshare: () => client.unshareSession(session.id),
      getContextUsage: () => client.contextUsage(session.id, models),
      diff: (messageId) => client.diff(session.id, messageId),
      revert: (messageId) => client.revert(session.id, messageId),
      unrevert: () => client.unrevert(session.id),
      setModel: async () => undefined,
      cancel: () => client.abort(session.id),
      permissionReply: (requestId, reply) => client.permissionReply(requestId, reply),
      questionReply: (requestId, answers) => client.questionReply(requestId, answers),
      questionReject: (requestId) => client.questionReject(requestId),
      getMcpServerStatus: () => client.mcpStatus(),
      authenticateMcp: async (name) => {
        if (opts.config.serverUrl?.trim()) {
          throw new Error('MCP OAuth is only supported for a local OpenCode runtime')
        }
        mcpNames = await syncMcpServers(mcpRegistrar, opts.cwd, opts.sessionId, mcpNames)
        await client.authenticateMcp(name)
      },
      reconnectMcp: async (name) => {
        mcpNames = await syncMcpServers(mcpRegistrar, opts.cwd, opts.sessionId, mcpNames)
        await client.disconnectMcp(name).catch(() => undefined)
        await client.connectMcp(name)
      },
      toggleMcpServer: async (name, enabled) => {
        if (enabled) {
          mcpNames = await syncMcpServers(mcpRegistrar, opts.cwd, opts.sessionId, mcpNames)
          await client.connectMcp(name)
        } else {
          await client.disconnectMcp(name)
        }
      },
      reloadMcpServers: async () => {
        mcpNames = await syncMcpServers(mcpRegistrar, opts.cwd, opts.sessionId, mcpNames)
      },
      close: async () => {
        if (closing) return
        closing = true
        abortController.abort()
        await subscriptionPromise.catch(() => undefined)
        await closeServer(server)
      },
    }
  } catch (error) {
    closing = true
    await closeServer(server)
    throw error
  }
}

/** Models, agents and commands from a short-lived server, for the harness picker. */
export async function probeOpenCodeResources(config: OpenCodeRuntimeConfig & { cwd: string }): Promise<OpenCodeResources> {
  const server = await startOpenCodeCatalogServer({ ...config, cwd: config.cwd, timeoutMs: config.startupTimeoutMs })
  try {
    if (server.protocol === 'v2') {
      const { OpenCodeV2Client } = await import('./opencode-v2-client')
      return await new OpenCodeV2Client({ baseUrl: server.url, directory: config.cwd, password: server.password }).resources()
    }
    const client = new OpenCodeClient({ baseUrl: server.url, directory: config.cwd, password: server.password })
    const [providers, agents, commands] = await Promise.all([client.providerList(), client.agents(), client.commands()])
    return {
      models: parseModels(providers),
      agents: parseOpenCodeAgents(agents),
      commands: withOpenCodeLocalCommands(parseOpenCodeCommands(commands)),
    }
  } finally {
    await server.close()
  }
}

/** Session operations outside a live runtime (fork, side-chat cleanup). */
export interface OpenCodeSessionAdmin {
  forkSession(sessionId: string, messageId?: string): Promise<{ id: string; directory: string }>
  moveSession(sessionId: string, directory: string): Promise<void>
  deleteSession(sessionId: string): Promise<void>
}

/** Runs `fn` against a short-lived server started from the session's config. */
export async function withOpenCodeSessionAdmin<T>(
  config: OpenCodeRuntimeConfig,
  cwd: string,
  fn: (admin: OpenCodeSessionAdmin) => Promise<T>,
  sessionId?: string,
  nativeSessionId?: string,
): Promise<T> {
  const serviceHome = config.serviceHome ?? (typeof app?.getPath === 'function' ? join(app.getPath('userData'), 'opencode-services') : undefined)
  const server = serviceHome && nativeSessionId ? await startOpenCodeSessionServer({ ...config, cwd, serviceHome,
    sessionId: sessionId ?? `admin-${nativeSessionId}`, nativeSessionId, admin: true,
    ...(sessionId ? { hostMcp: getSuperoneMcpHttpConfig(sessionId) } : {}),
  }) : await startOpenCodeServerFromConfig(config, cwd)
  try {
    const clientOptions = { baseUrl: server.url, directory: cwd, password: server.password }
    if (server.protocol === 'v2') {
      const { OpenCodeV2Client } = await import('./opencode-v2-client')
      const client = new OpenCodeV2Client(clientOptions)
      return await fn({ forkSession: async (id, anchor) => client.forkSession(id, nativeForkBoundary(await client.messages(id, { order: 'asc' }), anchor)),
        moveSession: (id, directory) => client.moveSession(id, directory), deleteSession: id => client.deleteSession(id) })
    }
    return await fn(new OpenCodeClient(clientOptions))
  } finally {
    await server.close()
  }
}
