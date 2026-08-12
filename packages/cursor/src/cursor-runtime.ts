import {
  Agent,
  AgentBusyError,
  IntegrationNotConnectedError,
  type McpServerConfig,
  type ModelSelection,
  type Run,
  type SDKAgent,
  type SDKArtifact,
  type SDKUserMessage,
  type SendOptions,
} from '@cursor/sdk'
import type { AgentEvent, McpServerInfo, PermissionMode } from '@superone/shared/agent-types'
import {
  buildCloudOptions,
  mapPermissionToCursorLocal,
  readCursorConfig,
  resolveCursorApiKeyPlain,
  type CursorConfig,
} from './cursor-config'
import { buildCursorCustomTools } from './cursor-custom-tools'
import { mapInteractionUpdate, mapSdkMessageLifecycle } from './cursor-event-map'
import { mcpServersToStatus, stripStdioCwd } from './cursor-mcp-map'
import { getCursorAgentStore } from './cursor-store'

/** Minimal logger interface (desktop injects electron-log). */
export interface CursorRuntimeLog {
  info?: (...args: unknown[]) => void
  warn?: (...args: unknown[]) => void
  error?: (...args: unknown[]) => void
  debug?: (...args: unknown[]) => void
}

const noopLog: Required<CursorRuntimeLog> = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
}

function formatCursorError(error: unknown): Error {
  if (error instanceof IntegrationNotConnectedError) {
    return new Error(
      `${error.message} Connect ${error.provider} at ${error.helpUrl} then retry.`,
    )
  }
  if (error instanceof Error) return error
  return new Error(String(error))
}

export interface CursorRuntimeOptions {
  sessionId: string
  cwd: string
  /** Host user-data root for local agent SQLite store. */
  userDataRoot: string
  providerSessionId?: string
  permissionMode: PermissionMode
  model?: string
  /** Full SDK model selection (id + params). Wins over bare `model`. */
  modelSelection?: ModelSelection
  config: unknown
  onEvent: (event: AgentEvent) => void
  onProviderSessionId?: (id: string) => void
  /** Override API key resolution (desktop decrypts secret-store). */
  resolveApiKey?: (config: unknown) => string | undefined
  /** Build MCP servers for this session (desktop wires SuperOne MCP). */
  buildMcpServers?: (cwd: string, sessionId: string) => Record<string, McpServerConfig>
  log?: CursorRuntimeLog
}

export interface CursorSendOptions {
  images?: Array<{ data: string; mimeType: string }>
  force?: boolean
  /** Per-send MCP override (else uses last synced servers). */
  mcpServers?: Record<string, McpServerConfig>
}

export interface CursorRuntime {
  readonly agentId: string
  readonly isCloud: boolean
  send(messageId: string, text: string, options?: CursorSendOptions): Promise<{
    git?: { branches: Array<{ repoUrl: string; branch?: string; prUrl?: string }> }
  }>
  cancel(): Promise<void>
  close(): Promise<void>
  /** Update model id and/or params for the next send. */
  setModel(model: string | ModelSelection): void
  setPermissionMode(mode: PermissionMode): void
  reload(): Promise<void>
  getMcpServerStatus(): Promise<McpServerInfo[]>
  listArtifacts(): Promise<SDKArtifact[]>
  downloadArtifact(path: string): Promise<Buffer>
  /** Expire wedged local run then resend is handled via force on send. */
}

export type CursorRuntimeFactory = (opts: CursorRuntimeOptions) => Promise<CursorRuntime>

let runtimeFactory: CursorRuntimeFactory = createCursorRuntime

/** Override the Cursor runtime factory (tests / host adapters). */
export function setCursorRuntimeFactory(factory: CursorRuntimeFactory | null): void {
  runtimeFactory = factory ?? createCursorRuntime
}

/** Return the active Cursor runtime factory. */
export function getCursorRuntimeFactory(): CursorRuntimeFactory {
  return runtimeFactory
}

/**
 * Create a Cursor SDK agent runtime (local or cloud) without Electron deps.
 */
