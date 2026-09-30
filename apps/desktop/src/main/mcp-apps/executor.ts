import { randomUUID } from 'node:crypto'
import { shell } from 'electron'
import type { AgentEvent, ImageAttachment, RemoteCommand } from '@superone/shared/agent-types'
import { parseSessionKey, type SessionRef } from '@superone/shared/environment/refs'
import { McpAppsError } from '@superone/shared/mcp-apps'
import type { McpAppHostRequest, McpAppHostResult, McpAppRequester } from '@superone/shared/mcp-apps'
import { findMcpAppAttachment, mcpAppEventAttachment } from '@superone/shared/mcp-apps-state'
import type { SessionManagerImpl } from '../session/session-manager'
import type { RemoteResponder } from '../remote-control-service'
import { McpAppExecutor, type McpAppResolvedTarget } from './executor-core'
import { routeMcpAppsProviderRequest } from './provider-ipc'
import { mcpAppSessionKey } from './session-key'

interface MobileSender {
  handleRemoteCommand(command: RemoteCommand, respond?: RemoteResponder, source?: { deviceId: string; transport: 'lan' | 'relay' }): Promise<void>
  notifyEventSubscribers(event: AgentEvent): void
}

let executor: McpAppExecutor | undefined
const remoteStarted = new Set<string>()

function acceptedSend(deliver: (onAccepted: () => void) => Promise<unknown>, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new McpAppsError('cancelled', 'MCP App message cancelled')); return }
    let accepted = false
    const onAccepted = (): void => { accepted = true; resolve() }
    // After admission the normal send path owns the turn and its error events.
    void deliver(onAccepted).then(() => { if (!accepted) reject(new McpAppsError('not_connected', 'MCP App message was not admitted')) }, error => { if (!accepted) reject(error) })
  })
}

