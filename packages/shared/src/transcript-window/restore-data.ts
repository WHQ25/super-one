import type { TranscriptWindowResult } from '../environment/transcript-window'
import type { SessionRestoreFacts } from '../environment/session-messages'
import { contentDigest, utf8Length } from './content-digest'

/** Voice history and App context are required by the visible UI and the composer, even outside the loaded rows. */
type RestoreData = {
  contexts?: SessionRestoreFacts['mcpAppContexts']
  thread?: SessionRestoreFacts['realtimeThreadMessages']
  segments?: unknown[]
}

const MAX_RESTORE_BYTES = 2 * 1024 * 1024

function restoreData(window: TranscriptWindowResult): RestoreData | null {
  const contexts = window.restore?.mcpAppContexts
  const thread = window.restore?.realtimeThreadMessages
  const segments = window.state?.realtimeSegments
  if (!contexts?.length && !thread?.length && !(Array.isArray(segments) && segments.length)) return null
  return { contexts, thread, ...(Array.isArray(segments) ? { segments } : {}) }
}

/** Change identity when a host restarts, even if two projections happen to serialize alike. */
function revision(window: TranscriptWindowResult, json: string): string {
  return contentDigest(JSON.stringify([window.sessionId, window.cursor.epoch]) + json)
}

export type HeldRestoreData = { revision: string; sessionId: string; epoch: string; data: RestoreData }

/** Keep only bounded, useful projections, independently of cached transcript fragments. */
export function holdRestoreData(window: TranscriptWindowResult): HeldRestoreData | undefined {
  const data = restoreData(window)
  if (!data) return
  const json = JSON.stringify(data)
  if (json.length < 256 || json.length > MAX_RESTORE_BYTES || utf8Length(json) > MAX_RESTORE_BYTES) return
  return { revision: revision(window, json), sessionId: window.sessionId, epoch: window.cursor.epoch, data }
}

/** Apply after the final reader-specific projection on each hop. */
export function omitHeldRestoreData(window: TranscriptWindowResult, have: unknown): TranscriptWindowResult {
  if (typeof have !== 'string' || have.length !== 14) return window
  if (holdRestoreData(window)?.revision !== have) return window
  return {
    ...window, reusedRestore: have,
    ...(window.state ? { state: { ...window.state, realtimeSegments: undefined } } : {}),
    ...(window.restore ? { restore: { ...window.restore, mcpAppContexts: [], realtimeThreadMessages: undefined } } : {}),
  }
}

/** The caller retains the exact immutable baseline advertised by this request until its reply arrives. */
export function restoreHeldData(window: TranscriptWindowResult, held: HeldRestoreData | undefined): TranscriptWindowResult {
  if (!window.reusedRestore) return window
  if (held?.revision !== window.reusedRestore || held.sessionId !== window.sessionId || held.epoch !== window.cursor.epoch) {
    throw new Error('Missing baseline for session restore data')
  }
  const { reusedRestore: _revision, ...full } = window
  const { contexts, thread, segments } = held.data
  return {
    ...full,
    ...(full.state && segments ? { state: { ...full.state, realtimeSegments: segments } } : {}),
    ...(full.restore ? { restore: { ...full.restore, mcpAppContexts: contexts ?? [], ...(thread ? { realtimeThreadMessages: thread } : {}) } } : {}),
  }
}

/** A small LRU per authenticated reader/environment route, with a fixed ceiling per entry. */
export class WindowRestoreCache {
  private readonly sessions = new Map<string, HeldRestoreData>()

  view(environmentId: string, sessionId: string) {
    const key = JSON.stringify([environmentId, sessionId])
    const held = this.sessions.get(key)
    return {
      revision: held?.revision,
      read: (result: TranscriptWindowResult) => {
        if (result.sessionId !== sessionId) throw new Error('Session restore target changed')
        return restoreHeldData(result, held)
      },
      remember: (result: TranscriptWindowResult) => {
        if (result.state === undefined && !result.restore) return
        const next = result.reusedRestore ? held : holdRestoreData(result)
        this.sessions.delete(key)
        if (next) this.sessions.set(key, next)
        if (this.sessions.size > 4) this.sessions.delete(this.sessions.keys().next().value!)
      },
    }
  }
}
