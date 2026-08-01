/**
 * One OpenCode agent turn via serve + SDK (electron-free).
 */

import { createOpencodeClient } from '@opencode-ai/sdk/v2'
import type { TurnRunner } from '@superone/runtime/session'
import { parseOpenCodeModelSlug } from './parse'
import { startOpenCodeServer } from './server'

export interface RunOpenCodeTurnOptions {
  binaryPath?: string | null
  serverUrl?: string | null
  serverPassword?: string | null
  env?: Record<string, string>
  startupTimeoutMs?: number
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

      input.onEvent?.({ kind: 'status', status: 'streaming' })

      const model = parseOpenCodeModelSlug(input.model)
      await client.session.promptAsync({
        sessionID: sessionId,
        model: model ?? undefined,
        parts: input.text ? [{ type: 'text' as const, text: input.text }] : [],
      })

      // Drain event stream until idle / abort / timeout.
      const deadline = Date.now() + 300_000
      let finalText = ''
      const stream = (await client.event.subscribe({}, { signal: input.signal })).stream

      for await (const event of stream) {
        if (input.signal.aborted) throw new Error('OpenCode turn interrupted')
        if (Date.now() > deadline) throw new Error('OpenCode turn timed out')

        const type = (event as { type?: string }).type
        // Best-effort text extraction — OpenCode event shapes vary by version.
        const props = (event as { properties?: Record<string, unknown> }).properties
        if (type === 'message.part.delta') {
          const part = props?.part as { type?: string; delta?: string } | undefined
          const delta = part?.delta
          if (typeof delta === 'string' && delta.length > 0) {
            finalText += delta
            // onDelta only — SessionRuntime also projects onEvent text into the
            // same buffer and would double-count if both fire.
            input.onDelta(delta)
          }
        } else if (type === 'message.part.updated') {
          // `part.text` is a full snapshot on many builds — only append the growth.
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
        // Desktop backend: session.idle alone means the turn settled.
        if (type === 'session.idle') break
        if (type === 'session.status') {
          const status = props?.status
          if (status === 'idle' || props?.type === 'idle') break
        }
        // Some builds emit session.updated with status
        if (type === 'session.updated') {
          const session = props?.session as { status?: string } | undefined
          if (session?.status === 'idle') break
        }
      }

      input.onEvent?.({ kind: 'status', status: 'idle' })

      return {
        finalText,
        providerResume: sessionId ? `opencode:${sessionId}` : null,
      }
    } finally {
      await server.close().catch(() => {})
    }
  }
}
