/**
 * Scoped references for multi-environment routing.
 *
 * UI stores and gateways must never route by a bare project or Session ID —
 * every resource is qualified by the environment that owns it.
 */

export interface EnvironmentRef {
  environmentId: string
}

export interface ProjectRef {
  environmentId: string
  projectId: string
}

export interface SessionRef {
  environmentId: string
  sessionId: string
}

export interface TerminalRef {
  environmentId: string
  terminalId: string
}

export function environmentRef(environmentId: string): EnvironmentRef {
  return { environmentId }
}

export function projectRef(environmentId: string, projectId: string): ProjectRef {
  return { environmentId, projectId }
}

export function sessionRef(environmentId: string, sessionId: string): SessionRef {
  return { environmentId, sessionId }
}

export function terminalRef(environmentId: string, terminalId: string): TerminalRef {
  return { environmentId, terminalId }
}

/** Stable string key for maps / React keys. */
export function projectKey(ref: ProjectRef): string {
  return `${ref.environmentId}:${ref.projectId}`
}

export function sessionKey(ref: SessionRef): string {
  return `${ref.environmentId}:${ref.sessionId}`
}

export function terminalKey(ref: TerminalRef): string {
  return `${ref.environmentId}:${ref.terminalId}`
}

export function parseProjectKey(key: string): ProjectRef | null {
  const i = key.indexOf(':')
  if (i <= 0 || i === key.length - 1) return null
  return { environmentId: key.slice(0, i), projectId: key.slice(i + 1) }
}

export function parseSessionKey(key: string): SessionRef | null {
  const i = key.indexOf(':')
  if (i <= 0 || i === key.length - 1) return null
  return { environmentId: key.slice(0, i), sessionId: key.slice(i + 1) }
}

/**
 * Reject cross-environment misuse when a parent ref must match a child.
 * Returns an error message when mismatched, otherwise null.
 */
export function assertSameEnvironment(
  expected: EnvironmentRef,
  actual: EnvironmentRef,
  label = 'resource',
): string | null {
  if (expected.environmentId !== actual.environmentId) {
    return `${label} environment mismatch: expected ${expected.environmentId}, got ${actual.environmentId}`
  }
  return null
}
