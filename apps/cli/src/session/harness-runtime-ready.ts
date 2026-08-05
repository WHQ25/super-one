/**
 * Fail-closed runtime checks for session.create / harness.probe.
 * Catalog `ready` is not enough — the process that would run the turn must exist.
 */

import { existsSync } from 'node:fs'
import type { HarnessManager } from './harness-manager'
import { isClaudeRuntimeRunnable, resolveClaudeBinaryPath } from './claude-turn-runner'
import { isCodexBinaryOverrideRunnable, resolveCodexBinaryPath } from './codex-turn-runner'
import type { ProviderStore } from '../provider/provider-store'
import { consumerForHarness } from '../provider/resolve-service'
import type { NodeHarnessId } from '@superone/shared/environment'

export type RuntimeReadyResult =
  | { ok: true; reason: string }
  | { ok: false; reason: string }

function commandExists(command: string | null | undefined): boolean {
  return Boolean(command && existsSync(command))
}

function envBinaryExists(envName: string): boolean {
  const v = process.env[envName]?.trim()
  return Boolean(v && existsSync(v))
}

/**
 * Whether a session wire harness can actually launch a real turn runner
 * without simulated fallback. Used at session.create (production).
 */
export function assertSessionHarnessRuntimeReady(
  sessionHarnessId: string,
  harnesses: HarnessManager,
): RuntimeReadyResult {
  const id = sessionHarnessId === 'acp' ? 'acp' : sessionHarnessId

  if (id === 'claude') {
    if (resolveClaudeBinaryPath({ harnesses }) || isClaudeRuntimeRunnable()) {
      return { ok: true, reason: 'claude binary or Agent SDK available' }
    }
    return {
      ok: false,
      reason:
        'claude runtime unavailable: install managed artifact, Agent SDK platform package, or SUPERONE_CLAUDE_BINARY',
    }
  }

  if (id === 'codex') {
    if (resolveCodexBinaryPath({ harnesses }) || isCodexBinaryOverrideRunnable()) {
      return { ok: true, reason: 'codex binary available' }
    }
    return {
      ok: false,
      reason: 'codex runtime unavailable: enable with --artifact or set SUPERONE_CODEX_BINARY',
    }
  }

  if (id === 'acp') {
    const status = harnesses.get('acp-grok')
    if (commandExists(status.command) || envBinaryExists('SUPERONE_ACP_BINARY')) {
      return { ok: true, reason: 'acp binary available' }
    }
    return {
      ok: false,
      reason: 'acp-grok runtime unavailable: enable with --command or set SUPERONE_ACP_BINARY',
    }
  }

  if (id === 'opencode') {
    const status = harnesses.get('opencode')
    if (commandExists(status.command) || envBinaryExists('SUPERONE_OPENCODE_BINARY')) {
      return { ok: true, reason: 'opencode binary available' }
    }
    // server-url only configs still need a client binary for the node runner today
    return {
      ok: false,
      reason: 'opencode runtime unavailable: enable with --command or set SUPERONE_OPENCODE_BINARY',
    }
  }

  return { ok: false, reason: `unknown harness: ${sessionHarnessId}` }
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
  providers?: ProviderStore | null,
): ProbeHarnessResult {
  const status = harnesses.get(id)
  const previousState = status.state
  const issues: string[] = []
  const sessionWire = id === 'acp-grok' ? 'acp' : id

  const runtime = assertSessionHarnessRuntimeReady(sessionWire, harnesses)
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
    const authOk = isAuthSatisfied(id, providers)
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
  providers?: ProviderStore | null,
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
  if (providers) {
    const consumer = consumerForHarness(id)
    if (consumer) {
      const binding = providers.listBindings().find((b) => b.consumer === consumer)
      if (binding?.credentialId) {
        const cred = providers.listCredentials().find((c) => c.id === binding.credentialId)
        if (cred) return { ok: true, reason: `provider binding ${consumer}` }
      }
      // Any credential that can serve this harness consumer family
      const any = providers.listCredentials()
      if (any.length > 0) {
        return { ok: true, reason: 'node has provider credentials' }
      }
    }
  }
  // Claude Agent SDK / host login: binary present is enough for lab (credentials in $HOME).
  if (id === 'claude' && isClaudeRuntimeRunnable()) {
    return { ok: true, reason: 'claude Agent SDK / host credentials assumed' }
  }
  // Codex with SUPERONE_CODEX_BINARY often uses host login too.
  if (id === 'codex' && isCodexBinaryOverrideRunnable()) {
    return { ok: true, reason: 'SUPERONE_CODEX_BINARY host credentials assumed' }
  }
  return {
    ok: false,
    reason:
      'needs_auth: push provider credentials, complete host CLI login, or set SUPERONE_HARNESS_MARK_READY=1 for lab',
  }
}
