import {
  createSimulatedTurnRunner,
  type TurnRunner,
} from '@superone/runtime/session'
import { createAcpAgentTurnRunner, type RunAcpTurnOptions } from './run-turn'
import type { AcpLaunch } from './process'
import { existsSync } from 'node:fs'

/**
 * Contract-compatible ACP turn runner for node / gateway parity tests.
 */
export function createSimulatedAcpTurnRunner(opts?: {
  delayMs?: number
  chunks?: string[]
  requestPermission?: boolean
  emitStructuredEvents?: boolean
}): TurnRunner {
  return createSimulatedTurnRunner({
    delayMs: opts?.delayMs ?? 15,
    chunks: opts?.chunks ?? ['[acp] ', 'done'],
    requestPermission: opts?.requestPermission,
    emitStructuredEvents: opts?.emitStructuredEvents,
  })
}

export interface CreateAcpTurnRunnerOptions extends RunAcpTurnOptions {
  allowSimulatedFallback?: boolean
  delayMs?: number
  /** Explicit agent binary path (or SUPERONE_ACP_BINARY / SUPERONE_ACP_COMMAND). */
  binaryPath?: string | null
  args?: string[]
  /** Production grok launches set this to `grok-build`. */
  agentId?: string
}

const DEFAULT_GROK_ARGS = ['agent', 'stdio']

export function resolveAcpProductionLaunch(opts: CreateAcpTurnRunnerOptions): AcpLaunch | null {
  if (opts.launch?.command) return opts.launch
  const fromEnv =
    process.env.SUPERONE_ACP_BINARY?.trim() ||
    process.env.SUPERONE_ACP_COMMAND?.trim() ||
    opts.binaryPath?.trim()
  if (!fromEnv) return null
  if (fromEnv.includes('/') || fromEnv.includes('\\')) {
    if (!existsSync(fromEnv)) return null
  }
  const fromOpts = opts.args?.filter((arg) => arg.trim().length > 0) ?? []
  const fromEnvArgs = process.env.SUPERONE_ACP_ARGS?.trim().split(/\s+/).filter(Boolean) ?? []
  const args = fromOpts.length > 0 ? fromOpts : fromEnvArgs.length > 0 ? fromEnvArgs : DEFAULT_GROK_ARGS
  return {
    command: fromEnv,
    args,
    agentId: opts.agentId ?? 'grok-build',
  }
}

/**
 * Production entry: real ACP agent process when command is configured, else simulated.
 */
export function createAcpTurnRunner(opts: CreateAcpTurnRunnerOptions = {}): TurnRunner {
  const launch = resolveAcpProductionLaunch(opts)
  if (launch) {
    return createAcpAgentTurnRunner({
      launch,
      resolveProjectPath: opts.resolveProjectPath,
      clientName: opts.clientName,
      clientVersion: opts.clientVersion,
      mcpServers: opts.mcpServers,
      getMcpServers: opts.getMcpServers,
    })
  }
  if (opts.allowSimulatedFallback === false) {
    return async () => {
      throw new Error(
        'ACP agent client not available on node: set SUPERONE_ACP_BINARY (or launch.command), or enable simulated fallback',
      )
    }
  }
  return createSimulatedAcpTurnRunner({ delayMs: opts.delayMs })
}
