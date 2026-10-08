/**
 * Spawn-child lifecycle as its parent and the human see it.
 *
 * Waking the parent costs tokens and waiting does not, so the only wake added
 * here is the fallback for a child that stopped without reporting: the parent
 * would otherwise wait forever. A child reports with session_collab_send, which
 * wakes the parent on its own. Stalls notify the human instead, and a run the
 * human stopped wakes nobody.
 */

import { randomUUID } from 'node:crypto'
import type { AgentEvent, AgentStatus, ChatMessage, SessionAgentLaunchConfig, SessionAgentRunState } from '@superone/shared/agent-types'
import { parseGrantConfig } from '@superone/runtime/collaboration'
import { classifyAgentErrorText, isRateLimitErrorInfo } from '@superone/shared/agent-error'
import log from '../logger'
import { collaborationStore, spawnParentOf } from './collaboration-mailbox'
import { wakeParentOfStoppedChild } from './collaboration-host'
import { remoteChildState, remoteChildTarget } from './collaboration-remote'
import type { Session, SessionManager, TaskNotificationDelivery } from './types'

/** Streaming with no agent event or user action for this long counts as a stall. */
export const CHILD_STALL_MS = 10 * 60_000
export const CHILD_STALL_CHECK_INTERVAL_MS = 60_000

export type CollaborationChildState = 'running' | 'awaiting_approval' | 'stalled' | 'idle' | 'error' | 'unreachable'

export interface CollaborationChildStatus {
  state: CollaborationChildState
  /** ISO time of the last agent event or user action; absent when unknown. */
  lastActivityAt?: string
  /** Top-level tool still waiting for its result. */
  runningTool?: string
}

/**
 * A child as this desktop sees it, wherever it runs: a local Session, or a
 * session on another machine read from its node plus the events this desktop
 * drained from it.
 */
export interface ChildActivityView {
  activity: AgentStatus
  awaitingApproval: boolean
  /** Last agent event or user action (ms); absent when unknown. */
  lastActivityAt?: number
  runningTool?: string
}

const TOOL_RESULT_TYPES = new Set(['tool_result', 'bash_result', 'todo_result'])

/** Name of the newest top-level tool call in the last assistant message that has no result yet. */
export function runningToolName(messages: readonly ChatMessage[]): string | undefined {
  const last = messages.findLast((message) => message.role === 'assistant')
  if (!last) return undefined
  const finished = new Set(last.content.flatMap((block) =>
    TOOL_RESULT_TYPES.has(block.type) ? [(block as { toolUseId: string }).toolUseId] : []))
  for (let index = last.content.length - 1; index >= 0; index--) {
    const block = last.content[index]!
    if (block.type === 'tool_use' && !block.parentToolUseId && !finished.has(block.toolUseId)) return block.toolName
  }
  return undefined
}

/** The view of a local child; null when it is not loaded. */
export function localChildView(session: Session | null): ChildActivityView | null {
  if (!session) return null
  const activity = session.activityStatus()
  // A settled child runs no tool; skip the transcript scan.
  const runningTool = activity === 'idle' || activity === 'error' ? undefined : runningToolName(session.snapshot.messages)
  return {
    activity,
    awaitingApproval: session.getPendingInteractions().length > 0,
    lastActivityAt: session.lastRuntimeActivityAt,
    ...(runningTool ? { runningTool } : {}),
  }
}

function viewState(view: ChildActivityView, now: number): CollaborationChildState {
  const { activity } = view
  if (activity === 'idle' || activity === 'error') return activity
  if (view.awaitingApproval) return 'awaiting_approval'
  if (activity === 'streaming' && view.lastActivityAt !== undefined && now - view.lastActivityAt >= CHILD_STALL_MS) {
    return 'stalled'
  }
  return 'running'
}

/** What session_collab_retrieve reports for a child peer. A child with no view is idle. */
export function describeChildView(view: ChildActivityView | null, now = Date.now()): CollaborationChildStatus {
  if (!view) return { state: 'idle' }
  const state = viewState(view, now)
  const lastActivityAt = view.lastActivityAt !== undefined ? { lastActivityAt: new Date(view.lastActivityAt).toISOString() } : {}
  if (state === 'idle' || state === 'error') return { state, ...lastActivityAt }
  return { state, ...lastActivityAt, ...(view.runningTool ? { runningTool: view.runningTool } : {}) }
}

/** {@link describeChildView} of a local child. */
export function describeChildStatus(session: Session | null, now = Date.now()): CollaborationChildStatus {
  return describeChildView(localChildView(session), now)
}

/**
 * The view of a child wherever it runs; `unreachable` when it runs on a
 * machine this desktop cannot reach now.
 */
