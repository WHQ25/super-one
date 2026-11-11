import type { AgentEvent, AgentStatus, HarnessId, PermissionRequest } from '@superone/shared/agent-types'
import { SESSION_DURABLE_EVENT, type EnvironmentEventEnvelope } from '@superone/shared/environment'
import { SESSION_LIST_EVENT_TYPES, topicKey, type TopicRef, type TopicVersionCursor } from '@superone/shared/environment/topics'
import { summarizeSessionActivity, type SessionActivity } from '@superone/shared/session-activity'
import type { PendingInteraction, NodeSessionRecord } from '@superone/runtime/session'
import type { RpcContext } from '@superone/runtime/server'
import { VersionedTopicLog } from '@superone/runtime/stream'

const SIDEBAR_HARNESSES = new Set<HarnessId>(['claude', 'codex', 'acp-grok', 'acp-antigravity', 'opencode', 'cursor', 'dsh'])

/** Durable session events that change the sidebar row's running state or pending chip. */
const ACTIVITY_EVENTS = new Set<string>([
  SESSION_DURABLE_EVENT.turnStarted,
  SESSION_DURABLE_EVENT.turnCompleted,
  SESSION_DURABLE_EVENT.turnInterrupted,
  SESSION_DURABLE_EVENT.turnError,
  SESSION_DURABLE_EVENT.statusChanged,
  SESSION_DURABLE_EVENT.permissionRequested,
  SESSION_DURABLE_EVENT.permissionResponded,
  SESSION_DURABLE_EVENT.permissionTimeout,
  SESSION_DURABLE_EVENT.permissionAborted,
  SESSION_DURABLE_EVENT.questionRequested,
  SESSION_DURABLE_EVENT.questionResponded,
  SESSION_DURABLE_EVENT.questionTimeout,
  SESSION_DURABLE_EVENT.questionAborted,
  SESSION_DURABLE_EVENT.planRequested,
  SESSION_DURABLE_EVENT.planResponded,
  SESSION_DURABLE_EVENT.planTimeout,
  SESSION_DURABLE_EVENT.planAborted,
  SESSION_DURABLE_EVENT.closed,
])

export interface NodeSessionListNoticeDeps {
  environmentId: string
  listSessions(): NodeSessionRecord[]
  getSession(sessionId: string): NodeSessionRecord | null
  projectPath(projectId: string): string | null
}

interface NoticeFollower {
  following: boolean
  cursors: Record<string, TopicVersionCursor>
  snapshot(topic: TopicRef): unknown
  push(frame: { topic: TopicRef; cursor?: TopicVersionCursor; events: AgentEvent[]; snapshot?: unknown }): void
}

/**
 * Sidebar notices for a CLI node. `session_list_changed` refreshes membership
 * (including a spawn child's parent). `session_activity` carries the row's
 * running state. Composer drafts stay on the draft stream: this publisher
 * covers `sessionList` only.
 */
export function createNodeSessionListNotices(deps: NodeSessionListNoticeDeps) {
  const log = new VersionedTopicLog<AgentEvent>()
  const paths = new Map<string, string>()
  const followers = new Set<NoticeFollower>()
  const topic: TopicRef = { kind: 'sessionList', environmentId: deps.environmentId }

  const pathOf = (session: NodeSessionRecord | null, sessionId: string): string | null => {
    if (session) {
      const path = deps.projectPath(session.projectId)
      if (path) paths.set(sessionId, path)
      return path ?? paths.get(sessionId) ?? null
    }
    return paths.get(sessionId) ?? null
  }

  for (const session of deps.listSessions()) pathOf(session, session.sessionId)

  const publish = (event: AgentEvent) => {
    log.append(event)
    const frame = { topic, cursor: log.cursor(), events: [event] }
    for (const follower of followers) {
      if (!follower.following) continue
      try { follower.push(frame) } catch { /* a closed reader must not stop the session log */ }
    }
  }

  const activities = (): SessionActivity[] => {
    const rows: SessionActivity[] = []
    for (const session of deps.listSessions()) {
      const projectPath = pathOf(session, session.sessionId)
      const activity = projectPath ? sessionActivity(session, projectPath) : null
      if (activity) rows.push(activity)
    }
    return rows
  }

  const catchUp = (follower: NoticeFollower) => {
    const resumed = log.since(follower.cursors[topicKey(topic)])
    if (resumed.kind === 'replay') {
      follower.push({ topic, cursor: resumed.cursor, events: resumed.items })
      return
    }
    const snapshot = follower.snapshot(topic)
    const base = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
      ? snapshot as Record<string, unknown>
      : {}
    follower.push({ topic, cursor: resumed.cursor, events: [], snapshot: { ...base, activities: activities() } })
  }

  const wantsList = (topics: readonly TopicRef[]) =>
    topics.some((item) => item.kind === 'sessionList' && item.environmentId === deps.environmentId)

  const open: NonNullable<RpcContext['topicNotices']>['open'] = (input) => {
    const follower: NoticeFollower = {
      following: false,
      cursors: input.cursors,
      snapshot: input.snapshot,
      push: input.push,
    }
    const apply = (topics: readonly TopicRef[]) => {
      const wants = wantsList(topics)
      if (wants && !follower.following) {
        follower.following = true
        catchUp(follower)
      } else if (!wants) {
        follower.following = false
      }
    }
    followers.add(follower)
    apply(input.topics)
    return {
      setTopics(topics) { apply(topics) },
      close() { followers.delete(follower) },
    }
  }

  return {
    topicNotices: { covers: ['sessionList'] as const, open },
    onSessionEvent(envelope: EnvironmentEventEnvelope) {
      if (envelope.aggregateType !== 'session' || envelope.environmentId !== deps.environmentId) return
      const sessionId = envelope.aggregateId
      const session = deps.getSession(sessionId)
      const projectPath = pathOf(session, sessionId)
      if (!projectPath) return
      if (SESSION_LIST_EVENT_TYPES.has(envelope.eventType)) {
        publish({ type: 'session_list_changed', projectPath })
      }
      if (session && ACTIVITY_EVENTS.has(envelope.eventType)) {
        const activity = sessionActivity(session, projectPath)
        if (activity) {
          const completed = envelope.eventType === SESSION_DURABLE_EVENT.turnCompleted && activity.status === 'idle'
          publish({ type: 'session_activity', activity, ...(completed ? { completed: true } : {}) })
        }
      }
      if (envelope.eventType === SESSION_DURABLE_EVENT.removed) paths.delete(sessionId)
    },
    close() { followers.clear() },
  }
}

