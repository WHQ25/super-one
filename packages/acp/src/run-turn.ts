/**
 * Node ACP agent turn: spawn process → initialize → buildSession → prompt.
 * Event projection includes standard ACP updates and Grok xAI notifications;
 * desktop-only terminal delegation remains outside this runner.
 */

import {
  client,
  methods,
  PROTOCOL_VERSION,
  type ActiveSessionMessage,
} from '@agentclientprotocol/sdk'
import type { TurnRunner } from '@superone/runtime/session'
import {
  createAcpAgentEventMapper,
  type AcpAgentEventMapper,
} from './agent-event-mapper'
import { mapPermissionDecision, mapPermissionRequest } from './permission-map'
import { spawnAcpProcess, type AcpLaunch } from './process'
import {
  XAI_EXT_NOTIFICATION_METHODS,
  parseXaiExtParams,
} from './xai-state'

export interface RunAcpTurnOptions {
  /** Agent launch (command required for real turns). */
  launch?: AcpLaunch | null
  resolveProjectPath?: (projectId: string) => string | null
  clientName?: string
  /**
   * MCP servers for session/new (e.g. SuperOne Host Action HTTP).
   * Shape matches ACP `McpServer` descriptors.
   */
  mcpServers?: unknown[]
  /**
   * Per-turn MCP injection when servers depend on SuperOne session id.
   * Takes precedence over static `mcpServers` when both are set.
   */
  getMcpServers?: (sessionId: string) => unknown[] | null | undefined
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
      let agentEventMapper: AcpAgentEventMapper | null = null
      const pendingXaiNotifications: Array<{
        method: string
        params: Record<string, unknown>
      }> = []

      // ClientApp.connect → ClientConnection with `.agent` (ClientContext).
      // Do not call initialize/newSession/prompt on the connection root — those
      // are deprecated ClientSideConnection shapes and are not on ClientConnection.
      let clientBuilder = client({ name: opts.clientName ?? 'superone-node' })
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

      for (const method of XAI_EXT_NOTIFICATION_METHODS) {
        const registeredMethod = method
        clientBuilder = clientBuilder.onNotification(
          registeredMethod,
          parseXaiExtParams,
          async (ctx) => {
            if (agentEventMapper) {
              agentEventMapper.applyXaiNotification(registeredMethod, ctx.params)
            } else if (input.onAgentEvent) {
              pendingXaiNotifications.push({ method: registeredMethod, params: ctx.params })
            }
          },
        )
      }

      const connection = clientBuilder.connect(processHandle.stream)

      await connection.agent.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientInfo: { name: opts.clientName ?? 'superone-node', version: '0.0.0' },
        clientCapabilities: {},
      })

      const mcpServers =
        opts.getMcpServers?.(input.session.sessionId) ?? opts.mcpServers ?? []
      const active = await connection.agent
        .buildSession({ cwd, mcpServers: mcpServers as never })
        .start()
      const sessionId = active.sessionId
      if (!sessionId) throw new Error('ACP session/new did not return sessionId')

      let finalText = ''
      const blockId = `acp-${sessionId}`
      agentEventMapper = input.onAgentEvent
        ? createAcpAgentEventMapper({
            messageId: input.messageId ?? blockId,
            emit: input.onAgentEvent,
            cwd,
          })
        : null
      agentEventMapper?.start(sessionId)
      if (agentEventMapper) {
        for (const notification of pendingXaiNotifications) {
          agentEventMapper.applyXaiNotification(notification.method, notification.params)
        }
      }
      pendingXaiNotifications.length = 0
      if (!agentEventMapper) input.onEvent?.({ kind: 'status', status: 'streaming' })
      const promptPromise = active.prompt(input.text)
      let stopReason = 'end_turn'

      try {
        const deadline = Date.now() + 300_000
        let nextUpdatePromise = active.nextUpdate()
        const promptFailure = promptPromise.then(
          () => new Promise<never>(() => {}),
        )
        while (!input.signal.aborted && Date.now() < deadline) {
          const raced = await Promise.race([
            nextUpdatePromise.then((u) => ({ kind: 'u' as const, u })),
            promptFailure,
            new Promise<{ kind: 'tick' }>((r) => setTimeout(() => r({ kind: 'tick' }), 200)),
          ])
          if (raced.kind === 'tick') continue
          if (raced.u.kind === 'stop') {
            stopReason = String(raced.u.stopReason)
            break
          }
          nextUpdatePromise = active.nextUpdate()
          if (agentEventMapper) {
            const applied = agentEventMapper.apply(
              raced.u.update,
              raced.u.notification._meta,
            )
            if (applied.textDelta) finalText += applied.textDelta
          } else {
            const text = extractAgentTextChunk(raced.u)
            if (text) {
              finalText += text
              input.onDelta(text)
            }
          }
        }

        const promptResult = await promptPromise
        stopReason = String(promptResult.stopReason ?? stopReason)
        if (input.signal.aborted) throw new Error('ACP turn interrupted')
        agentEventMapper?.complete(stopReason)
        if (!agentEventMapper) input.onEvent?.({ kind: 'status', status: 'idle' })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        agentEventMapper?.fail(message, input.signal.aborted || /interrupt|cancel|abort/i.test(message))
        throw error
      }

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
