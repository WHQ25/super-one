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
 *
 * Long-lived app-server connections are kept per SuperOne session so mid-turn
 * steer reuses the same process/thread (desktop parity).
 */

import { existsSync } from 'node:fs'
import {
  ensureCodexThread,
  openCodexAppServer,
  runCodexAppServerTurn,
  type CodexAppServerHandle,
  type CodexSpawnFn,
  type CodexTurnKind,
} from '@superone/codex'
import {
  createNodeClaudeTurnRunner,
  type NodeClaudeRunnerOptions,
} from './claude-turn-runner'
import { createSimulatedCodexRunner, type TurnRunner } from '@superone/runtime/session'
import { createMultiHarnessRouter, createAcpOpenCodeProductionRouter, createCursorTurnRunner } from './harness-runners'
import type { HarnessCatalogReader } from '@superone/runtime/harness'
import type { ProviderStore } from '../provider/provider-store'
import { buildHarnessEnvWithProxy, resolveHarnessService } from '../provider/resolve-service'
import { prepareTurnPrompt } from './turn-attachments'
import { ensureMcpMerge, type McpMergeMode } from '@superone/runtime/fs'
import { openTurnAndStream } from './codex-live-turn'

export interface NodeCodexRunnerOptions {
  binaryPath?: string | null
  resolveProjectPath: (projectId: string) => string | null
  harnesses?: HarnessCatalogReader
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
  /**
   * MCP merge mode. Default: merge enabled user/project MCP from disk into
   * thread `config.mcp_servers` alongside host-action superone.
   * Set `host-action-only` or env `SUPERONE_MCP_MERGE=0` for host-action only.
   */
  mcpMergeMode?: McpMergeMode
  /** Override home / CODEX_HOME for MCP paths (tests). */
  homeDir?: string
  codexHome?: string
}

