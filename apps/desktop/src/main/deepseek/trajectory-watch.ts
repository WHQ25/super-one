/**
 * Telling an open trajectory panel that its session log moved.
 *
 * The panel cannot listen to the agent event stream for this. That stream is a
 * projection built for the chat transcript, and the records a trajectory exists
 * to show — the prompt snapshot and its diff, injected context, a preset
 * selection, an approval and its outcome — produce no agent event at all. A
 * panel driven by it would sit still through an approval wait and miss a preset
 * switch made between turns entirely.
 *
 * So the signal is taken from the log itself, and it is only a signal: what
 * changed stays a question each panel asks with its own cursor, which keeps two
 * panels on one session independent of each other.
 */

import type { WebContents } from 'electron'
import { AgentIpcChannels } from '@superone/shared/agent-types'
import log from '../logger'
import { deepseekTrajectorySource } from './trajectory-source'

/**
 * How long events are collected before watchers are told.
 *
 * A streaming turn appends events faster than any panel can redraw, and the
 * answer to "what changed" is cumulative — one notification after a quiet
 * moment costs the same read as ten during it.
 */
const NOTIFY_THROTTLE_MS = 120

/** One panel watching one session. */
interface Watch {
  wc: WebContents
  /** The SuperOne session id the renderer addresses this panel by. */
  sessionId: string
}

const watches = new Map<string, Watch[]>()
const pending = new Map<string, ReturnType<typeof setTimeout>>()
let disposeListener: (() => void) | null = null

/** Notify every live watcher of one session, dropping the ones that went away. */
function notify(dshSessionId: string): void {
  const current = watches.get(dshSessionId)
  if (current === undefined) return
  const alive = current.filter((watch) => !watch.wc.isDestroyed())
  if (alive.length === 0) {
    watches.delete(dshSessionId)
    return
  }
  watches.set(dshSessionId, alive)
  for (const watch of alive) {
    watch.wc.send(AgentIpcChannels.DEEPSEEK_TRAJECTORY_CHANGED, watch.sessionId)
  }
}

/** Attach to the runtime once, for as long as anything is watching. */
async function ensureListener(): Promise<void> {
  if (disposeListener !== null) return
  const { getDeepseekRuntime } = await import('./deepseek-runtime-host')
  const runtime = await getDeepseekRuntime()
  disposeListener = runtime.onLogEvent((dshSessionId) => {
    if (!watches.has(dshSessionId)) return
    if (pending.has(dshSessionId)) return
    pending.set(dshSessionId, setTimeout(() => {
      pending.delete(dshSessionId)
      notify(dshSessionId)
    }, NOTIFY_THROTTLE_MS))
  })
}

/**
 * Start or stop watching one session's log on behalf of one panel.
 * @param wc - the renderer that owns the panel.
 * @param sessionId - the SuperOne session the panel is showing.
 * @param watching - whether the panel is open.
 */
export async function setTrajectoryWatch(
  wc: WebContents,
  sessionId: string,
  watching: boolean,
): Promise<void> {
  let dshSessionId: string
  try {
    ({ dshSessionId } = await deepseekTrajectorySource(sessionId))
  } catch (error) {
    // A runtime that cannot boot is already reported by the read itself; a
    // failed watch only costs live updates, so it stays quiet here.
    log.warn('[DEEPSEEK_TRAJECTORY_WATCH] %s failed: %s', sessionId, String(error))
    return
  }

  const current = watches.get(dshSessionId) ?? []
  const without = current.filter((watch) => watch.wc !== wc || watch.sessionId !== sessionId)
  if (!watching) {
    if (without.length === 0) watches.delete(dshSessionId)
    else watches.set(dshSessionId, without)
    return
  }

  watches.set(dshSessionId, [...without, { wc, sessionId }])
  await ensureListener()
}

/** Drop every watch, e.g. when the runtime is disposed. */
export function clearTrajectoryWatches(): void {
  for (const timer of pending.values()) clearTimeout(timer)
  pending.clear()
  watches.clear()
  disposeListener?.()
  disposeListener = null
}
