import type { HarnessId } from '@superone/shared/session-types'
import { createSimulatedTurnRunner, type TurnRunner } from '@superone/runtime/session'
import { createAcpTurnRunner, createSimulatedAcpTurnRunner } from '@superone/acp'
import {
  createOpenCodeTurnRunner,
  createSimulatedOpenCodeTurnRunner,
} from '@superone/opencode'

/**
 * Phase 4 harness runners. Real provider CLIs may be absent in CI; each harness
 * has a contract-compatible simulated runner so local/remote gateway parity
 * tests exercise the same Session/event surface.
 *
 * Production multi-dispatch (createProductionTurnRunner) uses real Claude/Codex
 * cores; ACP/OpenCode use @superone/acp|opencode (simulated until real clients).
 */
export function createHarnessRunner(harnessId: HarnessId, opts?: { delayMs?: number }): TurnRunner {
  const delayMs = opts?.delayMs ?? 15
  switch (harnessId) {
    case 'codex':
      return createSimulatedTurnRunner({
        delayMs,
        chunks: ['[codex] ', 'done'],
      })
    case 'claude':
      return createSimulatedTurnRunner({
        delayMs,
        chunks: ['[claude] ', 'done'],
      })
    case 'acp':
      return createSimulatedAcpTurnRunner({ delayMs })
    case 'opencode':
      return createSimulatedOpenCodeTurnRunner({ delayMs })
    default: {
      const _exhaustive: never = harnessId
      throw new Error(`unsupported harness: ${_exhaustive}`)
    }
  }
}

export function createMultiHarnessRouter(
  defaultHarness: HarnessId = 'codex',
): TurnRunner {
  return async (input) => {
    const harness = (input.session.harnessId as HarnessId) || defaultHarness
    const runner = createHarnessRunner(harness)
    return runner(input)
  }
}

/**
 * Production multi-dispatch for ACP / OpenCode node adapters.
 * Real process when SUPERONE_ACP_BINARY / SUPERONE_OPENCODE_BINARY (or opts) set;
 * simulated **only** when `allowSimulatedFallback: true` (tests / CI overlay).
 * Production must pass false or omit — never silently simulate.
 */
export function createAcpOpenCodeProductionRouter(opts?: {
  allowSimulatedFallback?: boolean
  resolveProjectPath?: (projectId: string) => string | null
  acpBinaryPath?: string | null
  openCodeBinaryPath?: string | null
  /** SuperOne Host Action MCP for ACP session/new. */
  getAcpMcpServers?: (sessionId: string) => unknown[] | null
  /** SuperOne Host Action HTTP MCP for OpenCode. */
  getOpenCodeSuperoneMcp?: (
    sessionId: string,
  ) => { url: string; headers: Record<string, string> } | null
}): TurnRunner {
  // Opt-in only. `undefined` and `false` both fail closed without a real binary.
  const allowSim = opts?.allowSimulatedFallback === true
  const acp = createAcpTurnRunner({
    allowSimulatedFallback: allowSim,
    resolveProjectPath: opts?.resolveProjectPath,
    binaryPath: opts?.acpBinaryPath,
    getMcpServers: opts?.getAcpMcpServers
      ? (sessionId) => opts.getAcpMcpServers!(sessionId) ?? []
      : undefined,
  })
  const opencode = createOpenCodeTurnRunner({
    allowSimulatedFallback: allowSim,
    resolveProjectPath: opts?.resolveProjectPath,
    binaryPath: opts?.openCodeBinaryPath,
    getSuperoneMcp: opts?.getOpenCodeSuperoneMcp ?? undefined,
  })
  return async (input) => {
    const harnessId = input.session.harnessId || 'codex'
    if (harnessId === 'acp') return acp(input)
    if (harnessId === 'opencode') return opencode(input)
    throw new Error(`createAcpOpenCodeProductionRouter: unexpected harness ${harnessId}`)
  }
}

/**
 * Session wire harness ids advertised when the simulated catalog is fully ready.
 * Order matches NODE_HARNESS_DEFINITIONS → sessionHarnessId mapping
 * (acp-grok → acp).
 */
export const PHASE4_HARNESS_IDS: HarnessId[] = ['claude', 'codex', 'opencode', 'acp']
