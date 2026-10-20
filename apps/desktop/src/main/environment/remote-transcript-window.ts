import type { AgentEvent } from '@superone/shared/agent-types'
import type { SessionLoadResult } from '@superone/shared/environment'
import {
  desktopWindowHolder,
  isUnservedMethod,
  type TranscriptWindowAnchor,
  type TranscriptWindowBudget,
  type TranscriptWindowRequest,
  type TranscriptWindowResult,
} from '@superone/shared/environment/transcript-window'
import { TranscriptWindowSync } from '@superone/shared/transcript-window/window-sync'
import {
  applyWindowResult,
  windowCoverage,
  windowLookup,
  type TranscriptWindowState,
} from '@superone/shared/transcript-window/window-store'

/**
 * A tall desktop transcript: about three wide screens, not the phone's one
 * short screen. Fold pages stay on DESKTOP_FOLD_BUDGET.
 */
export const DESKTOP_WINDOW_BUDGET: TranscriptWindowBudget = {
  maxBytes: 512 * 1024,
  maxFragments: 160,
  targetChars: 18_000,
}

/**
 * One page behind a fold: about two dozen tool rows, not the transcript
 * window. Opening Detail and each scroll down read another page.
 */
export const DESKTOP_FOLD_BUDGET: TranscriptWindowBudget = {
  maxBytes: 128 * 1024,
  maxFragments: 48,
  targetChars: 6_000,
}

export interface DesktopWindowOpen {
  sessionId: string
  anchor?: TranscriptWindowAnchor
  direction?: 'before' | 'after' | 'around'
}

type WindowCall = (request: TranscriptWindowRequest & { holder: string }) => Promise<TranscriptWindowResult>

/**
 * Read one remote session's window and fold it into the window main already
 * holds. A tail read keeps pages loaded earlier. Bodies the held window
 * already has are requested by coverage (`have`); a host that lost them is
 * read once more without that claim.
 */
export async function loadRemoteTranscriptWindow(
  call: WindowCall,
  held: TranscriptWindowSync | null,
  input: DesktopWindowOpen,
): Promise<{ snapshot: SessionLoadResult; held: TranscriptWindowSync }> {
  const placement = input.direction === 'before' ? 'older' : input.direction === 'after' ? 'newer' : 'replace'
  const request = (have: boolean): TranscriptWindowRequest & { holder: string } => ({
    sessionId: input.sessionId,
    holder: desktopWindowHolder(input.sessionId),
    budget: DESKTOP_WINDOW_BUDGET,
    includeState: !input.anchor,
    folds: true,
    ...(input.anchor ? { anchor: input.anchor, direction: input.direction } : {}),
    ...(have && held && held.current.messages.length ? { have: windowCoverage(held.current.messages) } : {}),
  })
  let result = await call(request(true))
  let applied = mergeDesktopWindow(held?.current ?? null, result, placement)
  if (applied.missing.length) {
    result = await call(request(false))
    applied = mergeDesktopWindow(null, result, 'replace')
  }
  if (applied.missing.length) throw new Error('Transcript window is missing bodies')
  // Keep the sync the fold pages were loaded into. A new one would drop them.
  const sync = held ?? new TranscriptWindowSync(applied.state)
  if (held) sync.replace(applied.state)
  return {
    held: sync,
    snapshot: {
      sessionId: result.sessionId,
      state: result.state ?? {},
      messages: sync.messages(),
      before: null,
      cursor: result.cursor,
      ...(result.restore ? { restore: result.restore } : {}),
      ...(result.summarized ? { summarized: true as const } : {}),
      transcriptWindow: { older: sync.current.older, newer: sync.current.newer, total: sync.current.total },
    },
  }
}

/** Window read, or `session.load` when this host does not serve the method. */
export async function readDesktopSessionWindow(args: {
  held: TranscriptWindowSync | null
  input: DesktopWindowOpen
  window: WindowCall
  load: () => Promise<SessionLoadResult>
}): Promise<{ snapshot: SessionLoadResult; held: TranscriptWindowSync | null; via: 'window' | 'load' }> {
  try {
    const loaded = await loadRemoteTranscriptWindow(args.window, args.held, args.input)
    return { snapshot: loaded.snapshot, held: loaded.held, via: 'window' }
  } catch (error) {
    if (!isUnservedMethod(error)) throw error
    return { snapshot: await args.load(), held: null, via: 'load' }
  }
}

/**
 * Apply one desktop window patch and return the rows the chat should paint.
 * Null when the patch no longer matches the held window: the caller reads it again.
 * The fragment bodies stay in main; the renderer receives the materialized rows.
 */
export function presentDesktopWindowPatch(
  sync: TranscriptWindowSync,
  event: Extract<AgentEvent, { type: 'transcript_window' }>,
): Extract<AgentEvent, { type: 'transcript_window' }> | null {
  const changed = new Set(event.patch.messages.map((message) => message.id))
  if (!sync.applyPatch(event.patch)) return null
  const edges = { older: sync.current.older, newer: sync.current.newer, total: sync.current.total }
  return {
    ...event,
    patch: {
      messages: [],
      total: edges.total,
      ...(event.patch.removed?.length ? { removed: event.patch.removed } : {}),
      ...(event.patch.order ? { order: event.patch.order } : {}),
    },
    rows: sync.messages().filter((message) => changed.has(message.id)),
    edges,
  }
}

function mergeDesktopWindow(
  held: TranscriptWindowState | null,
  result: Pick<TranscriptWindowResult, 'messages' | 'older' | 'newer' | 'total'>,
  placement: 'replace' | 'older' | 'newer',
): { state: TranscriptWindowState; missing: string[] } {
  const lookup = windowLookup(held)
  if (placement !== 'replace' || !held || held.newer !== null) return applyWindowResult(held, result, lookup, placement)
  const tail = applyWindowResult(null, result, lookup, 'replace')
  if (tail.missing.length) return tail
  const first = tail.state.messages[0]
  if (!first) return tail
  const cut = held.messages.findIndex((message) => message.id === first.id)
  if (cut > 0) {
    return { missing: [], state: { ...tail.state, messages: [...held.messages.slice(0, cut), ...tail.state.messages], older: held.older } }
  }
  if (cut < 0) {
    // Only an adjacent tail extends the held range. Across a gap, older history
    // pages back in from the new tail; joining would hide the rows in between.
    const last = held.messages[held.messages.length - 1]
    if (last && last.index + 1 === first.index) {
      return { missing: [], state: { ...tail.state, messages: [...held.messages, ...tail.state.messages], older: held.older } }
    }
  }
  return tail
}
