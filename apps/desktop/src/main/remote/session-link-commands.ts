import type { SessionRef } from '@superone/shared/environment'
import { buildSessionLink } from '@superone/shared/session-link'
import { getEnvironmentHost } from '../environment/environment-host'
import { resolveSessionLinkTarget, sessionLinkMetadata } from '../environment/session-links'

function sessionRef(value: unknown): SessionRef {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid session reference')
    const ref = value as SessionRef
    buildSessionLink(ref)
    return { environmentId: ref.environmentId, sessionId: ref.sessionId }
  } catch {
    throw Object.assign(new Error('Invalid session reference'), { code: 'invalid_argument' })
  }
}

export async function readPhoneEnvironments() {
  const items = await getEnvironmentHost().listEnvironments({ includeDescriptors: true })
  const local = items.find(item => item.kind === 'local')
  return { environmentId: local?.environmentId, environments: items }
}

export async function readPhoneSessionLinkMetadata(value: unknown) {
  if (!Array.isArray(value) || value.length > 50) throw Object.assign(new Error('At most 50 session references are allowed'), { code: 'invalid_argument' })
  return { metadata: await sessionLinkMetadata(value.map(sessionRef)) }
}

export async function readPhoneSessionLinkTarget(value: unknown) {
  return { target: await resolveSessionLinkTarget(sessionRef(value)) }
}
