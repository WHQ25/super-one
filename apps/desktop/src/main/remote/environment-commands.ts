import { isEnvironment } from '@superone/shared/environment/client-view'
import type { AgentEvent, HarnessId, RemoteCommand } from '@superone/shared/agent-types'
import type { EnvironmentGateway, MutatingControlContext, SessionLoadResult, SessionRef } from '@superone/shared/environment'
import { createNodeSessionEventMapper } from '@superone/shared/node-session-event-map'
import { nodeHarnessToProviderId } from '@superone/shared/node-session-messages'
import { remoteProjectKey } from '@superone/shared/remote-resource-key'
import { applyEventToSession, createDefaultChatCoreSession, createStreamingToolInputStore, defaultChatCorePorts, type ChatCoreSession } from '@superone/chat-core'
import { getEnvironmentHost } from '../environment/environment-host'
import { DetailViews, detailMessageId, projectProgressiveEvent, projectProgressiveMessage } from '@superone/runtime/stream'
import { routedDetailMessage, routedHistory, routedHistoryIndex, routedSnapshot, type RoutedSessionSnapshot } from './environment-session-view'
import { routedResources } from './environment-session-resources'
import { catchUpEvents } from './routed-catch-up'

type Subscription = {
  deviceId: string
  abort: AbortController
  gateway: EnvironmentGateway
  ref: SessionRef
  projectKey: string
  control: MutatingControlContext
  timer: ReturnType<typeof setInterval>
  /** Stops following the session on the node's shared feed. */
  unfollow?: () => void
  /** The node sends this desktop's connection the session summarized: detail is the node's to serve. */
  summarized: boolean
}
const subscriptions = new Map<string, Subscription>()
const key = (deviceId: string, ref: SessionRef) => JSON.stringify([deviceId, ref.environmentId, ref.sessionId])
/** Each routed subscription's summarized session and expanded rows. */
const routedViews = new Map<string, DetailViews>()
function viewsOf(subscriptionKey: string): DetailViews {
  let views = routedViews.get(subscriptionKey)
  if (!views) routedViews.set(subscriptionKey, views = new DetailViews())
  return views
}

/** How a routed phone's hold on a node session shows on this desktop, as a local session's does. */
export interface RoutedPresence {
  /** `remote_session_start` / `remote_session_end`: the window shows observation mode meanwhile. */
  publish(event: AgentEvent): void
  /** Tell a phone the desktop took its session back. */
  kick(deviceId: string, sessionId: string): void
}
let presence: RoutedPresence | null = null
export function setRoutedPresence(port: RoutedPresence): void { presence = port }

async function release(subscription: Subscription): Promise<void> {
  const subscriptionKey = key(subscription.deviceId, subscription.ref)
  if (subscriptions.get(subscriptionKey) === subscription) {
    presence?.publish({ type: 'remote_session_end', remoteProjectPath: subscription.projectKey, remoteSessionId: subscription.ref.sessionId, isSubscribe: true })
  }
  subscription.abort.abort()
  subscription.unfollow?.()
  clearInterval(subscription.timer)
  if (subscriptions.get(subscriptionKey) === subscription) subscriptions.delete(subscriptionKey)
  routedViews.delete(subscriptionKey)
  await subscription.gateway.sessions.releaseControl(subscription.control).catch(() => {})
}
export async function releaseEnvironmentDevice(deviceId: string): Promise<void> {
  await Promise.all([...subscriptions.values()].filter(item => item.deviceId === deviceId).map(release))
}

