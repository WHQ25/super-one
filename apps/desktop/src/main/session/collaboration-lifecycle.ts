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
import type { Session, SessionManager } from './types'

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
  /** Grants whose stop wake is being sent now. */
  private readonly delivering = new Set<string>()
  private readonly now: () => number

  constructor(private readonly deps: CollaborationChildMonitorDeps) {
    this.now = deps.now ?? Date.now
  }

  /**
   * `stopKey` is the node event sequence of a remote child's event: it names
   * a stop durably and orders a new run after it. Local stops get a fresh key.
   */
  handleEvent(sessionId: string, event: AgentEvent, replay: boolean, stopKey?: string): void {
    if (replay) return
    observedEventAt.set(sessionId, this.now())
    const hadRun = this.runs.has(sessionId)
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
    // A new run supersedes the last stop: its wake is moot.
    if (!hadRun && this.runs.has(sessionId)) clearStopWakeOfChild(sessionId, stopKey)
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
   * description). A child that stopped without reporting wakes its parent.
   * The wake stays recorded on the grant until the parent observes the stop
   * (see {@link acknowledgeStoppedChild}) or the child runs again, and is sent
   * again while the parent sits idle: a wake may repeat, it is never lost.
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
    const config = parseGrantConfig<StopWakeConfig>(grant.config_json)
    // A replayed stop (same key) was recorded and sent already.
    if (config.pendingStopWake?.key === stopKey) return
    log.info('[session-collaboration] child stopped without reporting sid=%s parent=%s status=%s', sessionId, grant.parent_session_id, label)
    collaborationStore().updateConfig(grant.grant_id, {
      ...config,
      pendingStopWake: { key: stopKey, status: label, lastAttemptAt: this.now() },
    })
    // After the caller's transaction (if any) commits.
    queueMicrotask(() => void this.sendStopWake(grant.grant_id, stopKey))
  }

  /**
   * Send again every recorded stop wake whose parent sits idle (no turn
   * running or queued) and whose last attempt is at least `intervalMs` old.
   */
  async resendStopWakes(intervalMs = CHILD_STALL_CHECK_INTERVAL_MS, now = this.now()): Promise<void> {
    const store = collaborationStore()
    await Promise.all(store.startedSpawnGrants().map(async (grant) => {
      const config = parseGrantConfig<StopWakeConfig>(grant.config_json)
      const pending = config.pendingStopWake
      if (!pending || now - pending.lastAttemptAt < intervalMs || this.delivering.has(grant.grant_id)) return
      if (!parentIsIdle(this.deps.host.getSession(grant.parent_session_id))) return
      // Recorded before the attempt, for this stop only.
      store.updateConfig(grant.grant_id, { ...config, pendingStopWake: { ...pending, lastAttemptAt: now } })
      await this.sendStopWake(grant.grant_id, pending.key)
    }))
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

  private async sendStopWake(grantId: string, key: string): Promise<void> {
    if (this.delivering.has(grantId)) return
    const grant = collaborationStore().grantById(grantId)
    const pending = grant && parseGrantConfig<StopWakeConfig>(grant.config_json).pendingStopWake
    if (!grant?.child_session_id || pending?.key !== key) return
    this.delivering.add(grantId)
    try {
      await wakeParentOfStoppedChild(this.deps.host, grant.parent_session_id, grant.child_session_id, pending.status)
    } finally {
      this.delivering.delete(grantId)
    }
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
  /**
   * Host-maintained: the parent wake for the child's last stop, until the
   * parent observed it. `key` names the stop; `lastAttemptAt` is in ms.
   */
  pendingStopWake?: { key: string; status: string; lastAttemptAt: number }
}

/**
 * No turn running or queued and no prompt awaiting the human: a wake sent
 * now starts a turn rather than waiting in a harness queue.
 */
function parentIsIdle(parent: Session | null): boolean {
  if (!parent) return true
  const activity = parent.activityStatus()
  return (activity === 'idle' || activity === 'error')
    && parent.getQueuedMessagesEvent() === null
    && parent.getPendingInteractions().length === 0
}

/** Clear the grant's stop wake if it is still the one for `key`; a newer stop keeps its own. */
function clearStopWake(grantId: string, key?: string): void {
  const store = collaborationStore()
  const grant = store.grantById(grantId)
  if (!grant) return
  const config = parseGrantConfig<StopWakeConfig>(grant.config_json)
  if (!config.pendingStopWake || (key !== undefined && config.pendingStopWake.key !== key)) return
  const { pendingStopWake: _observed, ...rest } = config
  store.updateConfig(grantId, rest)
}

/** True when the event at `eventKey` comes after the stop at `stopKey` (both node sequences). */
function isAfterStop(eventKey: string | undefined, stopKey: string): boolean {
  if (eventKey === undefined || !/^\d+$/.test(eventKey) || !/^\d+$/.test(stopKey)) return true
  return BigInt(eventKey) > BigInt(stopKey)
}

/** A new run of the child supersedes its last stop; `eventKey` is the node sequence that opened it. */
function clearStopWakeOfChild(childSessionId: string, eventKey: string | undefined): void {
  const grant = collaborationStore().spawnGrantForChild(childSessionId)
  const pending = grant && parseGrantConfig<StopWakeConfig>(grant.config_json).pendingStopWake
  if (pending && isAfterStop(eventKey, pending.key)) clearStopWake(grant.grant_id, pending.key)
}

/** Key of the child's stop wake the parent has not observed yet; null when none. */
export function pendingStopKey(childSessionId: string): string | null {
  const grant = collaborationStore().spawnGrantForChild(childSessionId)
  return (grant && parseGrantConfig<StopWakeConfig>(grant.config_json).pendingStopWake?.key) ?? null
}

/**
 * The parent saw its child stopped: a successful `session_collab_retrieve`
 * reported it idle or in error. Clears the stop wake `key` read before that
 * state was looked up, so a stop recorded meanwhile keeps its wake.
 */
export function acknowledgeStoppedChild(
  parentSessionId: string,
  childSessionId: string,
  state: CollaborationChildState,
  key: string | null,
): void {
  if (!key || (state !== 'idle' && state !== 'error')) return
  const grant = collaborationStore().spawnGrantForChild(childSessionId)
  if (grant?.parent_session_id === parentSessionId) clearStopWake(grant.grant_id, key)
}
