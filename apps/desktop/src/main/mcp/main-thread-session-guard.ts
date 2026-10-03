/**
 * Grok/ACP spawn_subagent inherits the parent's SuperOne MCP connection.
 * Those calls never carry agentID and often skip session/request_permission
 * (same stdio helper, same SuperOne session), and the MCP `tools/call` itself
 * names no caller. While an ACP subagent is live, a main-thread-only tool runs
 * only if the parent announced that exact call: Grok streams every parent tool
 * call on the parent ACP session before it executes, while a child's calls
 * stream on the child session id, which the host never routes into the parent
 * stream. Each announced call is a single-use credit for one MCP call of the
 * same tool.
 */

import { isMainThreadOnlySuperoneTool, superoneBareToolName } from '@superone/shared/superone-host-owned-tools'

const IGNORE_TASK_TYPES = new Set(['goal', 'workflow', 'monitor'])

const liveSubagents = new Map<string, Set<string>>()

interface ParentCall {
  tool: string
  until: number
  spent: boolean
}

/** sessionId → parent toolCallId → credit. Spent ids stay so later updates of the call cannot re-credit it. */
const parentCalls = new Map<string, Map<string, ParentCall>>()
const parentCallWaiters = new Map<string, Set<() => void>>()

/** Covers the gap between the streamed tool call and its MCP request (including a permission round trip). */
const PARENT_CALL_TTL_MS = 60_000
/** The MCP request travels a different pipe than the ACP stream, so it can arrive first. */
export const PARENT_CALL_WAIT_MS = 1_000

export function noteLiveAcpSubagent(sessionId: string, subagentId: string, live: boolean): void {
  if (!sessionId || !subagentId) return
  let set = liveSubagents.get(sessionId)
  if (live) {
    if (!set) {
      set = new Set()
      liveSubagents.set(sessionId, set)
    }
    set.add(subagentId)
    return
  }
  if (!set) return
  set.delete(subagentId)
  if (set.size === 0) liveSubagents.delete(sessionId)
}

export function noteAcpTaskLifecycle(
  sessionId: string,
  event: { type: string; taskId?: string; taskType?: string; taskStatus?: string },
): void {
  const taskId = event.taskId
  if (!sessionId || !taskId) return
  if (event.taskType && IGNORE_TASK_TYPES.has(event.taskType)) return
  if (event.type === 'task_started') {
    noteLiveAcpSubagent(sessionId, taskId, true)
    return
  }
  if (event.type === 'task_notification') {
    const status = event.taskStatus
    if (status === 'completed' || status === 'stopped' || status === 'failed') {
      noteLiveAcpSubagent(sessionId, taskId, false)
    }
  }
}

/** Record a main-thread-only tool call the parent ACP session announced. Repeats of one call id refresh it. */
export function noteParentMainThreadCall(
  sessionId: string,
  toolCallId: string,
  toolName: string,
  now = Date.now(),
): void {
  if (!sessionId || !toolCallId || !isMainThreadOnlySuperoneTool(toolName)) return
  let calls = parentCalls.get(sessionId)
  if (!calls) {
    calls = new Map()
    parentCalls.set(sessionId, calls)
  }
  const existing = calls.get(toolCallId)
  if (existing) {
    if (!existing.spent) existing.until = now + PARENT_CALL_TTL_MS
    return
  }
  calls.set(toolCallId, { tool: superoneBareToolName(toolName), until: now + PARENT_CALL_TTL_MS, spent: false })
  const waiters = parentCallWaiters.get(sessionId)
  if (waiters) for (const wake of [...waiters]) wake()
}

function spendParentCall(sessionId: string, tool: string, now: number): boolean {
  const calls = parentCalls.get(sessionId)
  if (!calls) return false
  for (const call of calls.values()) {
    if (!call.spent && call.tool === tool && now <= call.until) {
      call.spent = true
      return true
    }
  }
  return false
}

function nextParentCall(sessionId: string, ms: number): Promise<void> {
  return new Promise((resolve) => {
    let waiters = parentCallWaiters.get(sessionId)
    if (!waiters) {
      waiters = new Set()
      parentCallWaiters.set(sessionId, waiters)
    }
    const set = waiters
    const wake = () => {
      clearTimeout(timer)
      set.delete(wake)
      if (set.size === 0 && parentCallWaiters.get(sessionId) === set) parentCallWaiters.delete(sessionId)
      resolve()
    }
    const timer = setTimeout(wake, ms)
    set.add(wake)
  })
}

export function clearMainThreadSessionGuard(sessionId: string): void {
  liveSubagents.delete(sessionId)
  parentCalls.delete(sessionId)
}

export function liveAcpSubagentCount(sessionId: string): number {
  return liveSubagents.get(sessionId)?.size ?? 0
}

export function mainThreadDenyMessage(toolName: string): string {
  const bare = superoneBareToolName(toolName)
  return (
    `Denied: ${bare} can only be called from the main thread. ` +
    'You are running inside a subagent (Task/Agent worker) and must not retry this call.'
  )
}

/**
 * Null = allowed. String = deny message for the model. Always spends a
 * matching parent credit first, so one the parent left unspent cannot be
 * picked up by a subagent started later.
 */
export async function denyMainThreadOnlyIfSubagent(
  sessionId: string,
  toolName: string,
): Promise<string | null> {
  if (!isMainThreadOnlySuperoneTool(toolName)) return null
  const tool = superoneBareToolName(toolName)
  const deadline = Date.now() + PARENT_CALL_WAIT_MS
  for (;;) {
    const now = Date.now()
    if (spendParentCall(sessionId, tool, now)) return null
    if (liveAcpSubagentCount(sessionId) === 0) return null
    if (now >= deadline) return mainThreadDenyMessage(toolName)
    await nextParentCall(sessionId, deadline - now)
  }
}

export function _resetMainThreadSessionGuardForTests(): void {
  liveSubagents.clear()
  parentCalls.clear()
}