export async function childActivityView(
  host: SessionManager,
  sessionId: string,
): Promise<ChildActivityView | null | 'unreachable'> {
  if (!remoteChildTarget(sessionId)) return localChildView(host.getSession(sessionId))
  const remote = await remoteChildState(sessionId)
  if (!remote) return 'unreachable'
  const lastActivityAt = observedActivityAt(sessionId)
  return {
    activity: nodeStatusActivity(remote.status),
    awaitingApproval: remote.pendingInteraction != null,
    ...(lastActivityAt !== undefined ? { lastActivityAt } : {}),
  }
}

/** What session_collab_retrieve reports for a child peer, wherever it runs. */
export async function describeCollaborationChild(
  host: SessionManager,
  sessionId: string,
  now = Date.now(),
): Promise<CollaborationChildStatus> {
  const view = await childActivityView(host, sessionId)
  return view === 'unreachable' ? { state: 'unreachable' } : describeChildView(view, now)
}

/**
 * When this desktop last saw a live event of each session. For a child on
 * another machine that is its last activity: its events reach this desktop
 * only as the turns it starts there are drained.
 */
const observedEventAt = new Map<string, number>()

export function observedActivityAt(sessionId: string): number | undefined {
  return observedEventAt.get(sessionId)
}

/** A remote node's session status as an agent activity. */
export function nodeStatusActivity(status: string): AgentStatus {
  if (status === 'streaming') return 'streaming'
  if (status === 'error') return 'error'
  return 'idle'
}

/**
 * True when the child sent a collaboration message after its last input: the
 * initial task or a user message (`lastUserMessageAt`), or a mailbox delivery.
 */
export function reportedSinceLastInput(childSessionId: string, lastUserMessageAt: number | null): boolean {
  const { sentAt, receivedAt } = collaborationStore().lastMessageTimes(childSessionId)
  if (!sentAt) return false
  const lastInput = Math.max(lastUserMessageAt ?? 0, receivedAt ? Date.parse(receivedAt) : 0)
  return Date.parse(sentAt) >= lastInput
}

/** Short failure label for the wake line, e.g. "rate limited or out of quota". */
export function describeRunError(event: Extract<AgentEvent, { type: 'message_error' }>): string {
  const info = event.errorInfo ?? { raw: event.error, ...classifyAgentErrorText(event.error) }
  if (isRateLimitErrorInfo(info)) return 'rate limited or out of quota'
  if (info.code) return info.code.replace(/_/g, ' ')
  return event.error.trim().split('\n')[0]!.slice(0, 160)
}


export interface CollaborationChildMonitorDeps {
  host: SessionManager
  /** The child as seen now (see {@link ChildActivityView}); null when unknown. */
  view(sessionId: string): ChildActivityView | null | Promise<ChildActivityView | null>
  /** When the child last got a user message; null when unknown. */
  lastUserMessageAt(sessionId: string): number | null
  notifyStalled(sessionId: string): void
  clearStalled(sessionId: string): void
  now?: () => number
}

/**
 * Feeds on every live session event, from local sessions and from children
 * on other machines alike. A run opens on `streaming` / `background` (or the
 * first assistant message or error) and stops on the `idle` / `error` that
 * settles it, so a turn that ends with background tasks still running is not
 * a stop. Replayed events are ignored: they describe no new stop.
 */
export class CollaborationChildMonitor {
  private readonly runs = new Map<string, SessionAgentRunState>()
  /** sessionId → the activity time its stall was observed at; one notice per stall. */
  private readonly stalls = new Map<string, number>()
  /** Grants whose stop wake is being delivered now. */
  private readonly delivering = new Set<string>()
  /**
   * Stop wakes the parent's harness queued in memory: not retried while this
   * process lives, delivered again after a restart (at least once).
   */
  private readonly queuedWakes = new Set<string>()
  private readonly now: () => number

  constructor(private readonly deps: CollaborationChildMonitorDeps) {
    this.now = deps.now ?? Date.now
  }

  /** `stopKey` identifies the stop durably (a node event sequence); local stops get a fresh one. */
  handleEvent(sessionId: string, event: AgentEvent, replay: boolean, stopKey?: string): void {
    if (replay) return
    observedEventAt.set(sessionId, this.now())
    switch (event.type) {
      case 'status_change':
        if (event.status === 'streaming' || event.status === 'background') this.open(sessionId)
        else this.stopRun(sessionId, event.status, stopKey)
        break
      case 'message_start':
        if (event.message.role === 'assistant') this.runs.set(sessionId, { interrupted: false })
        break
      case 'message_error':
        this.open(sessionId).error = describeRunError(event)
        break
      case 'message_interrupted': {
        const run = this.runs.get(sessionId)
        if (run) run.interrupted = true
        break
      }
    }
    // Any live event is activity: the stall is over.
    this.clearStall(sessionId)
  }

