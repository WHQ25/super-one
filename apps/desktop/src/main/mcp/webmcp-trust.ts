/**
 * Site-level trust for WebMCP page tools.
 *
 * There are two separate questions when an agent wants to use a page's tools, and they belong to
 * different owners:
 *
 *   1. "Do I trust this website to offer tools to my agent at all?" — a decision about a third
 *      party the user did not write, made once per site. That is this module, and it is enforced
 *      by the host: no harness permission mode can answer it.
 *   2. "Should this particular call run?" — ordinary tool-call approval, already solved by every
 *      harness. `browser_tools_call` is deliberately left out of the host-owned auto-allow list
 *      so it flows through that existing machinery instead of growing a second one here.
 *
 * Because harness-level "always allow" is keyed on the tool *name*, approving
 * `browser_tools_call` once covers every page tool on every site — which is exactly why (1) has
 * to stay mandatory. Site trust is the only place the origin is still visible.
 */

import { createHash } from 'crypto'
import type { WebmcpTrustedOrigin } from '@superone/shared/agent-types'
import { readAppSettings, saveAppSettings } from '../app-settings-service'

export type WebMcpTrustScope = 'session' | 'always'

export type WebMcpTrustState =
  /** The site is trusted and every tool matches the body it had then. */
  | { status: 'trusted' }
  /** Trusted, but a tool was re-registered with a different body — re-ask. */
  | { status: 'changed'; changedTools: string[] }
  /** Never decided for this site. */
  | { status: 'undecided' }
  /** The user said no in this chat; do not ask again for the rest of it. */
  | { status: 'denied' }

export interface WebMcpToolBody {
  name: string
  description: string
  inputSchema: string
}

/**
 * Identity of a tool *body*. The name is excluded on purpose — it is the map key, and folding it
 * in would make every fingerprint trivially unique.
 */
export function webMcpToolFingerprint(description: string, inputSchema: string): string {
  return createHash('sha256')
    .update(description)
    .update(' ')
    .update(inputSchema)
    .digest('hex')
    .slice(0, 32)
}

function fingerprintsOf(tools: WebMcpToolBody[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const tool of tools) out[tool.name] = webMcpToolFingerprint(tool.description, tool.inputSchema)
  return out
}

/** origin -> toolName -> fingerprint, as recorded when the user trusted the site. */
const persistedTrust = new Map<string, Record<string, string>>()
/** chat sessionId -> origin -> fingerprints, for "trust in this chat only". */
const sessionTrust = new Map<string, Map<string, Record<string, string>>>()
/** chat sessionId -> origins the user declined in that chat. */
const sessionDenied = new Map<string, Set<string>>()
const pendingWrites = new Map<string, Promise<void>>()

export function clearWebMcpTrustForTests(): void {
  persistedTrust.clear()
  sessionTrust.clear()
  sessionDenied.clear()
  pendingWrites.clear()
}

/**
 * Re-read the persisted trust list. Called at startup and after any settings patch, so revoking
 * a site in Settings takes effect on the very next tool call.
 */
export function syncWebMcpTrustFromSettings(): void {
  try {
    const origins = readAppSettings().webmcpTrustedOrigins
    persistedTrust.clear()
    for (const entry of origins) persistedTrust.set(entry.origin, { ...entry.tools })
  } catch {
    // Keep the current in-memory policy when settings are temporarily unreadable.
  }
}

function recordedFor(sessionId: string, origin: string): Record<string, string> | undefined {
  return sessionTrust.get(sessionId)?.get(origin) ?? persistedTrust.get(origin)
}

export function checkWebMcpOriginTrust(opts: {
  sessionId: string
  origin: string
  tools: WebMcpToolBody[]
}): WebMcpTrustState {
  if (sessionDenied.get(opts.sessionId)?.has(opts.origin)) return { status: 'denied' }
  const recorded = recordedFor(opts.sessionId, opts.origin)
  if (!recorded) return { status: 'undecided' }

  const changedTools: string[] = []
  const learned: Record<string, string> = {}
  for (const tool of opts.tools) {
    const current = webMcpToolFingerprint(tool.description, tool.inputSchema)
    const known = recorded[tool.name]
    if (known === undefined) {
      // A name the user has not seen. Trusting the *site* covers it publishing new tools, so
      // this is learned rather than re-asked — the per-call gate still applies to it.
      learned[tool.name] = current
    } else if (known !== current) {
      changedTools.push(tool.name)
    }
  }
  if (changedTools.length > 0) return { status: 'changed', changedTools }
  if (Object.keys(learned).length > 0) learnTools(opts.sessionId, opts.origin, learned)
  return { status: 'trusted' }
}

function learnTools(sessionId: string, origin: string, learned: Record<string, string>): void {
  const scoped = sessionTrust.get(sessionId)?.get(origin)
  if (scoped) {
    Object.assign(scoped, learned)
    return
  }
  const persisted = persistedTrust.get(origin)
  if (!persisted) return
  Object.assign(persisted, learned)
  void persistTrust(origin, persisted)
}

export function rememberWebMcpTrust(opts: {
  scope: WebMcpTrustScope
  sessionId: string
  origin: string
  tools: WebMcpToolBody[]
}): Promise<void> {
  const fingerprints = fingerprintsOf(opts.tools)
  sessionDenied.get(opts.sessionId)?.delete(opts.origin)
  if (opts.scope === 'session') {
    let byOrigin = sessionTrust.get(opts.sessionId)
    if (!byOrigin) {
      byOrigin = new Map()
      sessionTrust.set(opts.sessionId, byOrigin)
    }
    byOrigin.set(opts.origin, fingerprints)
    return Promise.resolve()
  }
  persistedTrust.set(opts.origin, fingerprints)
  return persistTrust(opts.origin, fingerprints)
}

function persistTrust(origin: string, tools: Record<string, string>): Promise<void> {
  const pending = pendingWrites.get(origin)
  if (pending) return pending
  const write = Promise.resolve().then(() => {
    try {
      const current = readAppSettings().webmcpTrustedOrigins
      const next: WebmcpTrustedOrigin[] = current.filter((entry) => entry.origin !== origin)
      next.push({ origin, tools: { ...tools } })
      saveAppSettings({ webmcpTrustedOrigins: next })
    } catch {
      // The accepted site stays trusted for this process even if persistence fails.
    }
  }).finally(() => {
    pendingWrites.delete(origin)
  })
  pendingWrites.set(origin, write)
  return write
}

/**
 * Remember a "no" for the rest of this chat. Not persisted: a refusal is usually about what the
 * agent was doing at that moment, not a permanent verdict on the site.
 */
export function denyWebMcpOrigin(sessionId: string, origin: string): void {
  let denied = sessionDenied.get(sessionId)
  if (!denied) {
    denied = new Set()
    sessionDenied.set(sessionId, denied)
  }
  denied.add(origin)
  sessionTrust.get(sessionId)?.delete(origin)
}

/** Drop every chat-scoped decision for a disposed session. */
export function forgetWebMcpSessionTrust(sessionId: string): void {
  sessionTrust.delete(sessionId)
  sessionDenied.delete(sessionId)
}
