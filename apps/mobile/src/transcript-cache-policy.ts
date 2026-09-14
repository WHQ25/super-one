import { dropIncompleteTail, type CachedTranscript } from '@superone/relay-client'

export const TRANSCRIPT_CACHE_MESSAGES = 200
export const TRANSCRIPT_CACHE_BYTES = 8 * 1024 * 1024

/** Persist a contiguous suffix and move its older-page cursor by exactly the trim. */
export function trimTranscriptForCache(transcript: CachedTranscript): CachedTranscript | null {
  if (transcript.hasMore && (transcript.cursor == null || !Number.isSafeInteger(transcript.cursor) || transcript.cursor < 0)) return null
  const messages = dropIncompleteTail(transcript.messages)
  const base = transcript.hasMore ? transcript.cursor! : 0
  const suffix = (start: number): CachedTranscript => ({
    ...transcript, messages: messages.slice(start),
    hasMore: transcript.hasMore || start > 0,
    cursor: transcript.hasMore || start > 0 ? base + start : null,
  })
  let low = Math.max(0, messages.length - TRANSCRIPT_CACHE_MESSAGES), high = messages.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (new TextEncoder().encode(JSON.stringify(suffix(middle))).length > TRANSCRIPT_CACHE_BYTES) low = middle + 1
    else high = middle
  }
  return low === messages.length && messages.length > 0 ? null : suffix(low)
}
