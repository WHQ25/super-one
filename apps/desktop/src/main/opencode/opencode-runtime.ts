import type { PermissionRuleset, PermissionV2Request, QuestionV2Request, Todo } from '@opencode-ai/sdk/v2'
import type {
  ContextUsageInfo,
  EffortLevel,
  ImageAttachment,
  McpServerInfo,
  ModelOption,
  PermissionMode,
  SlashCommandInfo,
} from '@superone/shared/agent-types'
import {
  OpenCodeClient,
  parseModels,
  parseOpenCodeCommands,
  startOpenCodeServer,
  withOpenCodeLocalCommands,
  type OpenCodeEvent,
  type OpenCodeServerHandle,
} from './opencode-client'
import type { SnapshotFileDiff } from '@opencode-ai/sdk/v2'

export interface OpenCodeRuntimeConfig {
  binaryPath?: string
  serverUrl?: string
  serverPassword?: string
  env?: Record<string, string>
  startupTimeoutMs?: number
}

export type OpenCodeRuntimeEvent = OpenCodeEvent | {
  type: 'runtime.error'
  properties: { message: string }
}

export interface OpenCodeRuntimeOptions {
  sessionId: string
  cwd: string
  config: OpenCodeRuntimeConfig
  providerSessionId?: string
  permissionMode: PermissionMode
  onEvent: (event: OpenCodeRuntimeEvent) => void
}

export interface OpenCodeRuntime {
  readonly sessionId: string
  readonly models: ModelOption[]
  readonly agents: Array<{ id: string; name: string; description?: string }>
  readonly commands: SlashCommandInfo[]
  readonly initialTodos: Todo[]
  readonly pendingPermissions: PermissionV2Request[]
  readonly pendingQuestions: QuestionV2Request[]
  prompt(text: string, model?: string, effort?: EffortLevel, images?: ImageAttachment[], agent?: string): Promise<void>
  command(name: string, args?: string, model?: string, effort?: EffortLevel, images?: ImageAttachment[], agent?: string): Promise<void>
  init(model?: string): Promise<void>
  compact(model?: string): Promise<void>
  getContextUsage(): Promise<ContextUsageInfo | null>
  diff(messageId: string): Promise<SnapshotFileDiff[]>
  revert(messageId: string): Promise<void>
  unrevert(): Promise<void>
  setModel(model: string): Promise<void>
  setPermissionMode(mode: PermissionMode): Promise<void>
  cancel(): Promise<void>
  permissionReply(requestId: string, reply: 'once' | 'always' | 'reject'): Promise<void>
  questionReply(requestId: string, answers: string[][]): Promise<void>
  questionReject(requestId: string): Promise<void>
  getMcpServerStatus(): Promise<McpServerInfo[]>
  reconnectMcp(name: string): Promise<void>
  toggleMcpServer(name: string, enabled: boolean): Promise<void>
  close(): Promise<void>
}

export function buildOpenCodePermissionRules(mode: PermissionMode): PermissionRuleset {
  if (mode === 'bypassPermissions') {
    return [{ permission: '*', pattern: '*', action: 'allow' }]
  }
  if (mode === 'dontAsk') {
    return [
      { permission: '*', pattern: '*', action: 'deny' },
      { permission: 'question', pattern: '*', action: 'allow' },
    ]
  }
  return [
    { permission: '*', pattern: '*', action: 'ask' },
    ...(mode === 'acceptEdits' ? [{ permission: 'edit', pattern: '*', action: 'allow' as const }] : []),
    { permission: 'question', pattern: '*', action: 'allow' },
  ]
}

function eventSessionId(event: OpenCodeEvent): string | undefined {
  if (!('properties' in event) || !event.properties || typeof event.properties !== 'object') return undefined
  const sessionId = (event.properties as { sessionID?: unknown }).sessionID
  return typeof sessionId === 'string' ? sessionId : undefined
}

function errorMessage(error: unknown): string {
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

async function closeServer(server: OpenCodeServerHandle): Promise<void> {
  await server.close().catch(() => undefined)
}

export async function createOpenCodeRuntime(opts: OpenCodeRuntimeOptions): Promise<OpenCodeRuntime> {
  const server = await startOpenCodeServer({
    binaryPath: opts.config.binaryPath,
    cwd: opts.cwd,
    env: opts.config.env,
    serverUrl: opts.config.serverUrl,
    timeoutMs: opts.config.startupTimeoutMs,
  })
  let closing = false
  try {
    const client = new OpenCodeClient({ baseUrl: server.url, directory: opts.cwd, password: opts.config.serverPassword })
    const [providers, agents, commands] = await Promise.all([client.providerList(), client.agents(), client.commands()])
    const permission = buildOpenCodePermissionRules(opts.permissionMode)
    const session = opts.providerSessionId
      ? { id: opts.providerSessionId }
      : await client.createSession(permission)
    if (opts.providerSessionId) await client.updatePermission(session.id, permission)

    const abortController = new AbortController()
    const [stream, initialTodos, pendingInteractions] = await Promise.all([
      client.eventStream(abortController.signal),
      client.todos(session.id).catch(() => []),
      client.pendingInteractions(session.id).catch(() => ({ permissions: [], questions: [] })),
    ])
    const subscriptionPromise = (async () => {
      try {
        for await (const event of stream) {
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

    let permissionMode = opts.permissionMode
    const models = parseModels(providers)
    return {
      sessionId: session.id,
      models,
      agents: agents
        .filter((agent) => !agent.hidden)
        .map((agent) => ({ id: agent.name, name: agent.name, description: agent.description })),
      commands: withOpenCodeLocalCommands(parseOpenCodeCommands(commands)),
      initialTodos,
      pendingPermissions: pendingInteractions.permissions,
      pendingQuestions: pendingInteractions.questions,
      prompt: (text, model, effort, images, agent) => client.promptAsync(session.id, {
        text,
        model,
        variant: effort,
        images,
        agent: agent ?? (permissionMode === 'plan' ? 'plan' : undefined),
      }),
      command: (name, args, model, effort, images, agent) => client.command(session.id, {
        command: name,
        arguments: args,
        model,
        variant: effort,
        images,
        agent: agent ?? (permissionMode === 'plan' ? 'plan' : undefined),
      }),
      init: (model) => client.initSession(session.id, model),
      compact: (model) => client.summarize(session.id, model),
      getContextUsage: () => client.contextUsage(session.id, models),
      diff: (messageId) => client.diff(session.id, messageId),
      revert: (messageId) => client.revert(session.id, messageId),
      unrevert: () => client.unrevert(session.id),
      setModel: async () => undefined,
      setPermissionMode: async (mode) => {
        await client.updatePermission(session.id, buildOpenCodePermissionRules(mode))
        permissionMode = mode
      },
      cancel: () => client.abort(session.id),
      permissionReply: (requestId, reply) => client.permissionReply(requestId, reply),
      questionReply: (requestId, answers) => client.questionReply(requestId, answers),
      questionReject: (requestId) => client.questionReject(requestId),
      getMcpServerStatus: () => client.mcpStatus(),
      reconnectMcp: async (name) => {
        await client.disconnectMcp(name).catch(() => undefined)
        await client.connectMcp(name)
      },
      toggleMcpServer: (name, enabled) => enabled ? client.connectMcp(name) : client.disconnectMcp(name),
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