  /**
   * A child seen mid-run without its opening event (this desktop restarted or
   * reconnected while it ran): its next stop must still count. `state` is the
   * run as last recorded, when this desktop recorded one.
   */
  resumeRun(sessionId: string, state?: SessionAgentRunState): void {
    if (!this.runs.has(sessionId) && state) this.runs.set(sessionId, { ...state })
    else this.open(sessionId)
  }

  /** The open run of `sessionId`, for recording with an event cursor; null when none is open. */
  runState(sessionId: string): SessionAgentRunState | null {
    const run = this.runs.get(sessionId)
    return run ? { ...run } : null
  }

  /**
   * The open run of `sessionId` ended: `status` is how (`idle`, `error`, or a
   * description). A child that stopped without reporting wakes its parent;
   * the wake is recorded on the grant first and cleared only once delivered.
   */
  stopRun(sessionId: string, status: string, stopKey = `local:${randomUUID()}`): void {
    const run = this.runs.get(sessionId)
    this.runs.delete(sessionId)
    this.clearStall(sessionId)
    if (!run || run.interrupted) return
    const grant = collaborationStore().spawnGrantForChild(sessionId)
    if (!grant) return
    // The task never arrived: session_collab_start already told the parent why.
    if (grant.task_sent !== 1) return
    if (reportedSinceLastInput(sessionId, this.deps.lastUserMessageAt(sessionId))) return
    const label = status === 'error' && run.error ? `error: ${run.error}` : status
    log.info('[session-collaboration] child stopped without reporting sid=%s parent=%s status=%s', sessionId, grant.parent_session_id, label)
    const store = collaborationStore()
    const config = parseGrantConfig<StopWakeConfig>(grant.config_json)
    if (config.pendingStopWake?.key !== stopKey) {
      store.updateConfig(grant.grant_id, { ...config, pendingStopWake: { key: stopKey, status: label } })
    }
    // After the caller's transaction (if any) commits.
    queueMicrotask(() => void this.deliverStopWake(grant.grant_id))
  }

  /** Deliver every recorded stop wake still pending (startup, then periodically). */
  async retryStopWakes(): Promise<void> {
    const grants = collaborationStore().startedSpawnGrants()
      .filter((grant) => parseGrantConfig<StopWakeConfig>(grant.config_json).pendingStopWake)
    await Promise.all(grants.map((grant) => this.deliverStopWake(grant.grant_id)))
  }

  /** Notify the human once per stall of a spawn child; never wakes the parent. */
  async checkStalls(now = this.now()): Promise<void> {
    for (const sessionId of [...this.runs.keys()]) {
      if (!spawnParentOf(sessionId)) continue
      const view = await this.deps.view(sessionId)
      if (!view || viewState(view, now) !== 'stalled' || !this.runs.has(sessionId)) continue
      const activityAt = view.lastActivityAt!
      if (this.stalls.get(sessionId) === activityAt) continue
      this.stalls.set(sessionId, activityAt)
      this.deps.notifyStalled(sessionId)
    }
  }

  private async deliverStopWake(grantId: string): Promise<void> {
    if (this.delivering.has(grantId)) return
    const store = collaborationStore()
    const grant = store.grantById(grantId)
    const pending = grant && parseGrantConfig<StopWakeConfig>(grant.config_json).pendingStopWake
    if (!grant?.child_session_id || !pending || this.queuedWakes.has(pending.key)) return
    this.delivering.add(grantId)
    let delivery: TaskNotificationDelivery
    try {
      delivery = await wakeParentOfStoppedChild(this.deps.host, grant.parent_session_id, grant.child_session_id, pending.status)
    } finally {
      this.delivering.delete(grantId)
    }
    if (delivery === 'failed') return
    if (delivery === 'deferred') {
      this.queuedWakes.add(pending.key)
      return
    }
    const current = store.grantById(grantId)
    if (!current) return
    const config = parseGrantConfig<StopWakeConfig>(current.config_json)
    // A newer stop recorded meanwhile keeps its own wake.
    if (config.pendingStopWake?.key !== pending.key) return
    const { pendingStopWake: _delivered, ...rest } = config
    store.updateConfig(grantId, rest)
  }

  private open(sessionId: string): SessionAgentRunState {
    let run = this.runs.get(sessionId)
    if (!run) {
      run = { interrupted: false }
      this.runs.set(sessionId, run)
    }
    return run
  }

  private clearStall(sessionId: string): void {
    if (this.stalls.delete(sessionId)) this.deps.clearStalled(sessionId)
  }
}

type StopWakeConfig = SessionAgentLaunchConfig & {
  /** Host-maintained: the parent wake for a stop, until the parent accepted it. */
  pendingStopWake?: { key: string; status: string }
}
