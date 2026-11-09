import type { AgentStatus } from '@superone/shared/agent-types'
import { spawnChildSessionIds } from '../db-sessions'

/**
 * A spawn child whose turn is still open. Idle and error are finished.
 * `streaming` and `background` are the live activity values; a pending
 * approval or an open voice call is the same turn waiting on the user.
 */
export interface ChildTurnView {
  activityStatus(): AgentStatus
  getPendingInteractions(): readonly unknown[]
  readonly realtimeActive?: boolean
}

export function childTurnIsOpen(view: ChildTurnView | null): boolean {
  if (!view) return false
  if (view.realtimeActive) return true
  const activity = view.activityStatus()
  if (activity === 'streaming' || activity === 'background') return true
  return view.getPendingInteractions().length > 0
}

/** A loaded session that can answer {@link childTurnIsOpen}, or null. */
export function asChildTurnView(session: unknown): ChildTurnView | null {
  if (!session || typeof session !== 'object') return null
  const view = session as Partial<ChildTurnView>
  if (typeof view.activityStatus !== 'function' || typeof view.getPendingInteractions !== 'function') return null
  return view as ChildTurnView
}

/**
 * Spawn children of `parentId` with an open turn. A child that is not loaded
 * here is asked via `remoteRunning` (a child on another machine). Unknown or
 * unreachable is not running.
 */
export async function runningSpawnChildIds(
  parentId: string,
  local: (childId: string) => ChildTurnView | null,
  remoteRunning: (childId: string) => Promise<boolean> = async () => false,
): Promise<string[]> {
  const running: string[] = []
  for (const childId of spawnChildSessionIds(parentId)) {
    const view = local(childId)
    if (view) {
      if (childTurnIsOpen(view)) running.push(childId)
      continue
    }
    if (await remoteRunning(childId)) running.push(childId)
  }
  return running
}

/** A spawn child on another machine, when this desktop can read its node. */
export async function remoteSpawnChildRunning(childId: string): Promise<boolean> {
  const { remoteChildState, remoteChildTarget } = await import('./collaboration-remote')
  if (!remoteChildTarget(childId)) return false
  const state = await remoteChildState(childId)
  if (!state) return false
  if (state.status === 'streaming' || state.status === 'background') return true
  return state.pendingInteraction != null
}
