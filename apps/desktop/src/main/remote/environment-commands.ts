import type { AgentEvent, RemoteCommand } from '@superone/shared/agent-types'
import type { EnvironmentGateway, MutatingControlContext, SessionRef } from '@superone/shared/environment'
import { sessionMessageBlocksToChatMessages } from '@superone/shared/node-message-catalog'
import { createNodeSessionEventMapper } from '@superone/shared/node-session-event-map'
import { nodeHarnessToProviderId } from '@superone/shared/node-session-messages'
import { applyEventToSession, createDefaultChatCoreSession, createStreamingToolInputStore, defaultChatCorePorts } from '@superone/chat-core'
import { getEnvironmentHost } from '../environment/environment-host'
import { detailMessageId, detailUpdates, projectProgressiveEvent, projectProgressiveMessage, setProgressiveSession, subscribeDetail, unsubscribeDetail } from './progressive-session'
import { routedDetailMessage, routedHistory, routedHistoryIndex, routedSnapshot, type RoutedSessionSnapshot } from './environment-session-view'
import { routedResources } from './environment-session-resources'

type Subscription = { deviceId: string; abort: AbortController; gateway: EnvironmentGateway; ref: SessionRef; control: MutatingControlContext; timer: ReturnType<typeof setInterval> }
const subscriptions = new Map<string, Subscription>()
const key = (deviceId: string, ref: SessionRef) => JSON.stringify([deviceId, ref.environmentId, ref.sessionId])

async function release(subscription: Subscription): Promise<void> {
  subscription.abort.abort()
  clearInterval(subscription.timer)
  const subscriptionKey = key(subscription.deviceId, subscription.ref)
  if (subscriptions.get(subscriptionKey) === subscription) subscriptions.delete(subscriptionKey)
  setProgressiveSession(subscriptionKey)
  await subscription.gateway.sessions.releaseControl(subscription.control).catch(() => {})
}
export async function releaseEnvironmentDevice(deviceId: string): Promise<void> {
  await Promise.all([...subscriptions.values()].filter(item => item.deviceId === deviceId).map(release))
}

