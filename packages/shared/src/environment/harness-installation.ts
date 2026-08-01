/**
 * Node Harness installation catalog contracts (Phase 3 / design §13).
 *
 * Installation, administrator intent, authentication, and readiness are separate
 * facts. The descriptor's capabilities.harnessIds must only list enabled + ready
 * harnesses — never every adapter compiled into the node.
 *
 * Concrete Grok identity is `acp-grok`. Legacy session/wire id `acp` remains a
 * read alias until desktop session storage fully migrates.
 */

import type { HarnessId } from '../session-types'

/** First-party node Harness catalog IDs (target identities). */
export type NodeHarnessId = 'claude' | 'codex' | 'opencode' | 'acp-grok'

export type HarnessRuntimeSource = 'managed' | 'external'

export type HarnessInstallState =
  | 'disabled'
  | 'missing'
  | 'installing'
  | 'needs_auth'
  | 'ready'
  | 'incompatible'
  | 'error'

export interface HarnessInstallationStatus {
  id: NodeHarnessId
  runtimeSource: HarnessRuntimeSource
  enabled: boolean
  state: HarnessInstallState
  runtimeVersion?: string
  /** Absolute command path when non-sensitive and known. */
  command?: string
  requiresAuth: boolean
  diagnostic?: { code: string; message: string }
}

export interface NodeHarnessDefinition {
  id: NodeHarnessId
  runtimeSource: HarnessRuntimeSource
  requiresAuth: boolean
  /**
   * Session / capabilities.harnessIds wire id while desktop still uses legacy
   * `acp` for Grok. For all other harnesses this equals `id`.
   */
  sessionHarnessId: HarnessId
}

export const NODE_HARNESS_DEFINITIONS: readonly NodeHarnessDefinition[] = [
  { id: 'claude', runtimeSource: 'managed', requiresAuth: true, sessionHarnessId: 'claude' },
  { id: 'codex', runtimeSource: 'managed', requiresAuth: true, sessionHarnessId: 'codex' },
  { id: 'opencode', runtimeSource: 'external', requiresAuth: false, sessionHarnessId: 'opencode' },
  { id: 'acp-grok', runtimeSource: 'external', requiresAuth: false, sessionHarnessId: 'acp' },
] as const

export const NODE_HARNESS_IDS: readonly NodeHarnessId[] = NODE_HARNESS_DEFINITIONS.map((d) => d.id)

const DEFINITION_BY_ID = new Map(NODE_HARNESS_DEFINITIONS.map((d) => [d.id, d]))

export function isNodeHarnessId(value: unknown): value is NodeHarnessId {
  return (
    value === 'claude' || value === 'codex' || value === 'opencode' || value === 'acp-grok'
  )
}

export function getNodeHarnessDefinition(id: NodeHarnessId): NodeHarnessDefinition {
  const def = DEFINITION_BY_ID.get(id)
  if (!def) throw new Error(`unknown node harness: ${id}`)
  return def
}

/**
 * Map a session/wire harness id to the node catalog id.
 * `acp` is the legacy Grok alias; arbitrary custom ACP is not remapped beyond this.
 */
export function sessionHarnessIdToNodeHarnessId(sessionId: string): NodeHarnessId | null {
  if (sessionId === 'acp' || sessionId === 'acp-grok') return 'acp-grok'
  if (sessionId === 'claude' || sessionId === 'codex' || sessionId === 'opencode') {
    return sessionId
  }
  return null
}

export function nodeHarnessIdToSessionHarnessId(id: NodeHarnessId): HarnessId {
  return getNodeHarnessDefinition(id).sessionHarnessId
}

/**
 * Normalize a client-supplied harness id to the Stage 1 session wire id.
 * Accepts catalog id `acp-grok` and legacy `acp`; always returns `acp` for Grok.
 * Returns null for unknown values.
 */
export function normalizeSessionHarnessId(raw: string): HarnessId | null {
  const nodeId = sessionHarnessIdToNodeHarnessId(raw)
  if (!nodeId) return null
  return nodeHarnessIdToSessionHarnessId(nodeId)
}

/**
 * Allowlisted public diagnostic codes. Callers never supply free-form error
 * strings for status output — only these codes (plus optional validated fields).
 * Raw provider/subprocess errors must not be persisted or returned.
 */
export const HARNESS_DIAGNOSTIC_CODES = [
  'simulated',
  'missing',
  'installing',
  'needs_auth',
  'probe_failed',
  'incompatible',
  'permission_denied',
  'not_found',
  'error',
] as const

export type HarnessDiagnosticCode = (typeof HARNESS_DIAGNOSTIC_CODES)[number]

/** Authored, non-secret messages. Never embed raw provider output. */
export const HARNESS_DIAGNOSTIC_MESSAGES: Record<HarnessDiagnosticCode, string> = {
  simulated: 'simulated runner; not a real provider integration',
  missing: 'runtime artifact or external command is not installed',
  installing: 'runtime installation is in progress',
  needs_auth: 'provider authentication is required before this harness is ready',
  probe_failed: 'readiness probe failed',
  incompatible: 'runtime version or platform is incompatible',
  permission_denied: 'runtime path is not accessible to the node principal',
  not_found: 'configured command path was not found',
  error: 'harness configuration error',
}

