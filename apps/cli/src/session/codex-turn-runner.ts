/**
 * Production TurnRunner for node-hosted Codex (Stage 4) and multi-dispatch
 * with Claude (Stage 5-E Agent SDK via @superone/claude).
 *
 * Binary resolution (Codex):
 * 1. explicit binaryPath
 * 2. SUPERONE_CODEX_BINARY
 * 3. harness catalog command when codex is enabled and (ready | needs_auth with path)
 *
 * Session create accepts either catalog-ready codex or a lab override when
 * SUPERONE_CODEX_BINARY points at an existing executable (see handlers).
 *
 * Codex turn protocol: @superone/codex. Claude: claude-turn-runner / core-claude.
 */

import { existsSync } from 'node:fs'
import {
  openCodexAppServer,
  runCodexAppServerTurn,
  type CodexSpawnFn,
} from '@superone/codex'
import {
  createNodeClaudeTurnRunner,
  type NodeClaudeRunnerOptions,
} from './claude-turn-runner'
import { createSimulatedCodexRunner, type TurnRunner } from '@superone/runtime/session'
import { createMultiHarnessRouter, createAcpOpenCodeProductionRouter } from './harness-runners'
import type { HarnessManager } from './harness-manager'
import type { ProviderStore } from '../provider/provider-store'
import { buildHarnessEnv, resolveHarnessService } from '../provider/resolve-service'

export interface NodeCodexRunnerOptions {
  binaryPath?: string | null
  resolveProjectPath: (projectId: string) => string | null
  harnesses?: HarnessManager
  env?: NodeJS.ProcessEnv
  spawnFn?: CodexSpawnFn
  allowSimulatedFallback?: boolean
  /** Node provider store — injects API keys for this turn. */
  providers?: ProviderStore
  /**
   * Codex `config.mcp_servers.superone` for Host Action HTTP MCP.
   * When set, attached on every thread/start and thread/resume.
   */
  getCodexHostActionMcp?: (
    sessionId: string,
  ) => {
    url: string
    http_headers: Record<string, string>
    startup_timeout_sec: number
  } | null
}

/** Production multi-dispatch options (Codex Stage 4 + Claude Stage 5-E + ACP/OpenCode). */
export interface NodeProductionRunnerOptions extends NodeCodexRunnerOptions {
  claudeBinaryPath?: string | null
  /** Injectable Claude Agent SDK query for tests. */
  claudeQueryFn?: NodeClaudeRunnerOptions['queryFn']
  acpBinaryPath?: string | null
  openCodeBinaryPath?: string | null
  /** Host Action MCP for Claude (in-process SDK). */
  createHostActionClaudeMcp?: NodeClaudeRunnerOptions['createHostActionClaudeMcp']
  /** Host Action HTTP MCP for ACP session/new. */
  getAcpHostActionMcpServers?: (sessionId: string) => unknown[] | null
  /** Host Action HTTP MCP for OpenCode mcp.add. */
  getOpenCodeHostActionMcp?: (
    sessionId: string,
  ) => { url: string; headers: Record<string, string> } | null
}

export function resolveCodexBinaryPath(opts: {
  binaryPath?: string | null
  harnesses?: HarnessManager
}): string | null {
  if (opts.binaryPath && existsSync(opts.binaryPath)) return opts.binaryPath
  const fromEnv = process.env.SUPERONE_CODEX_BINARY?.trim()
  if (fromEnv && existsSync(fromEnv)) return fromEnv
  const status = opts.harnesses?.get('codex')
  if (
    status?.enabled &&
    (status.state === 'ready' || status.state === 'needs_auth') &&
    status.command &&
    existsSync(status.command)
  ) {
    return status.command
  }
  return null
}

/**
 * Whether session.create may target codex when catalog is not yet ready
 * but SUPERONE_CODEX_BINARY points at a real executable (lab override).
 */
export function isCodexBinaryOverrideRunnable(): boolean {
  const fromEnv = process.env.SUPERONE_CODEX_BINARY?.trim()
  return Boolean(fromEnv && existsSync(fromEnv))
}