/** Paired phone → authenticated configured CLI gateway. Never falls back to local. */
export async function executeEnvironmentCommand(environmentId: string, command: RemoteCommand, deviceId: string, send: (event: AgentEvent) => Promise<void>, routeSessionId?: string): Promise<unknown> {
  if (command.type === 'environment_command') throw new Error('Nested environment routes are not allowed')
  const ref = { environmentId, sessionId: 'sessionId' in command ? command.sessionId ?? '' : routeSessionId ?? '' }
  const subscriptionKey = key(deviceId, ref)
  const current = subscriptions.get(subscriptionKey)
  // Cleanup remains possible after the target was removed or disconnected.
  if (command.type === 'unsubscribe_session' || command.type === 'leave_session') {
    if (current) await release(current)
    return { ok: true }
  }
  const host = getEnvironmentHost()
  const item = (await host.listEnvironments({ includeDescriptors: false })).find(item => item.environmentId === environmentId && item.kind === 'remote')
  if (!item) throw new Error('Unknown remote environment')
  const gateway = host.getGateway(environmentId)
  if (!gateway) throw new Error('Remote environment is disconnected')
  if (command.type === 'list_projects') return { projects: await gateway.listProjects() }
  const sessionId = ref.sessionId
  if (!sessionId) throw new Error(`Command ${command.type} is unavailable for this environment`)
  const snapshot = await gateway.sessions.get(ref) as RoutedSessionSnapshot | null
  if (!snapshot || snapshot.isHidden) throw new Error('Session unavailable')
  const project = await gateway.getProject(snapshot.projectId)
  if (!project) throw new Error('Session project unavailable')
  if ('projectPath' in command && command.projectPath && command.projectPath !== project.path) throw new Error('Session project mismatch')
  if (command.type === 'get_system_info' || command.type === 'get_project_resources' || command.type === 'list_models') {
    if ('provider' in command && command.provider !== snapshot.harnessId) throw new Error('Session harness mismatch')
    return routedResources(host, item.connectionId, snapshot, project.path, command.type)
  }
  const providerId = nodeHarnessToProviderId(snapshot.harnessId)
  if (command.type === 'subscribe_session') {
    if ([...subscriptions.values()].some(subscription => subscription.ref.environmentId === environmentId && subscription.ref.sessionId === sessionId && subscription.deviceId !== deviceId)) throw new Error('Session is controlled by another device')
    if (!gateway.sessions.linkBootstrap) throw new Error('This host does not support session links. Upgrade it.')
    const control = current?.control ?? await gateway.sessions.acquireControl({ resource: ref, ttlMs: 60_000 })
    let baseline: Awaited<ReturnType<NonNullable<typeof gateway.sessions.linkBootstrap>>>
    try { baseline = await gateway.sessions.linkBootstrap(ref) }
    catch (error) { if (!current) await gateway.sessions.releaseControl(control).catch(() => {}); throw error }
    current?.abort.abort()
    if (current) clearInterval(current.timer)
    const abort = new AbortController()
    const subscription: Subscription = { deviceId, abort, gateway, ref, control, timer: setInterval(() => {
      void gateway.sessions.renewControl({ ...subscription.control, ttlMs: 60_000 }).then(lease => {
        if (!abort.signal.aborted) subscription.control = { leaseId: lease.leaseId, generation: lease.generation }
      }).catch(async () => {
        if (abort.signal.aborted) return
        await release(subscription)
        await send({ type: 'status_change', environmentId, sessionId, status: 'error' })
      })
    }, 15_000) }
    subscription.timer.unref()
    subscriptions.set(subscriptionKey, subscription)
    setProgressiveSession(subscriptionKey, sessionId)
    const messages = sessionMessageBlocksToChatMessages(baseline.page.messages, providerId)
    let state = { ...createDefaultChatCoreSession(), messages }
    const mapper = createNodeSessionEventMapper({ projectPath: project.path, sessionId, providerId })
    const streamingStore = createStreamingToolInputStore()
    void (async () => {
      try {
        for await (const envelope of gateway.subscribeEvents({ environmentId, afterSequence: baseline.sequence, aggregateIds: [sessionId], aggregateTypes: ['session'], signal: abort.signal })) {
          if (abort.signal.aborted || subscriptions.get(subscriptionKey) !== subscription) break
          if (envelope.aggregateId !== sessionId) continue
          for (const event of mapper.map(envelope)) {
            state = { ...state, ...applyEventToSession(state, event, { ...defaultChatCorePorts, streaming: streamingStore }) }
            const projected = projectProgressiveEvent(event, state.messages)
            if (projected) await send({ ...projected, environmentId })
            for (const update of detailUpdates(subscriptionKey, sessionId, state.messages)) await send({ ...update, environmentId })
          }
        }
      } catch { if (!abort.signal.aborted) await send({ type: 'status_change', environmentId, sessionId, status: 'error' }) }
      finally { if (!abort.signal.aborted) await release(subscription) }
    })()
    return { ok: true, historyPage: { ...baseline.page, cursor: baseline.page.cursor == null ? null : Number(baseline.page.cursor), messages: messages.map(projectProgressiveMessage), provider: snapshot.harnessId, navigationAvailable: true }, snapshot: routedSnapshot(baseline.snapshot as RoutedSessionSnapshot, environmentId, messages) }
  }
  if (command.type === 'load_session_messages') return routedHistory(gateway, ref, providerId, command)
  if (command.type === 'get_session_history_index') return routedHistoryIndex(snapshot)
  if (command.type === 'subscribe_detail') {
    const message = await routedDetailMessage(gateway, ref, providerId, detailMessageId(command.detailRef))
    return subscribeDetail(subscriptionKey, sessionId, command.subscriptionId, command.detailRef, message)
  }
  if (command.type === 'unsubscribe_detail') { unsubscribeDetail(subscriptionKey, sessionId, command.subscriptionId); return { ok: true } }
  if (command.type === 'get_session_state') return routedSnapshot(snapshot, environmentId)
  if (!current) throw new Error('Open this session before operating it')
  // Reject a stale lease after takeover instead of acquiring another one.
  const lease = await gateway.sessions.renewControl({ ...current.control, ttlMs: 60_000 })
  current.control = { leaseId: lease.leaseId, generation: lease.generation }
  if (command.type === 'send_message') {
    const { type: _type, requestId: _requestId, sessionId: _sessionId, projectPath: _projectPath, content: _content, clientMessageId: _clientMessageId, ...options } = command
    await gateway.sessions.send({ session: ref, ...current.control, text: command.content, clientMessageId: command.clientMessageId, options })
    return { ok: true }
  }
  if (command.type === 'interrupt') { await gateway.sessions.interrupt(ref, current.control); return { ok: true } }
  if (command.type === 'respond_permission') { await gateway.interactions.respondPermission({ session: ref, ...current.control, interactionId: command.requestId, decision: command.decision ? command.alwaysAllow ? 'allow_always' : 'allow' : 'deny', options: command.formAnswers ? { formAnswers: command.formAnswers } : command.decision ? undefined : { cancel: true } }); return { ok: true } }
  if (command.type === 'answer_question') { await gateway.interactions.respondQuestion({ session: ref, ...current.control, interactionId: command.requestId, answers: command.answers }); return { ok: true } }
  if (command.type === 'respond_plan_approval') { await gateway.interactions.respondPlan({ session: ref, ...current.control, interactionId: command.requestId, decision: command.approved ? 'approve' : 'reject', options: { feedback: command.feedback } }); return { ok: true } }
  if (command.type === 'set_permission_mode' && gateway.sessions.patchSettings) { await gateway.sessions.patchSettings({ session: ref, ...current.control, permissionMode: command.mode }); return { ok: true } }
  if (command.type === 'set_sandbox_mode' && gateway.sessions.patchSettings) { await gateway.sessions.patchSettings({ session: ref, ...current.control, sandboxMode: command.mode }); return { ok: true } }
  throw new Error(`Command ${command.type} is unavailable for this environment`)
}
