import type { AgentEvent, RemoteCommand } from '@superone/shared/agent-types'
import type { EnvironmentGateway, MutatingControlContext, SessionRef } from '@superone/shared/environment'
import { createNodeSessionEventMapper } from '@superone/shared/node-session-event-map'
import { nodeHarnessToProviderId } from '@superone/shared/node-session-messages'
import { applyEventToSession, createDefaultChatCoreSession, createStreamingToolInputStore, defaultChatCorePorts } from '@superone/chat-core'
import { getEnvironmentHost } from '../environment/environment-host'
import { detailMessageId, detailUpdates, projectProgressiveEvent, projectProgressiveMessage, setProgressiveSession, subscribeDetail, unsubscribeDetail } from './progressive-session'
import { routedDetailMessage, routedHistory, routedHistoryIndex, routedSnapshot, type RoutedSessionSnapshot } from './environment-session-view'
import { routedResources } from './environment-session-resources'
import { catchUpEvents } from './routed-catch-up'

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
    if (!gateway.sessions.load) throw new Error('This host does not support session links. Upgrade it.')
    const load = gateway.sessions.load
    // The node holds one device at a time; another phone's open is refused there.
    const control = current?.control ?? await gateway.sessions.acquireControl({ resource: ref, ttlMs: 60_000, delegate: deviceId })
    let loaded: Awaited<ReturnType<typeof load>>
    try { loaded = await load({ session: ref, limit: 8 }) }
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
    let state = { ...createDefaultChatCoreSession(), ...loaded.state, messages: loaded.messages }
    const mapper = createNodeSessionEventMapper({ projectPath: project.path, sessionId, providerId })
    const ports = { ...defaultChatCorePorts, streaming: createStreamingToolInputStore() }
    const deliver = async (event: AgentEvent) => {
      state = { ...state, ...applyEventToSession(state, event, ports) }
      const projected = projectProgressiveEvent(event, state.messages)
      if (projected) await send({ ...projected, environmentId })
      for (const update of detailUpdates(subscriptionKey, sessionId, state.messages)) await send({ ...update, environmentId })
    }
    // The node no longer holds events this phone missed: bring its messages to
    // a fresh snapshot, and skip the events that snapshot already reflects.
    let barrier = loaded.cursor.version
    let queue = Promise.resolve()
    const serial = (task: () => Promise<void>) => (queue = queue.then(task))
    const fail = async () => {
      if (abort.signal.aborted) return
      await send({ type: 'status_change', environmentId, sessionId, status: 'error' })
      await release(subscription)
    }
    const repair = async () => {
      const fresh = await load({ session: ref, limit: 8 })
      const events = catchUpEvents(state.messages, fresh.messages)
      if (!events) throw new Error('Session diverged from its host')
      barrier = fresh.cursor.version
      for (const event of events) await deliver(event)
    }
    void (async () => {
      try {
        for await (const envelope of gateway.subscribeEvents({
          environmentId, afterSequence: loaded.cursor.sequence, epoch: loaded.cursor.epoch, versions: { [sessionId]: loaded.cursor.version },
          aggregateIds: [sessionId], aggregateTypes: ['session'], signal: abort.signal,
          onResnapshot: () => { void serial(repair).catch(fail) },
        })) {
          if (abort.signal.aborted || subscriptions.get(subscriptionKey) !== subscription) break
          await serial(async () => {
            if (envelope.aggregateId !== sessionId || (envelope.sessionVersion ?? Infinity) <= barrier) return
            for (const event of mapper.map(envelope)) await deliver(event)
          })
        }
        await queue
      } catch { await fail() }
      finally { if (!abort.signal.aborted) await release(subscription) }
    })()
    const messages = loaded.messages
    return { ok: true, historyPage: { sessionId, messages: messages.map(projectProgressiveMessage), cursor: loaded.before, hasMore: loaded.before != null, provider: snapshot.harnessId, navigationAvailable: true }, snapshot: routedSnapshot(snapshot, environmentId, messages) }
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
