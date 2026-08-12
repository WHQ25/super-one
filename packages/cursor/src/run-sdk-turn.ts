/**
 * One Cursor SDK turn via createCursorRuntime (electron-free).
 *
 * Desktop and CLI share this path so remote node Cursor turns use the same
 * Agent.send flow as local SuperOne.
 */

import type { AgentEvent, PermissionMode } from '@superone/shared/agent-types'
import { createCursorRuntime } from './cursor-runtime'

export interface RunCursorSdkTurnOptions {
  apiKey: string
  cwd: string
  userDataRoot: string
  model?: string
  permissionMode?: string
  /** Prior Cursor agent id for Agent.resume. */
  providerResume?: string | null
  config?: unknown
  /** Stable assistant message id for AgentEvents. */
  messageId?: string
  prompt: string
  onAgentEvent?: (event: AgentEvent) => void
  signal?: AbortSignal
}

export interface CursorSdkTurnResult {
  finalText: string
  providerResume: string | null
}

/**
 * Run a single Cursor agent turn and return final text + agent id resume token.
 */
export async function runCursorSdkTurn(
  opts: RunCursorSdkTurnOptions,
): Promise<CursorSdkTurnResult> {
  if (opts.signal?.aborted) {
    throw new Error('Cursor turn interrupted')
  }

  const messageId = opts.messageId ?? `cursor-turn-${Date.now()}`
  let finalText = ''
  let providerResume: string | null = opts.providerResume ?? null

  const permissionMode = (opts.permissionMode ?? 'default') as PermissionMode

  const runtime = await createCursorRuntime({
    sessionId: messageId,
    cwd: opts.cwd,
    userDataRoot: opts.userDataRoot,
    providerSessionId: opts.providerResume ?? undefined,
    permissionMode,
    model: opts.model,
    config: {
      ...(opts.config && typeof opts.config === 'object' ? opts.config as object : {}),
      apiKey: opts.apiKey,
    },
    resolveApiKey: () => opts.apiKey,
    onProviderSessionId: (id) => {
      providerResume = id
    },
    onEvent: (event) => {
      if (event.type === 'provider_session_id') {
        providerResume = event.providerSessionId
      }
      if (event.type === 'content_delta' && event.delta.type === 'text' && event.delta.text) {
        finalText += event.delta.text
      }
      opts.onAgentEvent?.(event)
    },
  })

  const onAbort = () => {
    void runtime.cancel()
  }
  opts.signal?.addEventListener('abort', onAbort, { once: true })

  try {
    if (opts.signal?.aborted) {
      throw new Error('Cursor turn interrupted')
    }
    await runtime.send(messageId, opts.prompt)
    return { finalText, providerResume: providerResume ?? runtime.agentId }
  } finally {
    opts.signal?.removeEventListener('abort', onAbort)
    await runtime.close()
  }
}
