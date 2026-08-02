/**
 * One OpenCode agent turn via serve + SDK (electron-free).
 */

import { createOpencodeClient } from '@opencode-ai/sdk/v2'
import type { TurnRunner } from '@superone/runtime/session'
import {
  createOpenCodeAgentEventMapper,
  openCodeEventSessionId,
} from './agent-event-mapper'
import { parseOpenCodeModelSlug } from './parse'
import { startOpenCodeServer } from './server'

export interface RunOpenCodeTurnOptions {
  binaryPath?: string | null
  serverUrl?: string | null
  serverPassword?: string | null
  env?: Record<string, string>
  startupTimeoutMs?: number
  /**
   * SuperOne Host Action HTTP MCP (or equivalent remote MCP).
   * Registered via `client.mcp.add` before the prompt.
   */
  superoneMcp?: {
    url: string
    headers: Record<string, string>
  } | null
  /** Per-session override when URL/token depends on SuperOne session id. */
  getSuperoneMcp?: (
    sessionId: string,
  ) => { url: string; headers: Record<string, string> } | null | undefined
}

/**
 * Build a TurnRunner that starts (or attaches to) OpenCode serve and runs one prompt.
 * Session resume is not persisted across process restarts in this minimal path
 * (providerResume carries the OpenCode session id for the next turn in-process).
 */
export function createOpenCodeAppServerTurnRunner(
  resolveProjectPath: (projectId: string) => string | null,
  opts: RunOpenCodeTurnOptions = {},
): TurnRunner {
  return async (input) => {
    const projectRoot =
      resolveProjectPath(input.session.projectId) ||
      process.env.SUPERONE_DEFAULT_CWD ||
      process.cwd()
    const cwd =
      input.session.cwd && input.session.cwd.trim()
        ? input.session.cwd.trim()
        : projectRoot

    const server = await startOpenCodeServer({
      binaryPath: opts.binaryPath,
      cwd,
      env: opts.env,
      serverUrl: opts.serverUrl,
      timeoutMs: opts.startupTimeoutMs,
      signal: input.signal,
    })

    try {
      if (input.signal.aborted) throw new Error('OpenCode turn interrupted')

      const client = createOpencodeClient({
        baseUrl: server.url,
        directory: cwd,
        throwOnError: true,
        ...(opts.serverPassword
          ? {
              headers: {
                Authorization: `Basic ${Buffer.from(`opencode:${opts.serverPassword}`, 'utf8').toString('base64')}`,
              },
            }
          : {}),
      })

      let sessionId =
        input.session.providerResume && input.session.providerResume.startsWith('opencode:')
          ? input.session.providerResume.slice('opencode:'.length)
          : null

      if (!sessionId) {
        const created = await client.session.create({
          permission: [
            { permission: '*', action: 'allow', pattern: '*' },
          ],
        })
        sessionId = created.data?.id ?? null
        if (!sessionId) throw new Error('OpenCode session was not created')
      }

      const superoneMcp =
        opts.getSuperoneMcp?.(input.session.sessionId) ?? opts.superoneMcp ?? null
      if (superoneMcp) {
        await client.mcp.add({
          name: 'superone',
          config: {
            type: 'remote',
            url: superoneMcp.url,
            headers: superoneMcp.headers,
            enabled: true,
          },
        })
      }

      const model = parseOpenCodeModelSlug(input.model)
      const agentEventMapper = input.onAgentEvent
        ? createOpenCodeAgentEventMapper({
            messageId: input.messageId ?? `opencode-${sessionId}`,
            emit: input.onAgentEvent,
          })
        : null
      agentEventMapper?.start(sessionId)
      if (!agentEventMapper) input.onEvent?.({ kind: 'status', status: 'streaming' })

      // Subscribe before promptAsync so fast first-token / tool events are not lost.
      const stream = (await client.event.subscribe({}, { signal: input.signal })).stream
      await client.session.promptAsync({
        sessionID: sessionId,
        model: model ?? undefined,
        parts: input.text ? [{ type: 'text' as const, text: input.text }] : [],
      })

      // Drain event stream until idle / abort / timeout.
      const deadline = Date.now() + 300_000
      let finalText = ''
      let settled = false

      try {
        for await (const event of stream) {
          if (input.signal.aborted) throw new Error('OpenCode turn interrupted')
          if (Date.now() > deadline) throw new Error('OpenCode turn timed out')
          if (openCodeEventSessionId(event) !== sessionId) continue

          const type = (event as { type?: string }).type
          const props = (event as { properties?: Record<string, unknown> }).properties
          if (agentEventMapper) {
            const applied = agentEventMapper.apply(event)
            if (applied.textDelta) finalText += applied.textDelta
            if (applied.terminal) {
              settled = true
              break
            }
          } else if (type === 'message.part.delta') {
            const delta = typeof props?.delta === 'string'
              ? props.delta
              : (props?.part as { delta?: string } | undefined)?.delta
            if (delta) {
              finalText += delta
              input.onDelta(delta)
            }
          } else if (type === 'message.part.updated') {
            const part = props?.part as { type?: string; text?: string; delta?: string } | undefined
            if (typeof part?.delta === 'string' && part.delta.length > 0) {
              finalText += part.delta
              input.onDelta(part.delta)
            } else if (part?.type === 'text' && typeof part.text === 'string' && part.text.startsWith(finalText)) {
              const growth = part.text.slice(finalText.length)
              if (growth) {
                finalText = part.text
                input.onDelta(growth)
              }
            }
          }

          if (type === 'session.idle') {
            settled = true
            break
          }
          if (type === 'session.status') {
            const status = props?.status as { type?: string } | string | undefined
            if (status === 'idle' || (typeof status === 'object' && status?.type === 'idle') || props?.type === 'idle') {
              settled = true
              break
            }
          }
          if (type === 'session.updated') {
            const session = props?.session as { status?: string } | undefined
            if (session?.status === 'idle') {
              settled = true
              break
            }
          }
        }

        if (!settled) throw new Error('OpenCode event stream closed before session became idle')
        agentEventMapper?.complete()
        if (!agentEventMapper) input.onEvent?.({ kind: 'status', status: 'idle' })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (input.signal.aborted || /interrupt|cancel|abort/i.test(message)) {
          agentEventMapper?.complete(true)
        } else {
          agentEventMapper?.fail(message)
        }
        throw error
      }

      return {
        finalText,
        providerResume: sessionId ? `opencode:${sessionId}` : null,
      }
    } finally {
      await server.close().catch(() => {})
    }
  }
}
