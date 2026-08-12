/**
 * Grok/ACP spawn_subagent inherits the parent's SuperOne MCP connection.
 * Those calls never carry agentID and often skip session/request_permission
 * (same stdio helper, same SuperOne session). Track live ACP subagents and
 * only allow session_tag / session_rename while a parent grant is in flight.
 */

import { isMainThreadOnlySuperoneTool, superoneBareToolName } from '@superone/shared/superone-host-owned-tools'

const IGNORE_TASK_TYPES = new Set(['goal', 'workflow', 'monitor'])

const liveSubagents = new Map<string, Set<string>>()
/** sessionId → epoch ms until which a parent main-thread call is expected. */
const parentGrantUntil = new Map<string, number>()

const PARENT_GRANT_TTL_MS = 20_000

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

export function grantParentMainThreadCall(sessionId: string, now = Date.now()): void {
  if (!sessionId) return
  parentGrantUntil.set(sessionId, now + PARENT_GRANT_TTL_MS)
}

export function clearMainThreadSessionGuard(sessionId: string): void {
  liveSubagents.delete(sessionId)
  parentGrantUntil.delete(sessionId)
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

/** Null = allowed. String = deny message for the model. */
export function denyMainThreadOnlyIfSubagent(
  sessionId: string,
  toolName: string,
  now = Date.now(),
): string | null {
  if (!isMainThreadOnlySuperoneTool(toolName)) return null
  const live = liveAcpSubagentCount(sessionId)
  if (live <= 0) return null
  const until = parentGrantUntil.get(sessionId) ?? 0
  if (now <= until) return null
  return mainThreadDenyMessage(toolName)
}

export function _resetMainThreadSessionGuardForTests(): void {
  liveSubagents.clear()
  parentGrantUntil.clear()
}