export function createNodeCodexTurnRunner(opts: NodeCodexRunnerOptions): TurnRunner {
  const simulatedCodex = createSimulatedCodexRunner()

  return async (input) => {
    const harnessId = input.session.harnessId || 'codex'
    if (harnessId !== 'codex') {
      throw new Error(
        `createNodeCodexTurnRunner only handles harness codex (got ${harnessId})`,
      )
    }

    const binary = resolveCodexBinaryPath({
      binaryPath: opts.binaryPath,
      harnesses: opts.harnesses,
    })
    if (!binary) {
      if (opts.allowSimulatedFallback) return simulatedCodex(input)
      throw new Error(
        'Codex binary not available: enable harness codex (managed install) or set SUPERONE_CODEX_BINARY',
      )
    }

    const projectRoot =
      opts.resolveProjectPath(input.session.projectId) ||
      process.env.SUPERONE_DEFAULT_CWD ||
      process.cwd()
    const cwd =
      input.session.cwd && input.session.cwd.trim()
        ? input.session.cwd.trim()
        : projectRoot

    const providerEnv =
      opts.providers
        ? buildHarnessEnv(
            'codex',
            resolveHarnessService(opts.providers, 'codex', input.apiProviderId),
          )
        : {}
    const authEnv: NodeJS.ProcessEnv = {
      ...process.env,
      ...opts.env,
      ...providerEnv,
    }

    const client = await openCodexAppServer({
      binaryPath: binary,
      env: authEnv,
      spawnFn: opts.spawnFn,
      signal: input.signal,
    })

    try {
      const priorThread =
        input.session.providerResume && input.session.providerResume.startsWith('thread:')
          ? input.session.providerResume.slice('thread:'.length)
          : null

      const hostActionMcp = opts.getCodexHostActionMcp?.(input.session.sessionId) ?? null
      const threadConfig = hostActionMcp
        ? { mcp_servers: { superone: hostActionMcp } }
        : undefined

      const result = await runCodexAppServerTurn({
        client,
        prompt: input.text,
        cwd,
        threadId: priorThread,
        model: input.model && input.model.trim() ? input.model.trim() : undefined,
        messageId: input.messageId,
        onAgentEvent: input.onAgentEvent,
        onDelta: input.onDelta,
        signal: input.signal,
        threadConfig,
      })

      return {
        finalText: result.finalText,
        providerResume: result.threadId ? `thread:${result.threadId}` : null,
      }
    } finally {
      await client.close().catch(() => {})
    }
  }
}

/**
 * Production multi-dispatch: real Codex (Stage 4) + real Claude Agent SDK (Stage 5-E).
 * ACP / OpenCode: real process when SUPERONE_ACP_BINARY / SUPERONE_OPENCODE_BINARY
 * (or opts paths) exist; otherwise simulated (unless allowSimulatedFallback is false).
 */
export function createProductionTurnRunner(opts: NodeProductionRunnerOptions): TurnRunner {
  const codex = createNodeCodexTurnRunner(opts)
  const claude = createNodeClaudeTurnRunner({
    binaryPath: opts.claudeBinaryPath,
    resolveProjectPath: opts.resolveProjectPath,
    harnesses: opts.harnesses,
    env: opts.env,
    queryFn: opts.claudeQueryFn,
    allowSimulatedFallback: opts.allowSimulatedFallback,
    providers: opts.providers,
    createHostActionClaudeMcp: opts.createHostActionClaudeMcp,
  })
  const acpOpenCode = createAcpOpenCodeProductionRouter({
    allowSimulatedFallback: opts.allowSimulatedFallback,
    resolveProjectPath: opts.resolveProjectPath,
    acpBinaryPath: opts.acpBinaryPath,
    openCodeBinaryPath: opts.openCodeBinaryPath,
    getAcpMcpServers: opts.getAcpHostActionMcpServers,
    getOpenCodeSuperoneMcp: opts.getOpenCodeHostActionMcp,
  })
  const simulated = createMultiHarnessRouter('codex')

  return async (input) => {
    const harnessId = input.session.harnessId || 'codex'
    if (harnessId === 'codex') return codex(input)
    if (harnessId === 'claude') return claude(input)
    if (harnessId === 'acp' || harnessId === 'opencode') return acpOpenCode(input)
    if (opts.allowSimulatedFallback) return simulated(input)
    throw new Error(
      `real node runner for harness ${harnessId} is not implemented yet (Stage 5-E supports codex + claude)`,
    )
  }
}