/** Production multi-dispatch options (Codex Stage 4 + Claude Stage 5-E + ACP/OpenCode). */
export interface NodeProductionRunnerOptions extends NodeCodexRunnerOptions {
  claudeBinaryPath?: string | null
  /** Injectable Claude Agent SDK query for tests. */
  claudeQueryFn?: NodeClaudeRunnerOptions['queryFn']
  experimentalClaudeOpenAiChatEnabled?: NodeClaudeRunnerOptions['experimentalClaudeOpenAiChatEnabled']
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

/** Map SuperOne effort levels onto Codex app-server reasoning effort. */
export function mapCodexReasoningEffort(
  effort: string | null | undefined,
): 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | undefined {
  if (!effort) return undefined
  const e = effort.trim().toLowerCase()
  if (e === 'max') return 'xhigh'
  if (e === 'minimal' || e === 'low' || e === 'medium' || e === 'high' || e === 'xhigh') {
    return e
  }
  return undefined
}

export function resolveCodexBinaryPath(opts: {
  binaryPath?: string | null
  harnesses?: HarnessCatalogReader
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

/**
 * Fingerprint provider-related env so long-lived app-server processes reopen
 * when proxy loopback URL / API key material changes (credential switch or
 * openai-chat ↔ native protocol flip).
 */
function providerEnvKeyOf(env: NodeJS.ProcessEnv): string {
  return [
    env.OPENAI_BASE_URL ?? '',
    env.CODEX_BASE_URL ?? '',
    env.OPENAI_API_KEY ?? '',
    env.CODEX_API_KEY ?? '',
  ].join('\0')
}

interface LiveCodexConnection {
  client: CodexAppServerHandle
  threadId: string | null
  /** Active turn id while a run is streaming (enables steer). */
  activeTurnId: string | null
  cwd: string
  /** See {@link providerEnvKeyOf}. */
  providerEnvKey: string
  /** Serializes full turns (run/review/compact) on the same connection. */
  chain: Promise<unknown>
}

function parseTurnKind(raw: unknown): CodexTurnKind {
  if (raw === 'steer' || raw === 'review' || raw === 'compact' || raw === 'run') return raw
  return 'run'
}

export function createNodeCodexTurnRunner(opts: NodeCodexRunnerOptions): TurnRunner {
  const simulatedCodex = createSimulatedCodexRunner()
  /** SuperOne sessionId → long-lived app-server handle (steer requires this). */
  const liveBySession = new Map<string, LiveCodexConnection>()

  const disposeLive = async (sessionId: string) => {
    const live = liveBySession.get(sessionId)
    if (!live) return
    liveBySession.delete(sessionId)
    await live.client.close().catch(() => {})
  }

  const openLive = async (
    sessionId: string,
    binary: string,
    authEnv: NodeJS.ProcessEnv,
    cwd: string,
  ): Promise<LiveCodexConnection> => {
    const providerEnvKey = providerEnvKeyOf(authEnv)
    const existing = liveBySession.get(sessionId)
    if (existing && existing.cwd === cwd && existing.providerEnvKey === providerEnvKey) {
      return existing
    }
    if (existing) await disposeLive(sessionId)

    const client = await openCodexAppServer({
      binaryPath: binary,
      env: authEnv,
      spawnFn: opts.spawnFn,
      // Connection outlives individual turns — do not bind open to turn abort.
    })
    const live: LiveCodexConnection = {
      client,
      // threadId stays null until ensureCodexThread (start|resume) succeeds.
      threadId: null,
      activeTurnId: null,
      cwd,
      providerEnvKey,
      chain: Promise.resolve(),
    }
    liveBySession.set(sessionId, live)
    return live
  }

  const runner: TurnRunner = async (input) => {
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

    // openai-chat credentials get a loopback protocol proxy (Responses↔Chat);
    // native openai-responses pass through the real base URL (no proxy).
    const providerEnv = opts.providers
      ? await buildHarnessEnvWithProxy(
          'codex',
          resolveHarnessService(opts.providers, 'codex', input.apiProviderId),
        )
      : {}
    const authEnv: NodeJS.ProcessEnv = {
      ...process.env,
      ...opts.env,
      ...providerEnv,
    }

    const sessionId = input.session.sessionId
    let turnKind = parseTurnKind(input.turnKind)

    const hostActionMcp = opts.getCodexHostActionMcp?.(sessionId) ?? null
    const merged = ensureMcpMerge({
      provider: 'codex',
      cwd,
      hostActionServers: hostActionMcp ? { superone: hostActionMcp } : undefined,
      mode: opts.mcpMergeMode,
      env: authEnv,
      homeDir: opts.homeDir,
      codexHome: opts.codexHome,
    })
    const threadConfig =
      Object.keys(merged.codexMcpServers).length > 0
        ? { mcp_servers: merged.codexMcpServers }
        : undefined

    const prepared = prepareTurnPrompt(input.text, cwd, input.images)
    const prompt = prepared.kind === 'text' ? prepared.text : prepared.textFallback
    const reasoningEffort = mapCodexReasoningEffort(input.effort)

    const priorThread =
      input.session.providerResume && input.session.providerResume.startsWith('thread:')
        ? input.session.providerResume.slice('thread:'.length)
        : null

    // Steer must hit the in-flight connection immediately (not serialized on chain).
    if (turnKind === 'steer' || (turnKind === 'run' && liveBySession.get(sessionId)?.activeTurnId)) {
      const live = liveBySession.get(sessionId)
      if (!live?.threadId || !live.activeTurnId) {
        throw new Error('No active Codex turn to steer')
      }
      const result = await runCodexAppServerTurn({
        client: live.client,
        prompt,
        cwd: live.cwd,
        threadId: live.threadId,
        turnKind: 'steer',
        expectedTurnId: live.activeTurnId,
        skipThreadSetup: true,
        signal: input.signal,
      })
      return {
        finalText: result.finalText,
        providerResume: result.threadId ? `thread:${result.threadId}` : null,
        skipAssistantTranscript: true,
      }
    }

    const live = await openLive(sessionId, binary, authEnv, cwd)

    const fullTurn = async (): Promise<{
      finalText: string
      providerResume: string | null
      skipAssistantTranscript?: boolean
    }> => {
      const conn = liveBySession.get(sessionId)
      if (!conn) throw new Error('Codex connection disposed')

      try {
        // Always ensure the server-side thread on a fresh connection (or when
        // providerResume points at a different thread id).
        if (!conn.threadId || (priorThread && priorThread !== conn.threadId)) {
          conn.threadId = await ensureCodexThread({
            client: conn.client,
            cwd,
            threadId: priorThread ?? conn.threadId,
            threadConfig,
            signal: input.signal,
          })
        }

        if (turnKind === 'run') {
          const result = await openTurnAndStream({
            client: conn.client,
            prompt,
            cwd,
            threadId: conn.threadId!,
            model: input.model && input.model.trim() ? input.model.trim() : undefined,
            reasoningEffort,
            collaborationMode: input.collaborationMode,
            messageId: input.messageId,
            onAgentEvent: input.onAgentEvent,
            onDelta: input.onDelta,
            signal: input.signal,
            onTurnStarted: (turnId) => {
              conn.activeTurnId = turnId
            },
          })
          if (result.threadId) conn.threadId = result.threadId
          conn.activeTurnId = null
          return {
            finalText: result.finalText,
            providerResume: result.threadId ? `thread:${result.threadId}` : null,
          }
        }

        // review | compact
        const result = await runCodexAppServerTurn({
          client: conn.client,
          prompt: turnKind === 'compact' ? prompt || 'compact' : prompt,
          cwd,
          threadId: conn.threadId,
          model: input.model && input.model.trim() ? input.model.trim() : undefined,
          reasoningEffort,
          turnKind,
          collaborationMode: input.collaborationMode,
          reviewTarget: input.reviewTarget,
          skipThreadSetup: true,
          messageId: input.messageId,
          onAgentEvent: input.onAgentEvent,
          onDelta: input.onDelta,
          signal: input.signal,
          threadConfig,
        })
        if (result.threadId) conn.threadId = result.threadId
        conn.activeTurnId = null
        return {
          finalText: result.finalText,
          providerResume: result.threadId ? `thread:${result.threadId}` : null,
          skipAssistantTranscript: result.skipAssistantTranscript,
        }
      } catch (err) {
        conn.activeTurnId = null
        const msg = err instanceof Error ? err.message : String(err)
        if (/closed|exited|broken pipe|spawn failed/i.test(msg)) {
          await disposeLive(sessionId)
        }
        throw err
      }
    }

    const next = live.chain.then(fullTurn, fullTurn)
    live.chain = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  runner.disposeSession = async (sessionId) => {
    await disposeLive(sessionId)
  }
  runner.disposeAll = async () => {
    const ids = [...liveBySession.keys()]
    await Promise.all(ids.map((id) => disposeLive(id)))
  }

  return runner
}

/**
 * Production multi-dispatch: real Codex (Stage 4) + real Claude Agent SDK (Stage 5-E).
 * ACP / OpenCode: real process when SUPERONE_ACP_BINARY / SUPERONE_OPENCODE_BINARY
 * (or opts paths) exist; otherwise simulated (unless allowSimulatedFallback is false).
 * Cursor: `@superone/cursor` turn runner (SDK / simulated per allowSimulatedFallback).
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
    experimentalClaudeOpenAiChatEnabled: opts.experimentalClaudeOpenAiChatEnabled,
    createHostActionClaudeMcp: opts.createHostActionClaudeMcp,
    mcpMergeMode: opts.mcpMergeMode,
    homeDir: opts.homeDir,
  })
  const acpOpenCode = createAcpOpenCodeProductionRouter({
    allowSimulatedFallback: opts.allowSimulatedFallback,
    resolveProjectPath: opts.resolveProjectPath,
    acpBinaryPath: opts.acpBinaryPath,
    openCodeBinaryPath: opts.openCodeBinaryPath,
    getAcpMcpServers: opts.getAcpHostActionMcpServers,
    getOpenCodeSuperoneMcp: opts.getOpenCodeHostActionMcp,
  })
  const cursor = createCursorTurnRunner({
    allowSimulatedFallback: opts.allowSimulatedFallback,
    resolveProjectPath: opts.resolveProjectPath,
  })
  const simulated = createMultiHarnessRouter('codex')

  const runner: TurnRunner = async (input) => {
    const harnessId = input.session.harnessId || 'codex'
    if (harnessId === 'codex') return codex(input)
    if (harnessId === 'claude') return claude(input)
    if (harnessId === 'acp' || harnessId === 'opencode') return acpOpenCode(input)
    if (harnessId === 'cursor') return cursor(input)
    if (opts.allowSimulatedFallback) return simulated(input)
    throw new Error(
      `real node runner for harness ${harnessId} is not implemented yet (Stage 5-E supports codex + claude)`,
    )
  }

  runner.disposeSession = async (sessionId) => {
    await Promise.all([
      claude.disposeSession?.(sessionId),
      codex.disposeSession?.(sessionId),
    ])
  }
  runner.disposeAll = async () => {
    await Promise.all([claude.disposeAll?.(), codex.disposeAll?.()])
  }

  return runner
}
