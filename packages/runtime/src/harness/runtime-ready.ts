/**
 * Fail-closed runtime checks for session.create / harness.probe.
 * Catalog `ready` is not enough — the process that would run the turn must exist.
 *
 * Binary discovery and provider-credential lookup are host-specific and arrive
 * through `HarnessRuntimeResolver` / `HarnessAuthProbe` (see `types.ts`).
 */

import type { NodeHarnessId } from '@superone/shared/environment'
import type { HarnessManager } from './manager'
import type { HarnessAuthProbe, HarnessRuntimeResolver } from './types'

export type RuntimeReadyResult =
  | { ok: true; reason: string }
  | { ok: false; reason: string }

/** Per-wire-id runtime expectations. Catalog id differs from wire id for Grok. */
const RUNTIME_SPECS: Record<
  string,
  { catalogId: NodeHarnessId; okReason: string; failReason: string }
> = {
  claude: {
    catalogId: 'claude',
    okReason: 'claude binary or Agent SDK available',
    failReason:
      'claude runtime unavailable: install managed artifact, Agent SDK platform package, or SUPERONE_CLAUDE_BINARY',
  },
  codex: {
    catalogId: 'codex',
    okReason: 'codex binary available',
    failReason: 'codex runtime unavailable: enable with --artifact or set SUPERONE_CODEX_BINARY',
  },
  acp: {
    catalogId: 'acp-grok',
    okReason: 'acp binary available',
    failReason: 'acp-grok runtime unavailable: enable with --command or set SUPERONE_ACP_BINARY',
  },
  opencode: {
    catalogId: 'opencode',
    okReason: 'opencode binary available',
    // server-url only configs still need a client binary for the node runner today
    failReason:
      'opencode runtime unavailable: enable with --command or set SUPERONE_OPENCODE_BINARY',
  },
}

/**
 * Whether a session wire harness can actually launch a real turn runner
 * without simulated fallback. Used at session.create (production).
 */
export function assertSessionHarnessRuntimeReady(
  sessionHarnessId: string,
  harnesses: HarnessManager,
  resolver: HarnessRuntimeResolver,
): RuntimeReadyResult {
  const spec = RUNTIME_SPECS[sessionHarnessId]
  if (!spec) return { ok: false, reason: `unknown harness: ${sessionHarnessId}` }

  if (
    resolver.resolveBinary(spec.catalogId, harnesses) ||
    resolver.isRunnableWithoutCatalog(spec.catalogId)
  ) {
    return { ok: true, reason: spec.okReason }
  }
  return { ok: false, reason: spec.failReason }
}

export interface ProbeHarnessResult {
  id: NodeHarnessId
  previousState: string
  state: string
  transitioned: boolean
  ok: boolean
  issues: string[]
  reason: string
}

export interface ProbeDeps {
  resolver: HarnessRuntimeResolver
  auth?: HarnessAuthProbe | null
}

/**
 * Probe a harness and optionally promote needs_auth → ready when:
 * - managed binary (or SDK for claude) is present, and
 * - auth is satisfied: not requiresAuth, or a provider binding/credential exists,
 *   or SUPERONE_HARNESS_MARK_READY=1 (lab escape hatch).
 *
 * Also demotes ready → error when the runtime binary has disappeared.
 */
export function probeHarnessReadiness(
  harnesses: HarnessManager,
  id: NodeHarnessId,
  deps: ProbeDeps,
): ProbeHarnessResult {
  const status = harnesses.get(id)
  const previousState = status.state
  const issues: string[] = []
  const sessionWire = id === 'acp-grok' ? 'acp' : id

  const runtime = assertSessionHarnessRuntimeReady(sessionWire, harnesses, deps.resolver)
  if (!runtime.ok) {
    issues.push(runtime.reason)
    if (status.enabled && (status.state === 'ready' || status.state === 'needs_auth')) {
      harnesses.update(id, {
        state: 'error',
        diagnosticCode: 'probe_failed',
        lastProbedAt: Date.now(),
      })
      const next = harnesses.get(id)
      return {
        id,
        previousState,
        state: next.state,
        transitioned: next.state !== previousState,
        ok: false,
        issues,
        reason: runtime.reason,
      }
    }
    harnesses.update(id, { lastProbedAt: Date.now() })
    return {
      id,
      previousState,
      state: status.state,
      transitioned: false,
      ok: false,
      issues,
      reason: runtime.reason,
    }
  }

  // Runtime present. Auth check for managed harnesses still in needs_auth.
  if (status.enabled && status.state === 'needs_auth') {
    const authOk = isAuthSatisfied(id, deps)
    if (!authOk.ok) {
      issues.push(authOk.reason)
      harnesses.update(id, {
        lastProbedAt: Date.now(),
        diagnosticCode: 'needs_auth',
      })
      return {
        id,
        previousState,
        state: 'needs_auth',
        transitioned: false,
        ok: false,
        issues,
        reason: authOk.reason,
      }
    }
    harnesses.update(id, {
      state: 'ready',
      diagnosticCode: null,
      lastProbedAt: Date.now(),
    })
    return {
      id,
      previousState,
      state: 'ready',
      transitioned: true,
      ok: true,
      issues: [],
      reason: `promoted needs_auth → ready (${authOk.reason})`,
    }
  }

  if (status.enabled && status.state === 'ready') {
    harnesses.update(id, { lastProbedAt: Date.now(), diagnosticCode: null })
    return {
      id,
      previousState,
      state: 'ready',
      transitioned: false,
      ok: true,
      issues: [],
      reason: runtime.reason,
    }
  }

  harnesses.update(id, { lastProbedAt: Date.now() })
  return {
    id,
    previousState,
    state: status.state,
    transitioned: false,
    ok: status.enabled && status.state === 'ready',
    issues: status.enabled ? [`state_${status.state}`] : ['disabled'],
    reason: status.enabled ? `state is ${status.state}` : 'harness disabled',
  }
}

function isAuthSatisfied(
  id: NodeHarnessId,
  deps: ProbeDeps,
): { ok: true; reason: string } | { ok: false; reason: string } {
  if (process.env.SUPERONE_HARNESS_MARK_READY === '1') {
    return { ok: true, reason: 'SUPERONE_HARNESS_MARK_READY' }
  }
  const defRequiresAuth = id === 'claude' || id === 'codex'
  if (!defRequiresAuth) {
    return { ok: true, reason: 'external harness does not require SuperOne provider auth' }
  }
  // Host $HOME login (Claude/Codex CLI device login) is valid when binary/SDK exists.
  // Provider credentials are the SuperOne-managed path.
  const fromProvider = deps.auth?.hasCredentialFor(id)
  if (fromProvider?.ok) return fromProvider

  // Bundled SDK / env-pinned binary implies host credentials in $HOME.
  if (deps.resolver.isRunnableWithoutCatalog(id)) {
    return {
      ok: true,
      reason:
        id === 'claude'
          ? 'claude Agent SDK / host credentials assumed'
          : 'SUPERONE_CODEX_BINARY host credentials assumed',
    }
  }
  return {
    ok: false,
    reason:
      'needs_auth: push provider credentials, complete host CLI login, or set SUPERONE_HARNESS_MARK_READY=1 for lab',
  }
}