/** The window's Disconnect: take a routed session (or every one) back from its phone. */
export async function kickRoutedSessions(sessionId?: string): Promise<void> {
  await Promise.all([...subscriptions.values()].filter(item => !sessionId || item.ref.sessionId === sessionId).map(item => {
    presence?.kick(item.deviceId, item.ref.sessionId)
    return release(item)
  }))
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
  const item = (await host.listEnvironments({ includeDescriptors: false })).find(item => isEnvironment(item, environmentId) && item.kind === 'remote')
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
    if (!gateway.sessions.load) throw new Error('This host does not support session links. Upgrade it.')
    const load = gateway.sessions.load
    // The node holds one device at a time; another phone's open is refused there.
    const control = current?.control ?? await gateway.sessions.acquireControl({ resource: ref, ttlMs: 60_000, delegate: deviceId })
    current?.abort.abort()
    current?.unfollow?.()
    if (current) clearInterval(current.timer)
    const abort = new AbortController()
    const projectKey = remoteProjectKey(item.connectionId, project.path)
    const subscription: Subscription = { deviceId, abort, gateway, ref, projectKey, control, summarized: false, timer: setInterval(() => {
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
    const mapper = createNodeSessionEventMapper({ projectPath: project.path, sessionId, providerId })
    const ports = { ...defaultChatCorePorts, streaming: createStreamingToolInputStore() }
    let loaded!: SessionLoadResult
    let state!: ChatCoreSession
    // Events at or below the snapshot this phone's messages were last brought to.
    let barrier = 0
    const adopt = (fresh: SessionLoadResult) => {
      loaded = fresh
      state = { ...createDefaultChatCoreSession(), ...fresh.state, messages: fresh.messages } as ChatCoreSession
      subscription.summarized = fresh.summarized === true
      barrier = fresh.cursor.version
    }
    const deliver = async (event: AgentEvent) => {
      state = { ...state, ...applyEventToSession(state, event, ports) }
      const projected = projectProgressiveEvent(event, state.messages)
      if (projected) await send({ ...projected, environmentId })
      for (const update of viewsOf(subscriptionKey).updates(sessionId, state.messages)) await send({ ...update, environmentId })
    }
    let queue = Promise.resolve()
    const serial = (task: () => Promise<void>) => (queue = queue.then(task))
    const fail = async () => {
      if (abort.signal.aborted) return
      await send({ type: 'status_change', environmentId, sessionId, status: 'error' })
      await release(subscription)
    }
    // Some events are gone, or the node's link changed tier: this desktop's
    // copy is replaced by a fresh snapshot, and the phone gets the difference
    // between the summaries it has and the fresh ones.
    const realign = async () => {
      const shown = state.messages.map(projectProgressiveMessage)
      const fresh = await load({ session: ref, limit: 8 })
      const events = catchUpEvents(shown, fresh.messages.map(projectProgressiveMessage))
      if (!events) throw new Error('Session diverged from its host')
      adopt(fresh)
      for (const event of events) await send({ ...event, environmentId })
    }
    try {
      subscription.unfollow = await getEnvironmentHost().followSessionEvents(item.connectionId, sessionId, {
        event: (envelope) => {
          void serial(async () => {
            if (abort.signal.aborted || (envelope.sessionVersion ?? Infinity) <= barrier) return
            for (const event of mapper.map(envelope)) await deliver(event)
          }).catch(fail)
        },
        end: () => { void fail() },
        resync: () => { void serial(realign).catch(fail) },
      }, async () => {
        adopt(await load({ session: ref, limit: 8 }))
        return loaded.cursor.version
      })
    } catch (error) {
      clearInterval(subscription.timer)
      if (subscriptions.get(subscriptionKey) === subscription) subscriptions.delete(subscriptionKey)
      await gateway.sessions.releaseControl(control).catch(() => {})
      throw error
    }
    if (!current) presence?.publish({ type: 'remote_session_start', remoteProjectPath: projectKey, remoteSessionId: sessionId, harnessId: snapshot.harnessId as HarnessId, isSubscribe: true })
    viewsOf(subscriptionKey).open(sessionId)
    const messages = loaded.messages
    return { ok: true, historyPage: { sessionId, messages: messages.map(projectProgressiveMessage), cursor: loaded.before, hasMore: loaded.before != null, provider: snapshot.harnessId, navigationAvailable: true }, snapshot: routedSnapshot(snapshot, environmentId, messages) }
  }
  if (command.type === 'load_session_messages') return routedHistory(gateway, ref, providerId, command)
  if (command.type === 'get_session_history_index') return routedHistoryIndex(snapshot)
  if (command.type === 'subscribe_detail') {
    // A summarized copy lacks the bodies: the node that holds them serves the detail.
    if (current?.summarized && gateway.sessions.subscribeDetail) {
      return gateway.sessions.subscribeDetail({ session: ref, detailRef: command.detailRef, subscriptionId: command.subscriptionId,
        onUpdate: (update) => { void send({ type: 'remote_detail', sessionId, environmentId, ...update }) } })
    }
    const message = await routedDetailMessage(gateway, ref, providerId, detailMessageId(command.detailRef))
    return viewsOf(subscriptionKey).subscribe(sessionId, command.subscriptionId, command.detailRef, message)
  }
  if (command.type === 'unsubscribe_detail') {
    routedViews.get(subscriptionKey)?.unsubscribe(sessionId, command.subscriptionId)
    await gateway.sessions.unsubscribeDetail?.({ session: ref, subscriptionId: command.subscriptionId }).catch(() => {})
    return { ok: true }
  }
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