export async function createCursorRuntime(opts: CursorRuntimeOptions): Promise<CursorRuntime> {
  const log = {
    info: opts.log?.info ?? noopLog.info,
    warn: opts.log?.warn ?? noopLog.warn,
    error: opts.log?.error ?? noopLog.error,
    debug: opts.log?.debug ?? noopLog.debug,
  }
  const resolveApiKey = opts.resolveApiKey ?? resolveCursorApiKeyPlain
  const buildMcpServers = opts.buildMcpServers ?? (() => ({}))

  const config = readCursorConfig(opts.config)
  const apiKey = resolveApiKey(opts.config)
  if (!apiKey) {
    throw new Error(
      'Cursor User API Key missing. Create one at https://cursor.com/dashboard/api, set it on the Cursor provider, or export CURSOR_API_KEY.',
    )
  }

  const isCloud = config.runtime === 'cloud'
    || (opts.providerSessionId?.startsWith('bc-') ?? false)

  const modelId = opts.modelSelection?.id || opts.model || config.model
  if (!isCloud && !modelId) {
    throw new Error('Cursor model is required for local agents. Connect Cursor to load models, then select one.')
  }

  const perm = mapPermissionToCursorLocal(opts.permissionMode)
  const model: ModelSelection | undefined = opts.modelSelection
    ?? (modelId ? { id: modelId } : undefined)
  const settingSources = config.settingSources ?? ['project']
  const mcpServers = isCloud
    ? stripStdioCwd(buildMcpServers(opts.cwd, opts.sessionId))
    : buildMcpServers(opts.cwd, opts.sessionId)
  const customTools = isCloud
    ? undefined
    : buildCursorCustomTools({ sessionId: opts.sessionId, cwd: opts.cwd })

  let agent: SDKAgent
  try {
    if (opts.providerSessionId) {
      agent = await Agent.resume(opts.providerSessionId, {
        apiKey,
        ...(model ? { model } : {}),
        mode: perm.mode,
        mcpServers,
        ...(isCloud
          ? { cloud: buildCloudOptions(config) }
          : {
              local: {
                cwd: opts.cwd,
                store: getCursorAgentStore(opts.userDataRoot, opts.cwd),
                settingSources,
                sandboxOptions: { enabled: config.sandboxEnabled ?? perm.sandboxEnabled },
                autoReview: config.autoReview ?? perm.autoReview,
                enableAgentRetries: config.enableAgentRetries ?? true,
                ...(customTools ? { customTools } : {}),
              },
            }),
      })
    } else if (isCloud) {
      agent = await Agent.create({
        apiKey,
        ...(model ? { model } : {}),
        mode: perm.mode,
        mcpServers,
        cloud: buildCloudOptions(config),
      })
    } else {
      agent = await Agent.create({
        apiKey,
        model: model!,
        mode: perm.mode,
        mcpServers,
        local: {
          cwd: opts.cwd,
          store: getCursorAgentStore(opts.userDataRoot, opts.cwd),
          settingSources,
          sandboxOptions: { enabled: config.sandboxEnabled ?? perm.sandboxEnabled },
          autoReview: config.autoReview ?? perm.autoReview,
          enableAgentRetries: config.enableAgentRetries ?? true,
          ...(customTools ? { customTools } : {}),
        },
      })
    }
  } catch (error) {
    throw formatCursorError(error)
  }

  opts.onProviderSessionId?.(agent.agentId)
  opts.onEvent({ type: 'provider_session_id', providerSessionId: agent.agentId })

  let currentRun: Run | null = null
  let modelSelection = model
  let permissionMode = opts.permissionMode
  let disposed = false
  let lastMcpServers = mcpServers

  return {
    get agentId() {
      return agent.agentId
    },
    get isCloud() {
      return isCloud || agent.agentId.startsWith('bc-')
    },

    setModel(next: string | ModelSelection) {
      modelSelection = typeof next === 'string' ? { id: next } : next
    },

    setPermissionMode(mode: PermissionMode) {
      permissionMode = mode
    },

    async reload() {
      if (disposed) return
      if (!isCloud) {
        lastMcpServers = buildMcpServers(opts.cwd, opts.sessionId)
      }
      await agent.reload()
    },

    async getMcpServerStatus() {
      return mcpServersToStatus(lastMcpServers).map((s) => ({
        name: s.name,
        status: s.status as McpServerInfo['status'],
      }))
    },

    async listArtifacts() {
      return agent.listArtifacts()
    },

    async downloadArtifact(path: string) {
      return agent.downloadArtifact(path)
    },

    async send(messageId, text, sendOpts) {
      if (disposed) throw new Error('Cursor runtime disposed')
      const permLocal = mapPermissionToCursorLocal(permissionMode)
      const userMessage: string | SDKUserMessage = sendOpts?.images?.length
        ? {
            text,
            images: sendOpts.images.map((img) => ({
              data: img.data,
              mimeType: img.mimeType,
            })),
          }
        : text

      const servers = sendOpts?.mcpServers ?? lastMcpServers
      lastMcpServers = servers

      const sendOptions: SendOptions = {
        ...(modelSelection ? { model: modelSelection } : {}),
        mode: permLocal.mode,
        mcpServers: Object.keys(servers).length ? servers : undefined,
        onDelta: ({ update }) => {
          for (const event of mapInteractionUpdate(messageId, update)) {
            opts.onEvent(event)
          }
        },
        ...(!isCloud
          ? {
              local: {
                ...(sendOpts?.force ? { force: true } : {}),
              },
            }
          : {
              cloud: config.cloudEnvVars ? { envVars: config.cloudEnvVars } : undefined,
            }),
      }

      let run: Run
      try {
        run = await agent.send(userMessage, sendOptions)
      } catch (error) {
        if (error instanceof AgentBusyError && !sendOpts?.force && !isCloud) {
          log.warn('[CursorRuntime] AgentBusyError — retrying with local.force')
          try {
            run = await agent.send(userMessage, {
              ...sendOptions,
              local: { force: true },
            })
          } catch (retryError) {
            throw formatCursorError(retryError)
          }
        } else {
          throw formatCursorError(error)
        }
      }
      currentRun = run

      void (async () => {
        try {
          for await (const message of run.stream()) {
            for (const event of mapSdkMessageLifecycle(messageId, message, { includeContent: false })) {
              opts.onEvent(event)
            }
          }
        } catch (error) {
          log.debug('[CursorRuntime] stream consumer ended:', error)
        }
      })()

      const result = await run.wait()
      currentRun = null

      if (result.usage) {
        opts.onEvent({
          type: 'message_usage',
          messageId,
          inputTokens: result.usage.inputTokens + result.usage.cacheReadTokens + result.usage.cacheWriteTokens,
          outputTokens: result.usage.outputTokens + (result.usage.reasoningTokens ?? 0),
        })
      }

      if (result.git?.branches?.length) {
        const pr = result.git.branches.find((b) => b.prUrl)
        if (pr?.prUrl) {
          opts.onEvent({
            type: 'content_delta',
            messageId,
            delta: {
              type: 'text',
              text: `\n\n[Cursor PR](${pr.prUrl})` + (pr.branch ? ` · \`${pr.branch}\`` : ''),
            },
          })
        }
      }

      if (result.status === 'error') {
        throw new Error(result.error?.message ?? 'Cursor run failed')
      }
      if (result.status === 'cancelled') {
        return { git: result.git }
      }
      return { git: result.git }
    },

    async cancel() {
      try {
        await currentRun?.cancel()
      } catch (error) {
        log.debug('[CursorRuntime] cancel failed:', error)
      }
    },

    async close() {
      disposed = true
      try {
        await currentRun?.cancel()
      } catch {
        // ignore
      }
      currentRun = null
      try {
        agent.close()
      } catch (error) {
        log.debug('[CursorRuntime] agent.close failed:', error)
      }
    },
  }
}

export type { CursorConfig }
