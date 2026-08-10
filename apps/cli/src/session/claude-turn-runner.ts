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
import type { Options } from '@anthropic-ai/claude-agent-sdk'
import {
  ClaudeLiveSession,
  applyRootPermissionGuard,
  resolveSdkClaudeBinary,
  type ClaudeQueryFn,
} from '@superone/claude'
import type { PermissionMode } from '@superone/shared/agent-types'
import { createSimulatedCodexRunner, type TurnRunner } from '@superone/runtime/session'
import type { HarnessCatalogReader } from '@superone/runtime/harness'
import type { ProviderStore } from '../provider/provider-store'
import { buildHarnessEnvWithProxy, resolveHarnessService } from '../provider/resolve-service'
import { prepareTurnPrompt } from './turn-attachments'
import {
  discoverClaudeSkillsAndCommands,
  ensureMcpMerge,
  type McpMergeMode,
} from '@superone/runtime/fs'

export const CLAUDE_SESSION_RESUME_PREFIX = 'claude-session:'

export interface NodeClaudeRunnerOptions {
  binaryPath?: string | null
  resolveProjectPath: (projectId: string) => string | null
  harnesses?: HarnessCatalogReader
  env?: NodeJS.ProcessEnv
  /** Injectable SDK query for tests (no real Claude process). */
  queryFn?: ClaudeQueryFn
  allowSimulatedFallback?: boolean
  /** Tests only: do not fall back to Agent SDK bundled binary. */
  skipSdkBinary?: boolean
  /** Node provider store — injects API keys for this turn. */
  providers?: ProviderStore
  /** Re-read per turn so settings.patch takes effect without restarting the node. */
  experimentalClaudeOpenAiChatEnabled?: () => boolean
  /**
   * Host Action MCP for this session.
   * Prefer in-process SDK MCP (type: 'sdk'). Bound to the long-lived
   * ClaudeLiveSession — dispose only when the live process is torn down
   * (error rebuild, cwd change), not after every turn.
   */
  createHostActionClaudeMcp?: (sessionId: string) => {
    mcpServers: NonNullable<Options['mcpServers']>
    dispose: () => Promise<void>
  } | null
  /**
   * MCP merge mode. Default: merge enabled user/project MCP from disk into
   * `options.mcpServers` while keeping `strictMcpConfig: true` (allowlist).
   * Set `host-action-only` or env `SUPERONE_MCP_MERGE=0` to attach only
   * SuperOne host-action MCP.
   */
  mcpMergeMode?: McpMergeMode
  /** Override home for MCP user-scope paths (tests). */
  homeDir?: string
  /** Effective uid of this node process (tests). Defaults to `process.getuid`. */
  getuid?: () => number | undefined
}

