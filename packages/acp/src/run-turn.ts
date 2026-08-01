/**
 * Minimal ACP agent turn: spawn process → initialize → buildSession → prompt.
 * Full desktop ACP runtime (terminals, MCP, xAI extensions) is not mirrored here.
 */

import {
  client,
  methods,
  PROTOCOL_VERSION,
  type ActiveSessionMessage,
} from '@agentclientprotocol/sdk'
import type { TurnRunner } from '@superone/runtime/session'
import { mapPermissionDecision, mapPermissionRequest } from './permission-map'
import { spawnAcpProcess, type AcpLaunch } from './process'

export interface RunAcpTurnOptions {
  /** Agent launch (command required for real turns). */
  launch?: AcpLaunch | null
  resolveProjectPath?: (projectId: string) => string | null
  clientName?: string
}

function extractAgentTextChunk(msg: ActiveSessionMessage): string | null {
  if (msg.kind === 'stop') return null
  // session/update messages carry sessionUpdate + content for agent_message_chunk
  const u = msg as {
    kind?: string
    sessionUpdate?: string
    update?: {
      sessionUpdate?: string
      content?: { type?: string; text?: string }
    }
    content?: { type?: string; text?: string }
    text?: string
  }
  const sessionUpdate = u.sessionUpdate ?? u.update?.sessionUpdate
  const content = u.content ?? u.update?.content
  if (
    sessionUpdate === 'agent_message_chunk' ||
    sessionUpdate === 'agent_thought_chunk' ||
    !sessionUpdate
  ) {
    if (content?.type === 'text' && typeof content.text === 'string') return content.text
    if (typeof u.text === 'string') return u.text
  }
  return null
}

export function createAcpAgentTurnRunner(opts: RunAcpTurnOptions = {}): TurnRunner {
  return async (input) => {
    const launch = opts.launch
    if (!launch?.command?.trim()) {
      throw new Error('ACP agent command not configured')
    }

    const projectRoot =
      opts.resolveProjectPath?.(input.session.projectId) ||
      process.env.SUPERONE_DEFAULT_CWD ||
      process.cwd()
    const cwd =
      input.session.cwd?.trim() ||
      launch.cwd ||
      projectRoot

    const processHandle = spawnAcpProcess({
      ...launch,
      cwd,
    })

    try {
      if (input.signal.aborted) throw new Error('ACP turn interrupted')

      let pendingOptions: ReturnType<typeof mapPermissionRequest>['options'] = []

      // ClientApp.connect → ClientConnection with `.agent` (ClientContext).
      // Do not call initialize/newSession/prompt on the connection root — those
      // are deprecated ClientSideConnection shapes and are not on ClientConnection.
      const connection = client({ name: opts.clientName ?? 'superone-node' })
        .onRequest(methods.client.session.requestPermission, async (ctx) => {
          const mapped = mapPermissionRequest(ctx.params)
          pendingOptions = mapped.options
          if (!input.onPermission) {
            return mapPermissionDecision(pendingOptions, false)
          }
          const decision = await input.onPermission({
            interactionId: mapped.request.requestId,
            kind: 'permission',
            toolName: mapped.request.toolName,
            toolUseId: mapped.request.toolUseId,
            input: mapped.request.input,
            createdAt: Date.now(),
          })
          return mapPermissionDecision(pendingOptions, decision === 'allow', false)
        })
        .connect(processHandle.stream)

      await connection.agent.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientInfo: { name: opts.clientName ?? 'superone-node', version: '0.0.0' },
        clientCapabilities: {},
      })

      const active = await connection.agent.buildSession({ cwd, mcpServers: [] }).start()
      const sessionId = active.sessionId
      if (!sessionId) throw new Error('ACP session/new did not return sessionId')

      input.onEvent?.({ kind: 'status', status: 'streaming' })

      let finalText = ''
      const blockId = `acp-${sessionId}`
      const promptPromise = active.prompt(input.text)

      const deadline = Date.now() + 300_000
      while (!input.signal.aborted && Date.now() < deadline) {
        const raced = await Promise.race([
          active.nextUpdate().then((u) => ({ kind: 'u' as const, u })),
          promptPromise.then((r) => ({ kind: 'done' as const, r })),
          new Promise<{ kind: 'tick' }>((r) => setTimeout(() => r({ kind: 'tick' }), 200)),
        ])
        if (raced.kind === 'done') break
        if (raced.kind === 'tick') continue
        if (raced.u.kind === 'stop') break
        const text = extractAgentTextChunk(raced.u)
        if (text) {
          finalText += text
          // Prefer onDelta only — SessionRuntime also projects onEvent text into
          // the same transcript buffer and would double-count if both fire.
          input.onDelta(text)
        }
      }

      await promptPromise

      // If the agent only returned stop without chunks, try readText helper as fallback.
      if (!finalText) {
        try {
          // Already completed prompt — readText may not re-run; keep finalText empty.
        } catch {
          /* ignore */
        }
      }

      input.onEvent?.({ kind: 'status', status: 'idle' })

      try {
        active.dispose()
      } catch {
        /* ignore */
      }
      try {
        connection.close()
      } catch {
        /* ignore */
      }

      return {
        finalText,
        providerResume: sessionId ? `acp-session:${sessionId}` : null,
      }
    } finally {
      await processHandle.kill().catch(() => {})
    }
  }
}
