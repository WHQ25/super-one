/**
 * Production TurnRunner for node-hosted Claude (Stage 5-E).
 *
 * Uses `@superone/claude` → Claude Agent SDK `query()`. The SDK ships its
 * own platform binary via optionalDependencies; hosts do **not** need a global
 * `claude` install for turns.
 *
 * Binary resolution order (do **not** prefer host `claude` CLI):
 * 1. explicit `binaryPath` (tests / pin)
 * 2. harness catalog `command` when SuperOne managed-enable installed a package
 * 3. Agent SDK bundled platform binary (`resolveSdkClaudeBinary`) — default
 * 4. `SUPERONE_CLAUDE_BINARY` last-resort escape hatch only
 *
 * Auth: reuse node-host login state under `$HOME` (e.g. `~/.claude`) and/or
 * node ProviderStore API keys — never require the remote/host `claude` binary.
 *
 * Session create is allowed when any of the above resolves (see
 * `isClaudeRuntimeRunnable`).
 *
 * providerResume: `claude-session:<session_id>` for SDK `resume`.
 */

import { existsSync } from 'node:fs'
import {
  runClaudeSdkTurn,
  resolveSdkClaudeBinary,
  type ClaudeQueryFn,
} from '@superone/claude'
import { createSimulatedCodexRunner, type TurnRunner } from '@superone/runtime/session'
import type { HarnessManager } from './harness-manager'
import type { ProviderStore } from '../provider/provider-store'
import { buildHarnessEnv, resolveHarnessService } from '../provider/resolve-service'

export const CLAUDE_SESSION_RESUME_PREFIX = 'claude-session:'

export interface NodeClaudeRunnerOptions {
  binaryPath?: string | null
  resolveProjectPath: (projectId: string) => string | null
  harnesses?: HarnessManager
  env?: NodeJS.ProcessEnv
  /** Injectable SDK query for tests (no real Claude process). */
  queryFn?: ClaudeQueryFn
  allowSimulatedFallback?: boolean
  /** Tests only: do not fall back to Agent SDK bundled binary. */
  skipSdkBinary?: boolean
  /** Node provider store — injects API keys for this turn. */
  providers?: ProviderStore
  /**
   * Host Action MCP servers for this session (loopback HTTP).
   * When set, Claude receives `options.mcpServers` so it can call browser_snapshot.
   */
  getHostActionMcpServers?: (
    sessionId: string,
  ) => Record<string, { type: 'http'; url: string; headers: Record<string, string> }> | null
}

export function resolveClaudeBinaryPath(opts: {
  binaryPath?: string | null
  harnesses?: HarnessManager
  skipSdkBinary?: boolean
}): string | null {
  if (opts.binaryPath && existsSync(opts.binaryPath)) return opts.binaryPath
  // SuperOne managed package from `harness enable claude` (node home releases/).
  const status = opts.harnesses?.get('claude')
  if (
    status?.enabled &&
    (status.state === 'ready' || status.state === 'needs_auth') &&
    status.command &&
    existsSync(status.command)
  ) {
    return status.command
  }
  // Default: Agent SDK optional platform package (same family as desktop).
  if (!opts.skipSdkBinary) {
    const sdk = resolveSdkClaudeBinary()
    if (sdk) return sdk
  }
  // Escape hatch only — not auto-set from host `which claude` in lab.
  const fromEnv = process.env.SUPERONE_CLAUDE_BINARY?.trim()
  if (fromEnv && existsSync(fromEnv)) return fromEnv
  return null
}

/**
 * Whether session.create may target claude without catalog-ready install.
 * True when managed package, Agent SDK bundle, or explicit env pin resolves.
 */
export function isClaudeRuntimeRunnable(): boolean {
  return resolveClaudeBinaryPath({}) != null
}

/**
 * @deprecated Use {@link isClaudeRuntimeRunnable}. Kept for call-site aliases.
 */
export function isClaudeBinaryOverrideRunnable(): boolean {
  return isClaudeRuntimeRunnable()
}

export function parseClaudeSessionResume(providerResume: string | null | undefined): string | null {
  if (!providerResume || !providerResume.startsWith(CLAUDE_SESSION_RESUME_PREFIX)) return null
  const id = providerResume.slice(CLAUDE_SESSION_RESUME_PREFIX.length).trim()
  return id.length > 0 ? id : null
}

export function formatClaudeSessionResume(sessionId: string | null | undefined): string | null {
  if (!sessionId || !sessionId.trim()) return null
  return `${CLAUDE_SESSION_RESUME_PREFIX}${sessionId.trim()}`
}

export function createNodeClaudeTurnRunner(opts: NodeClaudeRunnerOptions): TurnRunner {
  const simulatedClaude = createSimulatedCodexRunner({
    delayMs: 15,
    chunks: ['[claude] ', 'done'],
  })

  return async (input) => {
    const harnessId = input.session.harnessId || 'claude'
    if (harnessId !== 'claude') {
      throw new Error(
        `createNodeClaudeTurnRunner only handles harness claude (got ${harnessId})`,
      )
    }

    const binary = resolveClaudeBinaryPath({
      binaryPath: opts.binaryPath,
      harnesses: opts.harnesses,
      skipSdkBinary: opts.skipSdkBinary,
    })
    if (!binary) {
      if (opts.allowSimulatedFallback) return simulatedClaude(input)
      throw new Error(
        'Claude Agent SDK binary not available: reinstall optional platform package or set SUPERONE_CLAUDE_BINARY',
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
            'claude',
            resolveHarnessService(opts.providers, 'claude', input.apiProviderId),
          )
        : {}
    const authEnv: NodeJS.ProcessEnv = {
      ...process.env,
      ...opts.env,
      ...providerEnv,
    }

    const priorSession = parseClaudeSessionResume(input.session.providerResume)

    // Host Action channel: expose desktop-executed tools (browser_snapshot) over loopback MCP.
    const hostActionMcp =
      opts.getHostActionMcpServers?.(input.session.sessionId) ?? null

    const result = await runClaudeSdkTurn({
      binaryPath: binary,
      prompt: input.text,
      cwd,
      sessionId: priorSession,
      model: input.model && input.model.trim() ? input.model.trim() : undefined,
      env: authEnv,
      queryFn: opts.queryFn,
      onDelta: input.onDelta,
      onEvent: input.onEvent,
      onPermission: input.onPermission
        ? async (req) => {
            const decision = await input.onPermission!({
              interactionId: req.interactionId,
              kind: 'permission',
              toolName: req.toolName,
              toolUseId: req.toolUseId,
              input: req.input,
              createdAt: Date.now(),
            })
            return decision
          }
        : undefined,
      signal: input.signal,
      options: hostActionMcp
        ? {
            mcpServers: hostActionMcp,
            // Prefer the host-action tool surface over project .mcp.json for this slice.
            strictMcpConfig: true,
          }
        : undefined,
    })

    return {
      finalText: result.finalText,
      providerResume: formatClaudeSessionResume(result.sessionId),
    }
  }
}
