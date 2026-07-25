import { app } from 'electron'
import {
  Agent,
  type ModelSelection,
  type Run,
  type SDKAgent,
  type SDKUserMessage,
  type SendOptions,
} from '@cursor/sdk'
import type { AgentEvent, PermissionMode } from '@superone/shared/agent-types'
import log from '../logger'
import { mapPermissionToCursorLocal, readCursorConfig, resolveCursorApiKey, type CursorConfig } from './cursor-auth'
import { mapInteractionUpdate, mapSdkMessageLifecycle } from './cursor-event-map'
import { getCursorAgentStore } from './cursor-store'

export interface CursorRuntimeOptions {
  sessionId: string
  cwd: string
  providerSessionId?: string
  permissionMode: PermissionMode
  model?: string
  config: unknown
  onEvent: (event: AgentEvent) => void
  onProviderSessionId?: (id: string) => void
}

export interface CursorRuntime {
  readonly agentId: string
  send(messageId: string, text: string, options?: {
    images?: Array<{ data: string; mimeType: string }>
    force?: boolean
  }): Promise<void>
  cancel(): Promise<void>
  close(): Promise<void>
  setModel(model: string): void
  setPermissionMode(mode: PermissionMode): void
}

export type CursorRuntimeFactory = (opts: CursorRuntimeOptions) => Promise<CursorRuntime>

let runtimeFactory: CursorRuntimeFactory = createCursorRuntime

export function setCursorRuntimeFactory(factory: CursorRuntimeFactory | null): void {
  runtimeFactory = factory ?? createCursorRuntime
}

export function getCursorRuntimeFactory(): CursorRuntimeFactory {
  return runtimeFactory
}

export async function createCursorRuntime(opts: CursorRuntimeOptions): Promise<CursorRuntime> {
  const config = readCursorConfig(opts.config)
  const apiKey = resolveCursorApiKey(opts.config)
  if (!apiKey) {
    throw new Error(
      'Cursor User API Key missing. Create one at https://cursor.com/dashboard/api, set it on the Cursor provider, or export CURSOR_API_KEY.',
    )
  }

  const modelId = opts.model || config.model
  if (!modelId) {
    throw new Error('Cursor model is required. Connect Cursor to load models, then select one.')
  }

  const store = getCursorAgentStore(app.getPath('userData'), opts.cwd)
  const perm = mapPermissionToCursorLocal(opts.permissionMode)
  const model: ModelSelection = { id: modelId }
  const settingSources = config.settingSources ?? ['project']

  let agent: SDKAgent
  if (opts.providerSessionId) {
    agent = await Agent.resume(opts.providerSessionId, {
      apiKey,
      model,
      mode: perm.mode,
      local: {
        cwd: opts.cwd,
        store,
        settingSources,
        sandboxOptions: { enabled: perm.sandboxEnabled },
        autoReview: perm.autoReview,
        enableAgentRetries: config.enableAgentRetries ?? true,
      },
    })
  } else {
    agent = await Agent.create({
      apiKey,
      model,
      mode: perm.mode,
      local: {
        cwd: opts.cwd,
        store,
        settingSources,
        sandboxOptions: { enabled: perm.sandboxEnabled },
        autoReview: perm.autoReview,
        enableAgentRetries: config.enableAgentRetries ?? true,
      },
    })
  }

  opts.onProviderSessionId?.(agent.agentId)
  opts.onEvent({ type: 'provider_session_id', providerSessionId: agent.agentId })

  let currentRun: Run | null = null
  let modelSelection = model
  let permissionMode = opts.permissionMode
  let disposed = false

  return {
    get agentId() {
      return agent.agentId
    },

    setModel(next: string) {
      modelSelection = { id: next }
    },

    setPermissionMode(mode: PermissionMode) {
      permissionMode = mode
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

      const sendOptions: SendOptions = {
        model: modelSelection,
        mode: permLocal.mode,
        onDelta: ({ update }) => {
          for (const event of mapInteractionUpdate(messageId, update)) {
            opts.onEvent(event)
          }
        },
        local: {
          ...(sendOpts?.force ? { force: true } : {}),
        },
      }

      const run = await agent.send(userMessage, sendOptions)
      currentRun = run

      // Lifecycle-only stream (D6): do not re-emit content from stream while onDelta is active
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

      if (result.status === 'error') {
        throw new Error(result.error?.message ?? 'Cursor run failed')
      }
      if (result.status === 'cancelled') {
        // host emits interrupted
        return
      }
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