/** Optional non-secret detail fields appendable to a diagnostic (validated). */
export interface HarnessDiagnosticFields {
  /** Semver-ish or short version label (no spaces). */
  runtimeVersion?: string
  /** Absolute path already accepted by sanitizeHarnessCommand. */
  command?: string
  /** Expected CLI-pinned version for managed harnesses. */
  expectedVersion?: string
  /** Observed version from a probe. */
  actualVersion?: string
}

export function isHarnessDiagnosticCode(value: unknown): value is HarnessDiagnosticCode {
  return (
    typeof value === 'string' &&
    (HARNESS_DIAGNOSTIC_CODES as readonly string[]).includes(value)
  )
}

/**
 * Build a public diagnostic from an allowlisted code + validated fields only.
 * Free-form provider error strings are never accepted.
 */
export function buildHarnessDiagnostic(
  code: HarnessDiagnosticCode,
  fields?: HarnessDiagnosticFields,
): { code: HarnessDiagnosticCode; message: string } {
  let message = HARNESS_DIAGNOSTIC_MESSAGES[code]
  const extras: string[] = []
  if (fields?.expectedVersion && isSafeVersionLabel(fields.expectedVersion)) {
    extras.push(`expected ${fields.expectedVersion}`)
  }
  if (fields?.actualVersion && isSafeVersionLabel(fields.actualVersion)) {
    extras.push(`actual ${fields.actualVersion}`)
  }
  if (fields?.runtimeVersion && isSafeVersionLabel(fields.runtimeVersion)) {
    extras.push(`version ${fields.runtimeVersion}`)
  }
  if (fields?.command) {
    const cmd = sanitizeHarnessCommand(fields.command)
    if (cmd) extras.push(`command ${cmd}`)
  }
  if (extras.length) {
    message = `${message} (${extras.join(', ')})`
  }
  // Defense in depth: never return text that still looks like a secret payload.
  return { code, message: redactHarnessDiagnosticText(message) }
}

function isSafeVersionLabel(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/.test(value)
}

/**
 * Redact secrets from diagnostic text. Defense in depth only — public
 * diagnostics must be built from allowlisted codes/templates, not raw errors.
 */
export function redactHarnessDiagnosticText(text: string): string {
  let m = text
  m = m.replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
  m = m.replace(/Basic\s+\S+/gi, 'Basic [REDACTED]')
  m = m.replace(
    /\b(password|passwd|token|secret|api[_-]?key|authorization|openai_api_key|anthropic_api_key)\b\s*[:=]\s*("([^"\\]|\\.)*"|'([^'\\]|\\.)*'|\S+)/gi,
    '$1=[REDACTED]',
  )
  // ENV-style KEY=value (including OPENAI_API_KEY=sk-...)
  m = m.replace(
    /\b[A-Z][A-Z0-9_]{2,}(_KEY|_TOKEN|_SECRET|_PASSWORD|_PASS)?\s*=\s*\S+/g,
    '[REDACTED_ENV]',
  )
  // URL userinfo: scheme://user:pass@host
  m = m.replace(/:\/\/[^/\s:@]+:[^@\s]+@/g, '://[REDACTED]@')
  // sk- / long base64-ish blobs
  m = m.replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]')
  m = m.replace(/\b[A-Za-z0-9_-]{40,}\b/g, '[REDACTED]')
  if (m.length > 200) m = `${m.slice(0, 200)}…`
  return m
}

/**
 * Allowlisted diagnostic codes only. Unknown values collapse to `error`.
 * Null/empty clears the diagnostic.
 */
export function sanitizeHarnessDiagnosticCode(
  code: string | null | undefined,
): HarnessDiagnosticCode | null {
  if (code == null || code === '') return null
  if (isHarnessDiagnosticCode(code)) return code
  return 'error'
}

/**
 * Public command paths must be absolute (Unix) and free of control characters.
 * Relative paths and env-style values are dropped rather than advertised.
 */
export function sanitizeHarnessCommand(command: string | null | undefined): string | undefined {
  if (command == null || command === '') return undefined
  if (!command.startsWith('/')) return undefined
  if (/[\0\n\r]/.test(command)) return undefined
  if (command.length > 512) return undefined
  return command
}

/** Only enabled + ready harnesses are runnable and may appear in the descriptor. */
export function isHarnessRunnable(status: Pick<HarnessInstallationStatus, 'enabled' | 'state'>): boolean {
  return status.enabled && status.state === 'ready'
}

/**
 * Build the descriptor harnessIds list from catalog statuses.
 * Order follows NODE_HARNESS_DEFINITIONS.
 */
export function readySessionHarnessIds(
  statuses: readonly HarnessInstallationStatus[],
): HarnessId[] {
  const byId = new Map(statuses.map((s) => [s.id, s]))
  const out: HarnessId[] = []
  for (const def of NODE_HARNESS_DEFINITIONS) {
    const status = byId.get(def.id)
    if (status && isHarnessRunnable(status)) {
      out.push(def.sessionHarnessId)
    }
  }
  return out
}

/** Default persisted shape when a harness has never been configured. */
export function defaultHarnessInstallationStatus(id: NodeHarnessId): HarnessInstallationStatus {
  const def = getNodeHarnessDefinition(id)
  return {
    id,
    runtimeSource: def.runtimeSource,
    enabled: false,
    state: 'disabled',
    requiresAuth: def.requiresAuth,
  }
}