export function resolveClaudeBinaryPath(opts: {
  binaryPath?: string | null
  harnesses?: HarnessCatalogReader
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

/**
 * Desktop parity: when the user disables skills, Claude gets an explicit allow-list.
 * Prefer `enabledSkills` from the client; otherwise discover on the node cwd and
 * subtract `disabledSkills`.
 */
export function resolveEnabledSkills(
  cwd: string,
  enabledSkills?: string[] | null,
  disabledSkills?: string[] | null,
): string[] | undefined {
  if (enabledSkills && enabledSkills.length > 0) {
    return enabledSkills.map((s) => s.trim()).filter(Boolean)
  }
  if (!disabledSkills || disabledSkills.length === 0) return undefined
  const disabled = new Set(disabledSkills.map((s) => s.trim()).filter(Boolean))
  try {
    const { skills } = discoverClaudeSkillsAndCommands(cwd)
    const all = skills.map((s) => s.name).filter(Boolean)
    return all.filter((n) => !disabled.has(n))
  } catch {
    return undefined
  }
}

/**
 * Production Claude turn runner with **long-lived SDK sessions** (desktop parity).
 *
 * First turn opens `ClaudeLiveSession` (MessageBridge + continuous query).
 * Concurrent sends inject with `priority: 'next'` into the same process instead
 * of spawning a new Agent SDK subprocess per message.
 */
export function createNodeClaudeTurnRunner(opts: NodeClaudeRunnerOptions): TurnRunner {
  const simulatedClaude = createSimulatedCodexRunner({
    delayMs: 15,
    chunks: ['[claude] ', 'done'],
  })

  /** SuperOne sessionId → long-lived Claude process. */
  const lives = new Map<
    string,
    {
      live: ClaudeLiveSession
      hostActionDispose: (() => Promise<void>) | null
      cwd: string
      /** Sorted disk MCP names at open time — rebuild when mcp.save changes allowlist. */
      mcpDiskKey: string
    }
  >()

  const disposeEntry = async (sessionKey: string): Promise<void> => {
    const entry = lives.get(sessionKey)
    if (!entry) return
    lives.delete(sessionKey)
    await entry.live.dispose().catch(() => undefined)
    await entry.hostActionDispose?.().catch(() => undefined)
  }

  const mcpDiskKeyOf = (diskNames: string[]): string =>
    [...diskNames].sort().join('\0')

  const runner: TurnRunner = async (input) => {
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
        ? await buildHarnessEnvWithProxy(
            'claude',
            resolveHarnessService(opts.providers, 'claude', input.apiProviderId, {
              experimentalClaudeOpenAiChatEnabled: opts.experimentalClaudeOpenAiChatEnabled?.() ?? false,
            }),
          )
        : {}
    const authEnv: NodeJS.ProcessEnv = {
      ...process.env,
      ...opts.env,
      ...providerEnv,
    }

    // Nodes commonly run as root (container / systemd). Claude Code exits
    // during spawn when a turn would skip permission prompts under uid 0, so
    // relax the turn instead of failing it, and tell the client what ran.
    const uid = opts.getuid ? opts.getuid() : process.getuid?.()
    const permissions = applyRootPermissionGuard({
      permissionMode: input.permissionMode,
      uid,
      env: authEnv as Record<string, string | undefined>,
    })
    if (permissions.downgradedFrom) {
      input.onAgentEvent?.({
        type: 'agent_setting_change',
        patch: { permissionMode: permissions.permissionMode as PermissionMode },
      })
    }

    const priorSession = parseClaudeSessionResume(input.session.providerResume)
    const sessionKey = input.session.sessionId

    // Probe disk MCP before (re)opening so mcp.save after a live session starts
    // is picked up on the next turn (strict allowlist is fixed at open).
    // diskNames does not depend on host-action servers — skip creating them here.
    const mergedProbe = ensureMcpMerge({
      provider: 'claude',
      cwd,
      mode: opts.mcpMergeMode,
      env: authEnv,
      homeDir: opts.homeDir,
    })
    const nextMcpDiskKey = mcpDiskKeyOf(mergedProbe.diskNames)

    let entry = lives.get(sessionKey)
    // Restart live session if cwd changed (worktree switch) or MCP allowlist changed.
    if (entry && (entry.cwd !== cwd || entry.mcpDiskKey !== nextMcpDiskKey)) {
      await entry.live.dispose().catch(() => undefined)
      await entry.hostActionDispose?.().catch(() => undefined)
      lives.delete(sessionKey)
      entry = undefined
    }

    if (!entry) {
      const hostActionMcp =
        opts.createHostActionClaudeMcp?.(input.session.sessionId) ?? null
      // Merge enabled project+user MCP (disk) with host-action superone.
      // strictMcpConfig stays true so only this allowlist is loaded.
      const merged = ensureMcpMerge({
        provider: 'claude',
        cwd,
        hostActionServers: hostActionMcp?.mcpServers as
          | Record<string, Record<string, unknown>>
          | undefined,
        mode: opts.mcpMergeMode,
        env: authEnv,
        homeDir: opts.homeDir,
      })
      const mcpOptions =
        Object.keys(merged.claudeMcpServers).length > 0
          ? {
              mcpServers: merged.claudeMcpServers as NonNullable<Options['mcpServers']>,
              strictMcpConfig: true as const,
            }
          : undefined
      const live = ClaudeLiveSession.open({
        cwd,
        binaryPath: binary,
        sessionId: priorSession,
        model: input.model && input.model.trim() ? input.model.trim() : undefined,
        effort: input.effort && input.effort.trim() ? input.effort.trim() : undefined,
        permissionMode: permissions.permissionMode,
        uid,
        sandboxMode:
          input.sandboxMode && input.sandboxMode.trim()
            ? input.sandboxMode.trim()
            : undefined,
        additionalDirectories: input.additionalDirectories?.filter(Boolean),
        enabledSkills: resolveEnabledSkills(cwd, input.enabledSkills, input.disabledSkills),
        env: authEnv,
        queryFn: opts.queryFn,
        options: mcpOptions,
      })
      entry = {
        live,
        hostActionDispose: hostActionMcp ? () => hostActionMcp.dispose() : null,
        cwd,
        mcpDiskKey: mcpDiskKeyOf(merged.diskNames),
      }
      lives.set(sessionKey, entry)
    }

    const prepared = prepareTurnPrompt(input.text, cwd, input.images)
    const content =
      prepared.kind === 'text' ? prepared.text : prepared.content

    try {
      const result = await entry.live.sendTurn({
        content,
        messageId: input.messageId,
        clientMessageId: input.messageId,
        // If live is already busy, ClaudeLiveSession queues with priority next.
        priorityNext: true,
        onDelta: input.onDelta,
        onEvent: input.onEvent,
        onAgentEvent: input.onAgentEvent,
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
        onQuestion: input.onQuestion
          ? async (req) =>
              input.onQuestion!({
                interactionId: req.interactionId,
                kind: 'question',
                toolName: req.toolName,
                toolUseId: req.toolUseId,
                input: req.input,
                createdAt: Date.now(),
              })
          : undefined,
        onPlan: input.onPlan
          ? async (req) =>
              input.onPlan!({
                interactionId: req.interactionId,
                kind: 'plan',
                toolName: req.toolName,
                toolUseId: req.toolUseId,
                input: req.input,
                createdAt: Date.now(),
              })
          : undefined,
        signal: input.signal,
      })

      return {
        finalText: result.finalText,
        providerResume: formatClaudeSessionResume(result.sessionId),
      }
    } catch (err) {
      // Drop broken live session so the next turn reopens cleanly.
      await disposeEntry(sessionKey)
      throw err
    }
  }

  runner.disposeSession = async (sessionId: string) => {
    await disposeEntry(sessionId)
  }

  runner.disposeAll = async () => {
    const keys = [...lives.keys()]
    await Promise.all(keys.map((id) => disposeEntry(id)))
  }

  return runner
}
