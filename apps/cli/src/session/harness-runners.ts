import type { HarnessCatalogReader } from '@superone/runtime/harness'
import { resolveGrokRuntime } from '@superone/runtime/harness'
import type { HarnessId } from '@superone/shared/session-types'
import { NODE_HARNESS_DEFINITIONS } from '@superone/shared/environment/harness-installation'
import { createSimulatedTurnRunner, type TurnRunner } from '@superone/runtime/session'
import { createAcpTurnRunner, createSimulatedAcpTurnRunner } from '@superone/acp'
import { resolveCliReleaseVersion } from '../cli-release-version'
import {
  createOpenCodeTurnRunner,
  createSimulatedOpenCodeTurnRunner,
} from '@superone/opencode'
import {
  createCursorTurnRunner,
  createSimulatedCursorTurnRunner,
} from '@superone/cursor'

/**
 * Phase 4 harness runners. Real provider CLIs may be absent in CI; each harness
 * has a contract-compatible simulated runner so local/remote gateway parity
 * tests exercise the same Session/event surface.
 *
 * Production multi-dispatch (createProductionTurnRunner) uses real Claude/Codex
 * cores; ACP/OpenCode/Cursor use @superone/* packages (simulated until real clients).
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
    case 'cursor':
      return createSimulatedCursorTurnRunner({ delayMs })
    case 'dsh':
      return createSimulatedTurnRunner({
        delayMs,
        chunks: ['[dsh] ', 'done'],
      })
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
/** Harness-stored grok binary when the catalog has one; otherwise the explicit path. */
export function resolveProductionAcpLaunch(opts: {
  harnesses?: HarnessCatalogReader | null
  acpBinaryPath?: string | null
}): { binaryPath?: string | null; args?: string[]; agentId?: string } {
  if (opts.harnesses) {
    const grok = resolveGrokRuntime(opts.harnesses, {
      command: opts.acpBinaryPath?.trim() || undefined,
    })
    if (grok) {
      return { binaryPath: grok.command, args: grok.args, agentId: 'grok-build' }
    }
  }
  return { binaryPath: opts.acpBinaryPath ?? null }
}

export function createAcpOpenCodeProductionRouter(opts?: {
  allowSimulatedFallback?: boolean
  resolveProjectPath?: (projectId: string) => string | null
  acpBinaryPath?: string | null
  acpArgs?: string[]
  acpAgentId?: string
  harnesses?: HarnessCatalogReader | null
  /** ACP clientInfo.version. Defaults to the CLI release version. */
  clientVersion?: string
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
  const opencode = createOpenCodeTurnRunner({
    allowSimulatedFallback: allowSim,
    resolveProjectPath: opts?.resolveProjectPath,
    binaryPath: opts?.openCodeBinaryPath,
    getSuperoneMcp: opts?.getOpenCodeSuperoneMcp ?? undefined,
  })
  return async (input) => {
    const harnessId = input.session.harnessId || 'codex'
    if (harnessId === 'acp') {
      // Catalog enable and command changes happen after the node process starts.
      // Resolve on the turn so the first ACP call sees the current grok binary.
      const acpLaunch = resolveProductionAcpLaunch({
        harnesses: opts?.harnesses,
        acpBinaryPath: opts?.acpBinaryPath,
      })
      const acp = createAcpTurnRunner({
        allowSimulatedFallback: allowSim,
        resolveProjectPath: opts?.resolveProjectPath,
        binaryPath: acpLaunch.binaryPath,
        args: opts?.acpArgs ?? acpLaunch.args,
        agentId: opts?.acpAgentId ?? acpLaunch.agentId,
        clientVersion: opts?.clientVersion ?? resolveCliReleaseVersion(),
        getMcpServers: opts?.getAcpMcpServers
          ? (sessionId) => opts.getAcpMcpServers!(sessionId) ?? []
          : undefined,
      })
      return acp(input)
    }
    if (harnessId === 'opencode') return opencode(input)
    throw new Error(`createAcpOpenCodeProductionRouter: unexpected harness ${harnessId}`)
  }
}

/**
 * Session wire harness ids advertised when the simulated catalog is fully ready.
 * Order matches NODE_HARNESS_DEFINITIONS → sessionHarnessId mapping
 * (acp-grok → acp).
 */
export const PHASE4_HARNESS_IDS: HarnessId[] = NODE_HARNESS_DEFINITIONS.map(
  ({ sessionHarnessId }) => sessionHarnessId,
)

// Re-export for production turn runner wiring.
export { createCursorTurnRunner }
