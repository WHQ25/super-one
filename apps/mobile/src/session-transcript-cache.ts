import { trimTranscriptForCache } from './transcript-cache-policy'
import type { CachedTranscript, CachedWindow } from '@superone/relay-client'
import { TRANSCRIPT_WINDOW_SCHEMA } from '@superone/shared/environment/transcript-window'
import { getFilePreviewCache } from './file-preview-cache-store'
import type { SessionTranscriptCache } from './runtime'

export type { CachedTranscript as CachedSessionTranscript }

export type { SessionTranscriptCache }

function sessionBlobKey(projectPath: string, sessionId: string): string {
  return `session-v1\0${projectPath}\0${sessionId}`
}

/** A window cache from another schema is a miss: its fragment keys and digests do not match the host's. */
function windowBlobKey(projectPath: string, sessionId: string): string {
  return `session-window-v1\0${projectPath}\0${sessionId}\0${TRANSCRIPT_WINDOW_SCHEMA}`
}

function decodeWindow(bytes: Uint8Array): CachedWindow | null {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as CachedWindow
    const window = parsed?.window
    if (parsed?.schema !== TRANSCRIPT_WINDOW_SCHEMA || !window || !Array.isArray(window.messages) || typeof window.total !== 'number'
      || window.messages.some(row => !row || typeof row.id !== 'string' || typeof row.metaDigest !== 'string' || !row.meta
        || !Array.isArray(row.fragments) || row.fragments.some(f => !f || typeof f.key !== 'string' || typeof f.digest !== 'string' || !f.body))) return null
    return parsed
  } catch {
    return null
  }
}

function encodeTranscript(transcript: CachedTranscript): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(transcript))
}

function decodeTranscript(bytes: Uint8Array): CachedTranscript | null {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as CachedTranscript
    if (!parsed || !Array.isArray(parsed.messages) || parsed.messages.length > 200
      || typeof parsed.hasMore !== 'boolean' || (parsed.cursor !== null && !Number.isSafeInteger(parsed.cursor))
      || parsed.messages.some(row => !row || typeof row.id !== 'string' || !Array.isArray(row.content) || (row.role !== 'user' && row.role !== 'assistant'))) return null
    return parsed
  } catch {
    return null
  }
}

export const sessionTranscriptCache: SessionTranscriptCache = {
  get(pairingId, projectPath, sessionId) {
    const bytes = getFilePreviewCache().lookupBlob(pairingId, sessionBlobKey(projectPath, sessionId))
    return bytes ? decodeTranscript(bytes) : null
  },
  put(pairingId, projectPath, sessionId, transcript) {
    const trimmed = trimTranscriptForCache(transcript)
    if (!trimmed) return
    try { getFilePreviewCache().putBlob(pairingId, sessionBlobKey(projectPath, sessionId), encodeTranscript(trimmed)) }
    catch { /* persistence is best-effort; the host remains authoritative */ }
  },
  getWindow(pairingId, projectPath, sessionId) {
    const bytes = getFilePreviewCache().lookupBlob(pairingId, windowBlobKey(projectPath, sessionId))
    return bytes ? decodeWindow(bytes) : null
  },
  putWindow(pairingId, projectPath, sessionId, window) {
    // Bodies, manifest and coverage go in one blob, so the cache never claims a body it lost.
    try { getFilePreviewCache().putBlob(pairingId, windowBlobKey(projectPath, sessionId), new TextEncoder().encode(JSON.stringify(window))) }
    catch { /* persistence is best-effort; the host remains authoritative */ }
  },
}
