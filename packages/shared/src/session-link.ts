import type { SessionRef } from './environment/refs'

export const LOCAL_SESSION_ENVIRONMENT = 'localhost'

/** Parsed without URL.hostname: opaque environment IDs retain their case. */
export function parseSessionLink(href: string): SessionRef | null {
  const match = /^session:\/\/([^/?#]+)\/([^/?#]+)$/i.exec(href)
  if (!match) return null
  try {
    const [environmentId, sessionId] = match.slice(1).map(decodeURIComponent)
    if (![environmentId, sessionId].every(validId)) return null
    return { environmentId, sessionId }
  } catch { return null }
}

function validId(value: string): boolean {
  return typeof value === 'string' && value !== '.' && value !== '..' && value.length > 0 && value.length <= 256 && !/[\s\x00-\x1f\x7f/:@?#\\%]/.test(value)
}

export function isSessionLink(href: string): boolean {
  return /^session:/i.test(href)
}

export function buildSessionLink(ref: SessionRef): string {
  if (![ref.environmentId, ref.sessionId].every(validId)) throw new Error('Invalid session reference')
  const encode = (id: string) => encodeURIComponent(id).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
  return `session://${encode(ref.environmentId)}/${encode(ref.sessionId)}`
}

export function resolveSessionLink(ref: SessionRef, sourceEnvironmentId?: string | null): SessionRef | null {
  if (ref.environmentId !== LOCAL_SESSION_ENVIRONMENT) return ref
  return sourceEnvironmentId && sourceEnvironmentId !== LOCAL_SESSION_ENVIRONMENT
    ? { ...ref, environmentId: sourceEnvironmentId } : null
}

export function sessionLinkMarkdown(label: string, ref: SessionRef): string {
  return `[${label.replace(/[\\[\]`*_<>]/g, '\\$&').replace(/\s*\n\s*/g, ' ')}](${buildSessionLink(ref)})`
}

export interface SessionLinkMetadata {
  ref: SessionRef
  harness: string
  acpAgentId: string | null
  environmentLabel?: string
}

export type SessionLinkMetadataResult =
  | { status: 'ok'; metadata: SessionLinkMetadata }
  | { status: 'unavailable'; ref: SessionRef }

export interface SessionLinkTarget {
  ref: SessionRef
  connectionId: string | null
  projectPath: string
  title: string
  harness: string
  acpAgentId: string | null
}
