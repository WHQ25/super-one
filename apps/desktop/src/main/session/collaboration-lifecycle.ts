/**
 * Spawn-child lifecycle as its parent and the human see it.
 *
 * Waking the parent costs tokens and waiting does not, so the only wake added
 * here is the fallback for a child that stopped without reporting: the parent
 * would otherwise wait forever. A child reports with session_collab_send, which
 * wakes the parent on its own. Stalls notify the human instead, and a run the
 * human stopped wakes nobody.
 */

import type { AgentEvent, AgentStatus, ChatMessage } from '@superone/shared/agent-types'
import { classifyAgentErrorText, isRateLimitErrorInfo } from '@superone/shared/agent-error'
import log from '../logger'
import { collaborationStore, spawnParentOf } from './collaboration-mailbox'
import { wakeParentOfStoppedChild } from './collaboration-host'
import type { Session, SessionManager } from './types'

/** Streaming with no agent event or user action for this long counts as a stall. */
export const CHILD_STALL_MS = 10 * 60_000
export const CHILD_STALL_CHECK_INTERVAL_MS = 60_000

export type CollaborationChildState = 'running' | 'awaiting_approval' | 'stalled' | 'idle' | 'error'

export interface CollaborationChildStatus {
  state: CollaborationChildState
  /** ISO time of the last agent event or user action; absent when the session is not loaded. */
  lastActivityAt?: string
  /** Top-level tool still waiting for its result. */
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

function liveState(session: Session, now: number): CollaborationChildState {
  const activity: AgentStatus = session.activityStatus()
  if (activity === 'idle' || activity === 'error') return activity
  if (session.getPendingInteractions().length > 0) return 'awaiting_approval'
  if (activity === 'streaming' && now - session.lastRuntimeActivityAt >= CHILD_STALL_MS) return 'stalled'
  return 'running'
}

/** What session_collab_retrieve reports for a child peer. A session not loaded in memory is idle. */
export function describeChildStatus(session: Session | null, now = Date.now()): CollaborationChildStatus {
  if (!session) return { state: 'idle' }
  const state = liveState(session, now)
  const lastActivityAt = new Date(session.lastRuntimeActivityAt).toISOString()
  if (state === 'idle' || state === 'error') return { state, lastActivityAt }
  const runningTool = runningToolName(session.snapshot.messages)
  return { state, lastActivityAt, ...(runningTool ? { runningTool } : {}) }
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

interface RunState {
  /** A human stopped this run; its end wakes nobody. */
  interrupted: boolean
  error?: string
}

export interface CollaborationChildMonitorDeps {
  host: SessionManager
  notifyStalled(sessionId: string): void
  clearStalled(sessionId: string): void
  now?: () => number
}

/**
 * Feeds on every live session event. A run opens on `streaming` / `background`
 * (or the first assistant message or error) and stops on the `idle` / `error`
 * that settles it, so a turn that ends with background tasks still running is
 * not a stop. Replayed events are ignored: they describe no new stop.
 */
export class CollaborationChildMonitor {
  private readonly runs = new Map<string, RunState>()
  /** sessionId → the activity time its stall was observed at; one notice per stall. */
  private readonly stalls = new Map<string, number>()
  private readonly now: () => number

  constructor(private readonly deps: CollaborationChildMonitorDeps) {
    this.now = deps.now ?? Date.now
  }

  handleEvent(sessionId: string, event: AgentEvent, replay: boolean): void {
    if (replay) return
    switch (event.type) {
      case 'status_change':
        if (event.status === 'streaming' || event.status === 'background') this.open(sessionId)
        else this.stop(sessionId, event.status)
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
    this.clearStallIfActive(sessionId)
  }

  /** Notify the human once per stall of a spawn child; never wakes the parent. */
  checkStalls(now = this.now()): void {
    for (const sessionId of this.runs.keys()) {
      const session = this.deps.host.getSession(sessionId)
      if (!session || liveState(session, now) !== 'stalled') continue
      const activityAt = session.lastRuntimeActivityAt
      if (this.stalls.get(sessionId) === activityAt) continue
      this.stalls.set(sessionId, activityAt)
      if (spawnParentOf(sessionId)) this.deps.notifyStalled(sessionId)
    }
  }

  private open(sessionId: string): RunState {
    let run = this.runs.get(sessionId)
    if (!run) {
      run = { interrupted: false }
      this.runs.set(sessionId, run)
    }
    return run
  }

  private stop(sessionId: string, status: Exclude<AgentStatus, 'streaming' | 'background'>): void {
    const run = this.runs.get(sessionId)
    this.runs.delete(sessionId)
    this.clearStall(sessionId)
    if (!run || run.interrupted) return
    const parentSessionId = spawnParentOf(sessionId)
    if (!parentSessionId) return
    const child = this.deps.host.getSession(sessionId)
    if (reportedSinceLastInput(sessionId, child?.snapshot.lastUserMessageAt ?? null)) return
    const label = status === 'error' && run.error ? `error: ${run.error}` : status
    log.info('[session-collaboration] child stopped without reporting sid=%s parent=%s status=%s', sessionId, parentSessionId, label)
    void wakeParentOfStoppedChild(this.deps.host, parentSessionId, sessionId, label)
  }

  private clearStallIfActive(sessionId: string): void {
    const stalledAt = this.stalls.get(sessionId)
    if (stalledAt === undefined) return
    const session = this.deps.host.getSession(sessionId)
    if (session && session.lastRuntimeActivityAt === stalledAt) return
    this.clearStall(sessionId)
  }

  private clearStall(sessionId: string): void {
    if (this.stalls.delete(sessionId)) this.deps.clearStalled(sessionId)
  }
}
