import { randomUUID } from 'node:crypto'
import { shell } from 'electron'
import type { AgentEvent, ImageAttachment, RemoteCommand } from '@superone/shared/agent-types'
import { parseSessionKey, type SessionRef } from '@superone/shared/environment/refs'
import { McpAppsError } from '@superone/shared/mcp-apps'
import type { McpAppHostRequest, McpAppHostResult, McpAppRequester } from '@superone/shared/mcp-apps'
import { findMcpAppAttachment, mcpAppEventAttachment, mcpAppSessionApprovals } from '@superone/shared/mcp-apps-state'
import { RemoteMcpAppFreshness } from './remote-freshness'
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
const remoteFreshness = new RemoteMcpAppFreshness()

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
      return { ref, node: 'local', projectPath: session.projectPath, sessionApprovals: mcpAppSessionApprovals(session.snapshot.messages), ...target }
    }
    const { getEnvironmentHost } = await import('../environment/environment-host')
    const host = getEnvironmentHost()
    const node = host.connections.listKnown().find(value => value.connectionId === ref.environmentId)?.environmentId
    if (!node) throw new McpAppsError('not_connected', 'MCP App node connection unavailable')
    if (signal.aborted) throw new McpAppsError('cancelled', 'MCP App request cancelled')
    const resolved = await host.resolveMcpAppAttachment(ref.environmentId, { sessionId: ref.sessionId, appInstanceId, messageId })
    if (!resolved.ok) throw new McpAppsError(resolved.error.code, resolved.error.message)
    const path = resolved.value.projectId
    if (!path) throw new McpAppsError('not_connected', 'MCP App session project unavailable')
    return { ref, node, projectPath: `remote:${ref.environmentId}:${path}`, ...resolved.value }
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
      return routeMcpAppsProviderRequest(id => local(id), target.ref.environmentId, { ...operation, binding: target.app.binding, origin: target.app.origin! }, signal, { propagateTransportErrors: true })
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
        { deviceId: requester.deviceId, transport: requester.transport ?? 'lan' }), signal)
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
  const app = remoteFreshness.observe(ref, event)
  if (app) executor.observeLive(ref, app)
}

/** The only View-to-host execution entry, shared by desktop IPC and paired devices. */
export async function resolveMcpAppHostAttachment(request: Pick<McpAppHostRequest, 'sessionKey' | 'appInstanceId' | 'messageId'>, signal = new AbortController().signal): Promise<McpAppResolvedTarget> {
  if (!executor) throw new McpAppsError('not_connected', 'MCP App host executor is not available')
  return executor.resolve(request, signal)
}

export async function executeMcpAppHostRequest(request: McpAppHostRequest, requester: McpAppRequester, signal = new AbortController().signal, validateTarget?: (target: McpAppResolvedTarget) => void): Promise<McpAppHostResult> {
  if (!executor) return { ok: false, error: { code: 'not_connected', message: 'MCP App host executor is not available' } }
  return executor.execute(request, requester, signal, validateTarget)
}

export function isMcpAppHostActive(target: McpAppResolvedTarget): boolean {
  return executor?.isActive(target) ?? false
}
