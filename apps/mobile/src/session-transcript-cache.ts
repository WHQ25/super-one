import { trimTranscriptForCache } from './transcript-cache-policy'
import type { CachedTranscript } from '@superone/relay-client'
import { getFilePreviewCache } from './file-preview-cache-store'
import type { SessionTranscriptCache } from './runtime'

export type { CachedTranscript as CachedSessionTranscript }

export type { SessionTranscriptCache }

function sessionBlobKey(projectPath: string, sessionId: string): string {
  return `session-v1\0${projectPath}\0${sessionId}`
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
}
