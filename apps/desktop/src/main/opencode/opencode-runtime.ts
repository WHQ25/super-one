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
import { listMcpConfigs } from '../mcp-config-service'
import log from '../logger'
import {
  getSuperoneMcpHttpConfig,
  getSuperoneMcpStdioConfig,
} from '../mcp/superone-mcp-stdio-state'
import { listAllHostOwnedSuperoneBareNamesForRecognition, listOpenCodeAutoAllowSuperoneBareNames } from '../mcp/superone-host-owned-tools'

const SUPERONE_MCP_NAME = 'superone'

export interface OpenCodeRuntimeConfig {
  binaryPath?: string
  serverUrl?: string
  serverPassword?: string
  env?: Record<string, string>
  startupTimeoutMs?: number
}

/** 2.x events are wrapped: several share a `type` with 1.x events but not their shape. */
export type OpenCodeRuntimeEvent = OpenCodeEvent | {
  type: 'runtime.error'
  properties: { message: string }
} | {
  type: 'v2'
  event: OpenCodeV2Event
}

export interface OpenCodeFileChange {
  file?: string
  additions: number
  deletions: number
}

export interface OpenCodeRuntimeOptions {
  signal?: AbortSignal
  sessionId: string
  cwd: string
  config: OpenCodeRuntimeConfig
  providerSessionId?: string
  /** Legacy launch input, used only to restore a previously selected Plan agent. */
  permissionMode: PermissionMode
  onEvent: (event: OpenCodeRuntimeEvent) => void
  systemPromptAppend?: string
}

export interface OpenCodeRuntime {
  readonly sessionId: string
  readonly agent?: string
  readonly models: ModelOption[]
  readonly agents: Array<{ id: string; name: string; description?: string }>
  readonly commands: SlashCommandInfo[]
  /** Replayed once on attach: todos and interactions still pending on the session. */
  readonly snapshotEvents: OpenCodeRuntimeEvent[]
  setTitle(title: string): Promise<void>
  prompt(text: string, model?: string, effort?: EffortLevel, images?: ImageAttachment[], agent?: string): Promise<void>
  command(name: string, args?: string, model?: string, effort?: EffortLevel, images?: ImageAttachment[], agent?: string): Promise<void>
  shell(command: string, model?: string, agent?: string): Promise<void>
  init(model?: string): Promise<void>
  compact(model?: string): Promise<void>
  share(): Promise<string>
  unshare(): Promise<void>
  getContextUsage(): Promise<ContextUsageInfo | null>
  /** Files changed from the turn of user message `messageId` through the latest turn. */
  diff(messageId: string): Promise<OpenCodeFileChange[]>
  revert(messageId: string): Promise<void>
  unrevert(): Promise<void>
  setModel(model: string): Promise<void>
  cancel(): Promise<void>
  permissionReply(requestId: string, reply: 'once' | 'always' | 'reject'): Promise<void>
  questionReply(requestId: string, answers: string[][]): Promise<void>
  questionReject(requestId: string): Promise<void>
  getMcpServerStatus(): Promise<McpServerInfo[]>
  authenticateMcp(name: string): Promise<void>
  reconnectMcp(name: string): Promise<void>
  toggleMcpServer(name: string, enabled: boolean): Promise<void>
  reloadMcpServers(): Promise<void>
  close(): Promise<void>
}

/**
 * SuperOne-owned MCP tools that must not block OpenCode turns.
 * Names come from superone-host-owned-tools (Claude/Codex/ACP parity).
 */
export function buildOpenCodeHostPermissionRules(): PermissionRuleset {
  return listOpenCodeAutoAllowSuperoneBareNames().map((name) => ({
    permission: `${SUPERONE_MCP_NAME}_${name}`,
    pattern: '*',
    action: 'allow' as const,
  }))
}

/** Remove the old SuperOne preset overlay, keeping native session rules intact. */
export function reconcileOpenCodePermissions(existing: PermissionRuleset = []): PermissionRuleset {
  const hostNames = new Set(listAllHostOwnedSuperoneBareNamesForRecognition().map((name) => `${SUPERONE_MCP_NAME}_${name}`))
  const isHostAllow = (rule: PermissionRuleset[number]) =>
    rule.action === 'allow' && rule.pattern === '*' && hostNames.has(rule.permission)
  const first = existing[0]
  const legacyPreset = first?.permission === '*' && first.pattern === '*' && existing.slice(1).every((rule) =>
    isHostAllow(rule) || (rule.action === 'allow' && rule.pattern === '*' && (rule.permission === 'question' || rule.permission === 'edit')))
  const nativeRules = legacyPreset ? [] : existing.filter((rule) => !isHostAllow(rule))
  return [...nativeRules, ...buildOpenCodeHostPermissionRules()]
}

function eventSessionId(event: OpenCodeEvent): string | undefined {
  if (!('properties' in event) || !event.properties || typeof event.properties !== 'object') return undefined
  const sessionId = (event.properties as { sessionID?: unknown }).sessionID
  return typeof sessionId === 'string' ? sessionId : undefined
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message
  if (error && typeof error === 'object') {
    const value = error as Record<string, unknown>
    const body = value.error ?? value.data ?? value.body
    if (body !== undefined) {
      try {
        return JSON.stringify(body)
      } catch {}
    }
  }
  return String(error)
}

export async function closeServer(server: OpenCodeServerHandle): Promise<void> {
  await server.close().catch(() => undefined)
}

export function withAbortSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(new Error('OpenCode runtime initialization aborted'))
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort)
      reject(new Error('OpenCode runtime initialization aborted'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

/** Protocol-specific MCP registration; `host` marks SuperOne's own server. */
export interface OpenCodeMcpRegistrar<T> {
  /** Null when the config cannot be registered (no command or URL). */
  toConfig(config: McpServerConfig, host: boolean): T | null
  add(name: string, config: T): Promise<void>
  disconnect(name: string): Promise<void>
}

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
  const server = await startOpenCodeServerFromConfig(opts.config, opts.cwd, opts.signal)
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
  const server = await startOpenCodeServerFromConfig(config, config.cwd)
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
): Promise<T> {
  const server = await startOpenCodeServerFromConfig(config, cwd)
  try {
    const clientOptions = { baseUrl: server.url, directory: cwd, password: server.password }
    if (server.protocol === 'v2') {
      const { OpenCodeV2Client } = await import('./opencode-v2-client')
      return await fn(new OpenCodeV2Client(clientOptions))
    }
    return await fn(new OpenCodeClient(clientOptions))
  } finally {
    await server.close()
  }
}
