import { getMcpAppResourceStore as resourceStore } from './resource-store'
import type { McpAppResourceSnapshot } from '@superone/shared/mcp-app-resource'
import { randomUUID } from 'node:crypto'
import type { AgentEvent, RemoteCommand } from '@superone/shared/agent-types'
import { mcpAppContent } from '@superone/shared/mcp-apps-content'
import { parseSessionKey, type SessionRef } from '@superone/shared/environment/refs'
import { McpAppsError } from '@superone/shared/mcp-apps'
import type { McpAppHostRequest, McpAppHostResult, McpAppRequester } from '@superone/shared/mcp-apps'
import { findMcpAppAttachment, mcpAppEventAttachment } from '@superone/shared/mcp-apps-state'
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
      return { ref, node: 'local', projectPath: session.projectPath, ...target }
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
      const compact = update.resource?.html !== undefined ? { ...update, resource: resourceStore().put(update.resource as McpAppResourceSnapshot) } : update
      const event: AgentEvent = { type: 'mcp_app_updated', sessionId: target.ref.sessionId, projectPath: target.projectPath,
        messageId: target.messageId, appInstanceId: target.app.appInstanceId, update: compact }
      if (target.ref.environmentId === 'local') local(target.ref.sessionId).emitHostEvent(event)
      else {
        const { getEnvironmentHost } = await import('../environment/environment-host')
        const result = await getEnvironmentHost().updateMcpAppState(target.ref.environmentId, { sessionId: target.ref.sessionId, appInstanceId: target.app.appInstanceId, update })
        if (!result.ok) throw new McpAppsError(result.error.code, result.error.message)
        publish(event)
        mobile.notifyEventSubscribers(event)
      }
    },
    async hydrateResource(target, signal) {
      if (!target.app.resource) throw new McpAppsError('invalid', 'Saved MCP App resource is unavailable')
      if (target.ref.environmentId === 'local') return resourceStore().hydrate(target.app.resource)
      try { return resourceStore().hydrate(target.app.resource) } catch { /* Fetch an owning-node snapshot, never current server HTML. */ }
      const { getEnvironmentHost } = await import('../environment/environment-host')
      const result = await getEnvironmentHost().loadMcpAppResource(target.ref.environmentId, { sessionId: target.ref.sessionId, appInstanceId: target.app.appInstanceId })
      if (!result.ok) throw new McpAppsError(result.error.code, result.error.message)
      if (signal.aborted) throw new McpAppsError('cancelled', 'MCP App resource load cancelled')
      const reference = resourceStore().put(result.value)
      if (reference.hash !== target.app.resource.hash) throw new McpAppsError('invalid', 'Saved MCP App resource changed')
      return { ...target.app.resource, html: result.value.html }
    },
    async provider(target, operation, signal) {
      if (signal.aborted) throw new McpAppsError('cancelled', 'MCP App request cancelled')
      return routeMcpAppsProviderRequest(id => local(id), target.ref.environmentId, { ...operation, binding: target.app.binding, origin: target.app.origin! }, signal, { propagateTransportErrors: true })
    },
    async createMessageSession(target, signal) {
      if (signal.aborted) throw new McpAppsError('cancelled', 'MCP App message cancelled')
      if (target.ref.environmentId === 'local') {
        const owner = local(target.ref.sessionId)
        const source = owner.snapshot
        const settings = owner.getUiSettings()
        const sandbox = owner.getCurrentSandboxInfo()
        const session = manager.createSession({
          projectPath: source.projectPath, cwd: source.cwd, gitBranch: source.gitBranch,
          providerId: source.providerId, apiProviderId: source.apiProviderId,
          model: source.selectedModel ?? undefined, effort: owner.getSelectedEffort(),
          permissionMode: owner.getCurrentPermissionMode(),
          sandboxMode: !sandbox.enabled ? 'off' : sandbox.autoAllowBash ? 'auto' : 'on',
          codexServiceTier: settings.selectedCodexServiceTier, acpAgentId: source.acpAgentId,
        })
        if (session.snapshot.harnessId !== source.harnessId) throw new McpAppsError('invalid', 'New conversation harness does not match its source')
        session.broadcastSettingsPatch(settings)
        return { ref: { environmentId: 'local', sessionId: session.id }, projectPath: source.projectPath }
      }
      const { getEnvironmentHost } = await import('../environment/environment-host')
      const host = getEnvironmentHost()
      const source = await host.getSession(target.ref.environmentId, target.ref.sessionId) as {
        projectId?: string; providerId?: string; harnessId?: string; cwd?: string | null
        model?: string | null; effort?: string | null; permissionMode?: string | null; sandboxMode?: string | null; apiProviderId?: string | null
      } | null
      if (!source?.projectId || !source.providerId || !source.harnessId) throw new McpAppsError('not_connected', 'MCP App source conversation settings are unavailable')
      const session = await host.createSession(target.ref.environmentId, {
        projectId: source.projectId, providerId: source.providerId, harnessId: source.harnessId, cwd: source.cwd ?? null,
        settings: { model: source.model ?? null, effort: source.effort ?? null, permissionMode: source.permissionMode ?? null,
          sandboxMode: source.sandboxMode ?? null, apiProviderId: source.apiProviderId ?? null },
      })
      return { ref: { ...target.ref, sessionId: session.sessionId }, projectPath: target.projectPath }
    },
    async sendMessage(target, params, requester, signal) {
      const clientMessageId = randomUUID()
      const { text, ...display } = mcpAppContent(params.content, target.app.binding.server, `mcp:${clientMessageId}`)
      const content = `[MCP App: ${target.app.binding.server}]\n${text}`
      const { images, userMessageContent, contexts } = display
      if (requester.kind === 'mobile' && target.ref.environmentId === 'local') {
        await acceptedSend(onAccepted => mobile.handleRemoteCommand({ type: 'send_message', requestId: randomUUID(),
          projectPath: target.projectPath, sessionId: target.ref.sessionId, content, images, userMessageContent, contexts, clientMessageId, priority: 'next' },
        async (_id, data) => { const response = data as { error?: unknown; ok?: boolean }; if (response.error) throw new McpAppsError('denied', String(response.error)); if (response.ok) onAccepted() },
        { deviceId: requester.deviceId, transport: requester.transport ?? 'lan' }), signal)
      } else if (target.ref.environmentId === 'local') {
        await acceptedSend(onAccepted => local(target.ref.sessionId).send({ content, images, userMessageContent, contexts, clientMessageId, priority: 'next' }, { onAccepted }), signal)
      } else {
        const { getEnvironmentHost } = await import('../environment/environment-host')
        await acceptedSend(onAccepted => getEnvironmentHost().sendSessionMessage(target.ref.environmentId, {
          sessionId: target.ref.sessionId, text: content, images, userMessageContent, contexts, echoUserMessage: true, clientMessageId, projectPath: target.projectPath, onAccepted,
        }), signal)
      }
    },
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