function sessionActivity(session: NodeSessionRecord, projectPath: string): SessionActivity | null {
  if (!SIDEBAR_HARNESSES.has(session.harnessId as HarnessId)) return null
  return summarizeSessionActivity({
    id: session.sessionId,
    projectPath,
    status: sidebarStatus(session.status),
    harnessId: session.harnessId as HarnessId,
    acpAgentId: session.acpAgentId,
    title: session.title,
    parentSessionId: session.parentSessionId,
  }, pendingAgentEvents(session.pendingInteraction))
}

function sidebarStatus(status: string): AgentStatus {
  if (status === 'streaming' || status === 'background' || status === 'error') return status
  return 'idle'
}

function pendingAgentEvents(pending: PendingInteraction | null): AgentEvent[] {
  if (!pending) return []
  if (pending.kind === 'question') return [questionEvent(pending)]
  if (pending.kind === 'plan') return [planEvent(pending)]
  return [permissionEvent(pending)]
}

function permissionEvent(pending: PendingInteraction): AgentEvent {
  const confirm = pending.requestKind === 'session_agents_confirm' || pending.kind === 'session_agents_confirm'
  return {
    type: 'permission_request',
    request: {
      requestId: pending.interactionId,
      toolName: pending.toolName ?? '',
      ...(pending.toolUseId ? { toolUseId: pending.toolUseId } : {}),
      input: pending.input ?? {},
      allowAlwaysAllow: pending.allowAlwaysAllow === true,
      ...(pending.message ? { message: pending.message } : {}),
      ...(confirm ? {
        requestKind: 'session_agents_confirm' as const,
        ...(pending.sessionAgentsConfirm
          ? { sessionAgentsConfirm: pending.sessionAgentsConfirm as PermissionRequest['sessionAgentsConfirm'] }
          : {}),
      } : {}),
    },
  }
}

function questionEvent(pending: PendingInteraction): AgentEvent {
  const raw = pending.input?.questions
  const questions = Array.isArray(raw) ? raw.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const row = item as Record<string, unknown>
    const options = Array.isArray(row.options) ? row.options.flatMap((option) => {
      if (!option || typeof option !== 'object') return []
      const value = option as Record<string, unknown>
      const label = typeof value.label === 'string' ? value.label : ''
      if (!label) return []
      return [{ label, description: typeof value.description === 'string' ? value.description : '' }]
    }) : []
    return [{
      question: typeof row.question === 'string' ? row.question : '',
      header: typeof row.header === 'string' ? row.header : '',
      options,
      multiSelect: row.multiSelect === true,
    }]
  }) : []
  return { type: 'ask_user_question', request: { requestId: pending.interactionId, questions } }
}

function planEvent(pending: PendingInteraction): AgentEvent {
  const input = pending.input ?? {}
  const planContent = typeof input.plan === 'string' ? input.plan
    : typeof input.planContent === 'string' ? input.planContent
    : pending.message ?? ''
  const planFilePath = typeof input.planFilePath === 'string' ? input.planFilePath : ''
  const allowedPrompts = Array.isArray(input.allowedPrompts) ? input.allowedPrompts.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const row = item as Record<string, unknown>
    if (typeof row.tool !== 'string' || typeof row.prompt !== 'string') return []
    return [{ tool: row.tool, prompt: row.prompt }]
  }) : []
  return { type: 'plan_approval', request: { requestId: pending.interactionId, planContent, planFilePath, allowedPrompts } }
}
