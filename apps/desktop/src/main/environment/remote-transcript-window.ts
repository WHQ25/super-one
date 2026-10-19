import type { SessionLoadResult } from '@superone/shared/environment'
import {
  desktopWindowHolder,
  isUnservedMethod,
  type TranscriptWindowAnchor,
  type TranscriptWindowBudget,
  type TranscriptWindowRequest,
  type TranscriptWindowResult,
} from '@superone/shared/environment/transcript-window'
import { MAX_WINDOW_BYTES } from '@superone/shared/transcript-window/select-window'
import { TranscriptWindowSync } from '@superone/shared/transcript-window/window-sync'
import {
  applyWindowResult,
  windowCoverage,
  windowLookup,
  type TranscriptWindowState,
} from '@superone/shared/transcript-window/window-store'

/** The server's ceiling. Ordinary turns stay whole; a longer transcript pages. */
export const DESKTOP_WINDOW_BUDGET: TranscriptWindowBudget = {
  maxBytes: MAX_WINDOW_BYTES,
  maxFragments: 256,
  targetChars: 80_000,
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
  const sync = new TranscriptWindowSync(applied.state)
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