export function initializeMcpAppExecutor(manager: SessionManagerImpl, mobile: MobileSender, publish: (event: AgentEvent) => void): void {
  if (executor) return
  const local = (id: string) => manager.getSession(id) ?? manager.resumeSession(id, { passive: true })
  const resolve = async (ref: SessionRef, appInstanceId: string, messageId: string | undefined, signal: AbortSignal): Promise<McpAppResolvedTarget> => {
    if (ref.environmentId === 'local') {
      const session = local(ref.sessionId)
      const target = findMcpAppAttachment(session.snapshot.messages, appInstanceId, messageId)
      if (!target) throw new McpAppsError('denied', 'MCP App attachment was not found in this session')
      return { ref, node: 'local', projectPath: session.projectPath, messages: session.snapshot.messages, ...target }
    }
    const { getEnvironmentHost } = await import('../environment/environment-host')
    const host = getEnvironmentHost()
    const node = host.connections.listKnown().find(value => value.connectionId === ref.environmentId)?.environmentId
    if (!node) throw new McpAppsError('not_connected', 'MCP App node connection unavailable')
    const rows: import('@superone/shared/environment').SessionMessageBlock[] = []
    let cursor: string | null | undefined
    do {
      if (signal.aborted) throw new McpAppsError('cancelled', 'MCP App request cancelled')
      const page = await host.listSessionMessages(ref.environmentId, { sessionId: ref.sessionId, cursor, limit: 200 })
      rows.unshift(...page.messages)
      cursor = page.hasMore ? page.cursor : null
    } while (cursor)
    const target = findMcpAppAttachment(rows, appInstanceId, messageId)
    if (!target) throw new McpAppsError('denied', 'MCP App attachment was not found on this node')
    const record = await host.getSession(ref.environmentId, ref.sessionId) as { projectId?: string; projectPath?: string }
    const path = record.projectId ?? record.projectPath
    if (!path) throw new McpAppsError('not_connected', 'MCP App session project unavailable')
    return { ref, node, projectPath: `remote:${ref.environmentId}:${path}`, messages: rows, ...target }
  }
  executor = new McpAppExecutor({
    resolve,
    async persist(target, update, signal) {
      if (signal.aborted) throw new McpAppsError('cancelled', 'MCP App request cancelled')
      const event: AgentEvent = { type: 'mcp_app_updated', sessionId: target.ref.sessionId, projectPath: target.projectPath,
        messageId: target.messageId, appInstanceId: target.app.appInstanceId, update }
      if (target.ref.environmentId === 'local') local(target.ref.sessionId).emitHostEvent(event)
      else {
        const { getEnvironmentHost } = await import('../environment/environment-host')
        const result = await getEnvironmentHost().updateMcpAppState(target.ref.environmentId, { sessionId: target.ref.sessionId, appInstanceId: target.app.appInstanceId, update })
        if (!result.ok) throw new McpAppsError(result.error.code, result.error.message)
        publish(event)
        mobile.notifyEventSubscribers(event)
      }
    },
    async provider(target, operation, signal) {
      if (signal.aborted) throw new McpAppsError('cancelled', 'MCP App request cancelled')
      return routeMcpAppsProviderRequest(id => local(id), target.ref.environmentId, { ...operation, binding: target.app.binding, origin: target.app.origin! }, signal)
    },
    async sendMessage(target, params, requester, signal) {
      const text: string[] = []
      const images: ImageAttachment[] = []
      for (const block of params.content) {
        if (block.type === 'text') text.push(block.text)
        else if (block.type === 'image') images.push({ name: 'MCP App image', mimeType: block.mimeType, base64: block.data })
        else throw new McpAppsError('invalid', `MCP App message content ${block.type} is not supported`)
      }
      const content = `[MCP App: ${target.app.binding.server}]\n${text.join('\n')}`
      const clientMessageId = randomUUID()
      if (requester.kind === 'mobile' && target.ref.environmentId === 'local') {
        await acceptedSend(onAccepted => mobile.handleRemoteCommand({ type: 'send_message', requestId: randomUUID(),
          projectPath: target.projectPath, sessionId: target.ref.sessionId, content, images, clientMessageId, priority: 'next' },
        async (_id, data) => { const response = data as { error?: unknown; ok?: boolean }; if (response.error) throw new McpAppsError('denied', String(response.error)); if (response.ok) onAccepted() },
        { deviceId: requester.deviceId, transport: 'lan' }), signal)
      } else if (target.ref.environmentId === 'local') {
        await acceptedSend(onAccepted => local(target.ref.sessionId).send({ content, images, clientMessageId, priority: 'next' }, { onAccepted }), signal)
      } else {
        const { getEnvironmentHost } = await import('../environment/environment-host')
        await acceptedSend(onAccepted => getEnvironmentHost().sendSessionMessage(target.ref.environmentId, {
          sessionId: target.ref.sessionId, text: content, images, clientMessageId, projectPath: target.projectPath, onAccepted,
        }), signal)
      }
    },
    openLink: url => shell.openExternal(url),
  })
  manager.onAny((sid, event, replay) => {
    if (replay) return
    const app = mcpAppEventAttachment(event)
    if (app) executor!.observeLive({ environmentId: 'local', sessionId: sid }, app)
  })
}

/** Remote hydrate never calls this; only the live turn stream establishes freshness. */
export function observeRemoteMcpAppEvent(event: AgentEvent): void {
  if (!executor || !event.sessionId || !event.projectPath) return
  const ref = parseSessionKey(mcpAppSessionKey(event.projectPath, event.sessionId))!
  const callId = event.type === 'codex_item_delta' && event.item.type === 'mcp_tool_call' ? event.item.id
    : event.type === 'content_delta' && (event.delta.type === 'tool_use' || event.delta.type === 'tool_result') ? event.delta.toolUseId : undefined
  if (!callId) return
  const key = JSON.stringify([ref, callId])
  // UI metadata may first arrive on completion, after the started item had no attachment.
  if ((event.type === 'codex_item_delta' && event.phase === 'started') || (event.type === 'content_delta' && event.delta.type === 'tool_use')) remoteStarted.add(key)
  const app = mcpAppEventAttachment(event)
  if (!app) return
  if (remoteStarted.has(key)) executor.observeLive(ref, app)
}

/** The only View-to-host execution entry, shared by desktop IPC and paired devices. */
export async function executeMcpAppHostRequest(request: McpAppHostRequest, requester: McpAppRequester, signal = new AbortController().signal): Promise<McpAppHostResult> {
  if (!executor) return { ok: false, error: { code: 'not_connected', message: 'MCP App host executor is not available' } }
  return executor.execute(request, requester, signal)
}
