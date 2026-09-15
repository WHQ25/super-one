import type { TerminalSession } from './terminal-session'

/** Conditions AND-combine; at least one must be set. */
export interface TerminalWaitConditions {
  /** Substring visible on screen or in recent scrollback. */
  text?: string
  /** Substring that must be absent from the screen. */
  textGone?: string
  /** No PTY output for this long. */
  idleMs?: number
  /** The agent-controlled foreground command has exited (or the PTY has). */
  exited?: boolean
}

export interface TerminalWaitOptions {
  timeoutMs: number
  pollMs?: number
  signal?: AbortSignal
  now?: () => number
}

export interface TerminalWaitResult {
  met: boolean
  /** Which conditions held at the moment the wait ended. */
  conditions: { text?: boolean; textGone?: boolean; idle?: boolean; exited?: boolean }
  elapsedMs: number
}

/** How far back `text` is searched — recent log output, not just the viewport. */
const TEXT_SEARCH_LINES = 500

export function hasWaitCondition(c: TerminalWaitConditions): boolean {
  return c.text !== undefined || c.textGone !== undefined || c.idleMs !== undefined || c.exited === true
}

export async function evaluateWaitConditions(
  session: TerminalSession,
  c: TerminalWaitConditions,
  now: number,
): Promise<TerminalWaitResult['conditions']> {
  const out: TerminalWaitResult['conditions'] = {}
  if (c.text !== undefined || c.textGone !== undefined) {
    const { lines } = await session.bufferTail(TEXT_SEARCH_LINES)
    const recent = lines.join('\n')
    if (c.text !== undefined) out.text = recent.includes(c.text)
    if (c.textGone !== undefined) {
      const screen = await session.screenLines()
      out.textGone = !screen.join('\n').includes(c.textGone)
    }
  }
  // A tab that has not printed anything yet is starting, not idle: a fresh login
  // shell must draw its prompt before "quiet for N ms" means anything.
  if (c.idleMs !== undefined) out.idle = session.lastOutputAt > 0 && now - session.lastOutputAt >= c.idleMs
  if (c.exited) out.exited = session.status !== 'running' || !session.control.commandRunning
  return out
}

function allMet(c: TerminalWaitConditions, r: TerminalWaitResult['conditions']): boolean {
  if (c.text !== undefined && !r.text) return false
  if (c.textGone !== undefined && !r.textGone) return false
  if (c.idleMs !== undefined && !r.idle) return false
  if (c.exited && !r.exited) return false
  return true
}

/**
 * Poll the rendered terminal until every condition holds, the timeout passes, or
 * the turn is aborted. Polling (not output events) keeps `idleMs` and `exited`
 * — which are the *absence* of events — on the same code path as `text`.
 */
export async function waitForTerminal(
  session: TerminalSession,
  conditions: TerminalWaitConditions,
  opts: TerminalWaitOptions,
): Promise<TerminalWaitResult> {
  const now = opts.now ?? Date.now
  const pollMs = opts.pollMs ?? 100
  const startedAt = now()
  for (;;) {
    const t = now()
    const result = await evaluateWaitConditions(session, conditions, t)
    if (allMet(conditions, result)) return { met: true, conditions: result, elapsedMs: t - startedAt }
    if (t - startedAt >= opts.timeoutMs || opts.signal?.aborted || session.status !== 'running') {
      return { met: false, conditions: result, elapsedMs: t - startedAt }
    }
    await new Promise<void>((resolve) => setTimeout(resolve, pollMs))
  }
}
