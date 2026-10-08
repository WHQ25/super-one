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

import { assertMcpAppsBindingIdentity } from '@superone/shared/mcp-app-binding'
import { existsSync } from 'node:fs'
import type { Options } from '@anthropic-ai/claude-agent-sdk'
import {
  ClaudeLiveSession,
  applyRootPermissionGuard,
  resolveSdkClaudeBinary,
  type ClaudeQueryFn,
} from '@superone/claude'
import { ClaudeMcpAppsCatalog, ClaudeToolApps, createClaudeMcpAppsProvider } from '@superone/claude/mcp-apps'
import { mcpServerConfigFingerprint } from '@superone/runtime/mcp-apps/identity'
import type { AgentEvent, PermissionMode } from '@superone/shared/agent-types'
import { McpAppsError } from '@superone/shared/mcp-apps'
import { MOD_UI_MUTATING_OPS, MOD_UI_UNAVAILABLE } from '@superone/shared/mod-ui'
import { sdkSlashCommands } from '@superone/shared/slash-commands'
import { ModSurface, type ModSurfaceQuery } from '@superone/claude/mod-surface'
import { createSimulatedCodexRunner, type NodeSessionRecord, type TurnRunner } from '@superone/runtime/session'
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
  /** This node's environment id; MCP App bindings name it. */
  environmentId?: string
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
   * Node-local AskUserQuestion option-preview format (markdown | html), read from
   * this node's config.json — the controlling client does not push its own value.
   * Read when a live session is created; an existing live process keeps the format
   * it was opened with until it is rebuilt (cwd change / error).
   */
  askUserQuestionPreviewFormat?: () => string
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

  interface LiveEntry {
    live: ClaudeLiveSession
    hostActionDispose: (() => Promise<void>) | null
    cwd: string
    /** Sorted disk MCP names at open time — rebuild when mcp.save changes allowlist. */
    mcpDiskKey: string
    /** Sorted directory set at open time — ACP-style: only changes on restart. */
    additionalDirsKey: string
    /** Ultracode the process runs with; a turn that names another switches it live. */
    ultracode: boolean
    /** Model the process runs; a turn that names another switches it live. */
    model: string | undefined
    /** Effort the process was opened with; a turn that names another reopens it. */
    effort: string | undefined
    /**
     * The mode the process is in, as the CLI last reported it — a requested
     * mode it could not take (auto on a model without it) never lands here.
     */
    permissionMode: string | undefined
    /** Servers the live process was opened with; MCP App bindings fingerprint them. */
    mcpServers: Record<string, unknown>
    /** Tool UI metadata of this process, loaded on its first MCP tool call. */
    mcpAppsCatalog: ClaudeMcpAppsCatalog
    refreshMcpAppsCatalog: (force?: boolean) => Promise<void>
    /** Latest turn's sink; a process opened for an MCP App action has none yet. */
    onAmbientEvent?: (event: AgentEvent) => void
    /** The process's mod surface (Claude Code mods drawn by remote views). */
    modSurface: ModSurface | null
    /** Mod events raised before the first turn gave the entry a sink. */
    modBacklog: AgentEvent[]
    busyCount: number
    lastActivityAt: number
  }

  /** SuperOne sessionId → long-lived Claude process. */
  const lives = new Map<string, LiveEntry>()

  const disposeEntry = async (sessionKey: string): Promise<void> => {
    const entry = lives.get(sessionKey)
    if (!entry) return
    // While the entry is still live, so views hear `mod_ui_state: false`.
    entry.modSurface?.dispose()
    lives.delete(sessionKey)
    await entry.live.dispose().catch(() => undefined)
    await entry.hostActionDispose?.().catch(() => undefined)
  }

  const mcpDiskKeyOf = (diskNames: string[]): string =>
    [...diskNames].sort().join('\0')

  /**
   * `ClaudeLiveSession` fixes its directory set at open. Without this in the
   * restart predicate, changing a project's workspace folders mid-session is
   * silently ignored on a node — the edit reports success and does nothing.
   */
  const additionalDirsKeyOf = (dirs: readonly string[] | undefined): string =>
    [...new Set(dirs ?? [])].sort().join('\0')

  const trimmedOrUndefined = (value: string | null | undefined): string | undefined =>
    value && value.trim() ? value.trim() : undefined

  /**
   * The CLI reports its mode in each turn's init and in a status after every
   * change, including a fallback it picks itself. Clients hear when that differs
   * from the mode the process was believed to be in.
   */
  const followReportedMode = (
    entry: LiveEntry,
    event: AgentEvent,
    emit: ((event: AgentEvent) => void) | undefined,
  ): void => {
    const mode = event.type === 'session_init'
      ? event.session.permissionMode
      : event.type === 'status_indicator' ? event.permissionMode : undefined
    if (!mode || mode === entry.permissionMode) return
    entry.permissionMode = mode
    emit?.({ type: 'agent_setting_change', patch: { permissionMode: mode } })
  }

  const binaryOrNull = () =>
    resolveClaudeBinaryPath({
      binaryPath: opts.binaryPath,
      harnesses: opts.harnesses,
      skipSdkBinary: opts.skipSdkBinary,
    })

  /** Cwd, provider env and the root permission guard for one session. */
  const prepare = async (p: {
    session: NodeSessionRecord
    apiProviderId?: string | null
    permissionMode?: string | null
    sessionDir?: string
  }) => {
    const projectRoot =
      opts.resolveProjectPath(p.session.projectId) ||
      process.env.SUPERONE_DEFAULT_CWD ||
      process.cwd()
    const cwd = p.session.cwd && p.session.cwd.trim() ? p.session.cwd.trim() : projectRoot

    const providerEnv =
      opts.providers
        ? await buildHarnessEnvWithProxy(
            'claude',
            resolveHarnessService(opts.providers, 'claude', p.apiProviderId, {
              experimentalClaudeOpenAiChatEnabled: opts.experimentalClaudeOpenAiChatEnabled?.() ?? false,
            }),
          )
        : {}
    const authEnv: NodeJS.ProcessEnv = {
      ...process.env,
      ...opts.env,
      ...providerEnv,
      ...(p.sessionDir ? { SUPERONE_SESSION_DIR: p.sessionDir } : {}),
    }

    // Nodes commonly run as root (container / systemd). Claude Code exits
    // during spawn when a turn would skip permission prompts under uid 0, so
    // relax the turn instead of failing it, and tell the client what ran.
    const uid = opts.getuid ? opts.getuid() : process.getuid?.()
    const permissions = applyRootPermissionGuard({
      permissionMode: p.permissionMode ?? undefined,
      uid,
      env: authEnv as Record<string, string | undefined>,
    })
    return { cwd, authEnv, uid, permissions }
  }

  const openEntry = (p: {
    session: NodeSessionRecord
    binary: string
    cwd: string
    authEnv: NodeJS.ProcessEnv
    uid: number | undefined
    permissionMode?: string
    model?: string | null
    effort?: string | null
    sandboxMode?: string | null
    additionalDirectories?: string[]
    enabledSkills?: string[]
    disabledSkills?: string[]
    apiProviderId?: string | null
    ultracode?: boolean
  }): LiveEntry => {
    const sessionKey = p.session.sessionId
    const hostActionMcp = opts.createHostActionClaudeMcp?.(sessionKey) ?? null
    // Merge enabled project+user MCP (disk) with host-action superone.
    // strictMcpConfig stays true so only this allowlist is loaded.
    const merged = ensureMcpMerge({
      provider: 'claude',
      cwd: p.cwd,
      hostActionServers: hostActionMcp?.mcpServers as
        | Record<string, Record<string, unknown>>
        | undefined,
      mode: opts.mcpMergeMode,
      env: p.authEnv,
      homeDir: opts.homeDir,
    })
    const mcpOptions =
      Object.keys(merged.claudeMcpServers).length > 0
        ? {
            mcpServers: merged.claudeMcpServers as NonNullable<Options['mcpServers']>,
            strictMcpConfig: true as const,
          }
        : undefined
    const mcpAppsCatalog = new ClaudeMcpAppsCatalog()
    const refreshCatalog = (force = false) => {
      const query = lives.get(sessionKey)?.live.query
      return query
        ? mcpAppsCatalog.refresh(() => query.mcpServerStatus(), { force })
        : Promise.resolve()
    }
    const toolApps = new ClaudeToolApps({
      catalog: mcpAppsCatalog,
      binding: (server) => ({
        node: opts.environmentId ?? 'node',
        session: sessionKey,
        server,
        account: p.apiProviderId ?? undefined,
        configGeneration: 0,
        configFingerprint: mcpServerConfigFingerprint(merged.claudeMcpServers[server]),
      }),
      providerSessionId: () => lives.get(sessionKey)?.live.sessionId,
      onCatalogMiss: () => { void refreshCatalog() },
    })
    const live = ClaudeLiveSession.open({
      cwd: p.cwd,
      onAmbientEvent: (event) => {
        const current = lives.get(sessionKey)
        if (!current) return
        current.lastActivityAt = Date.now()
        followReportedMode(current, event, current.onAmbientEvent)
        current.onAmbientEvent?.(event)
      },
      binaryPath: p.binary,
      sessionId: parseClaudeSessionResume(p.session.providerResume),
      model: trimmedOrUndefined(p.model),
      effort: trimmedOrUndefined(p.effort),
      ultracode: p.ultracode,
      permissionMode: p.permissionMode,
      uid: p.uid,
      sandboxMode: p.sandboxMode && p.sandboxMode.trim() ? p.sandboxMode.trim() : undefined,
      askUserQuestionPreviewFormat: opts.askUserQuestionPreviewFormat?.(),
      additionalDirectories: p.additionalDirectories?.filter(Boolean),
      enabledSkills: resolveEnabledSkills(p.cwd, p.enabledSkills, p.disabledSkills),
      env: p.authEnv,
      queryFn: opts.queryFn,
      options: mcpOptions,
      toolApps,
      onSystem: (system) => lives.get(sessionKey)?.modSurface?.handleSystem(system) ?? false,
    })
    const entry: LiveEntry = {
      live,
      hostActionDispose: hostActionMcp ? () => hostActionMcp.dispose() : null,
      cwd: p.cwd,
      mcpDiskKey: mcpDiskKeyOf(merged.diskNames),
      additionalDirsKey: additionalDirsKeyOf(p.additionalDirectories?.filter(Boolean)),
      ultracode: p.ultracode ?? false,
      model: trimmedOrUndefined(p.model),
      effort: trimmedOrUndefined(p.effort),
      permissionMode: p.permissionMode,
      mcpServers: merged.claudeMcpServers,
      mcpAppsCatalog,
      refreshMcpAppsCatalog: refreshCatalog,
      modSurface: null,
      modBacklog: [],
      busyCount: 0,
      lastActivityAt: Date.now(),
    }
    lives.set(sessionKey, entry)
    if (live.query) {
      // Mod redraws are not activity: they reach the session's sink without
      // bumping `lastActivityAt`, so drawing never keeps an idle process alive.
      entry.modSurface = new ModSurface({
        query: live.query as unknown as ModSurfaceQuery,
        emit: (event) => {
          if (lives.get(sessionKey) !== entry) return
          if (entry.onAmbientEvent) entry.onAmbientEvent(event)
          else entry.modBacklog.push(event)
        },
      })
    }
    return entry
  }

  const runner: TurnRunner = async (input) => {
    const harnessId = input.session.harnessId || 'claude'
    if (harnessId !== 'claude') {
      throw new Error(
        `createNodeClaudeTurnRunner only handles harness claude (got ${harnessId})`,
      )
    }

    const binary = binaryOrNull()
    if (!binary) {
      if (opts.allowSimulatedFallback) return simulatedClaude(input)
      throw new Error(
        'Claude Agent SDK binary not available: reinstall optional platform package or set SUPERONE_CLAUDE_BINARY',
      )
    }

    const { cwd, authEnv, uid, permissions } = await prepare({
      session: input.session,
      apiProviderId: input.apiProviderId,
      permissionMode: input.permissionMode,
      sessionDir: input.sessionDir,
    })
    if (permissions.downgradedFrom) {
      input.onAgentEvent?.({
        type: 'agent_setting_change',
        patch: { permissionMode: permissions.permissionMode as PermissionMode },
      })
    }

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
    const nextAdditionalDirsKey = additionalDirsKeyOf(input.additionalDirectories?.filter(Boolean))

    let entry = lives.get(sessionKey)
    // A turn without a say (a host wake) keeps the Ultracode the process had,
    // across a restart too.
    const ultracode = input.ultracode ?? entry?.ultracode
    const model = trimmedOrUndefined(input.model)
    const effort = trimmedOrUndefined(input.effort)
    // Restart live session if cwd changed (worktree switch), the MCP allowlist
    // changed, the directory set changed, or the effort changed — an in-place
    // effort change would turn Ultracode off.
    if (
      entry
      && (entry.cwd !== cwd
        || entry.mcpDiskKey !== nextMcpDiskKey
        || entry.additionalDirsKey !== nextAdditionalDirsKey
        || (effort !== undefined && effort !== entry.effort))
    ) {
      await disposeEntry(sessionKey)
      entry = undefined
    }

    entry ??= openEntry({
      session: input.session,
      binary,
      cwd,
      authEnv,
      uid,
      permissionMode: permissions.permissionMode,
      model,
      effort,
      sandboxMode: input.sandboxMode,
      additionalDirectories: input.additionalDirectories,
      enabledSkills: input.enabledSkills,
      disabledSkills: input.disabledSkills,
      apiProviderId: input.apiProviderId,
      ultracode,
    })
    if (ultracode !== undefined && ultracode !== entry.ultracode) {
      await entry.live.setUltracode(ultracode)
      entry.ultracode = ultracode
      input.onAgentEvent?.({ type: 'agent_setting_change', patch: { ultracode } })
    }
    if (model !== undefined && model !== entry.model) {
      await entry.live.setModel(model)
      entry.model = model
    }
    const requestedMode = permissions.permissionMode
    if (requestedMode !== undefined && requestedMode !== entry.permissionMode) {
      // A mode the model cannot take is refused; the turn runs in the mode the
      // process is in, and the client is told which one that is.
      const switched = await entry.live.setPermissionMode(requestedMode).then(() => true, () => false)
      if (switched) entry.permissionMode = requestedMode
      else if (entry.permissionMode) {
        input.onAgentEvent?.({ type: 'agent_setting_change', patch: { permissionMode: entry.permissionMode as PermissionMode } })
      }
    }
    entry.onAmbientEvent = input.onAmbientEvent
    if (input.onAmbientEvent) for (const event of entry.modBacklog.splice(0)) input.onAmbientEvent(event)

    const prepared = prepareTurnPrompt(input.text, cwd, input.images)
    const content =
      prepared.kind === 'text' ? prepared.text : prepared.content

    const activeEntry = entry
    activeEntry.busyCount += 1
    activeEntry.lastActivityAt = Date.now()
    try {
      const result = await activeEntry.live.sendTurn({
        content,
        messageId: input.messageId,
        clientMessageId: input.messageId,
        // If live is already busy, ClaudeLiveSession queues with priority next.
        priorityNext: true,
        source: input.source,
        onInputAccepted: input.onInputAccepted,
        onDelta: input.onDelta,
        onEvent: input.onEvent,
        // Only when the caller listens: its presence selects the structured event path.
        onAgentEvent: input.onAgentEvent
          ? (event) => {
              followReportedMode(activeEntry, event, input.onAgentEvent)
              input.onAgentEvent!(event)
            }
          : undefined,
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
    } finally {
      activeEntry.busyCount = Math.max(0, activeEntry.busyCount - 1)
      activeEntry.lastActivityAt = Date.now()
    }
  }

  runner.getMcpAppsProvider = async (session, binding, origin) => {
    let entry = lives.get(session.sessionId)
    // The first tool result can open a View before the turn's resume identity
    // is persisted. An existing runtime is authoritative for this session.
    const providerSessionId = entry ? entry.live.sessionId : parseClaudeSessionResume(session.providerResume)
    if (
      (session.harnessId || 'claude') !== 'claude'
      || binding.session !== session.sessionId
      || origin.providerSessionId !== providerSessionId
    ) {
      throw new McpAppsError('inactive', 'MCP App session binding changed')
    }
    if (binding.account !== (session.apiProviderId ?? undefined)) throw new McpAppsError('not_connected', 'MCP App account changed')
    if (!entry) {
      // A View activated after the idle reaper released the process: reopen it
      // from the durable session defaults, as desktop revives its query.
      const binary = binaryOrNull()
      if (!binary) throw new McpAppsError('not_connected', 'Claude runtime unavailable')
      const { cwd, authEnv, uid, permissions } = await prepare({
        session,
        apiProviderId: session.apiProviderId,
        permissionMode: session.permissionMode,
      })
      entry = openEntry({
        session,
        binary,
        cwd,
        authEnv,
        uid,
        permissionMode: permissions.permissionMode,
        model: session.model,
        effort: session.effort,
        sandboxMode: session.sandboxMode,
        apiProviderId: session.apiProviderId,
      })
    }
    entry.lastActivityAt = Date.now()
    const current = entry
    const assertBinding = () => {
      if (lives.get(session.sessionId) !== current) throw new McpAppsError('inactive', 'MCP App runtime changed')
      assertMcpAppsBindingIdentity(binding, origin, {
        session: session.sessionId, providerSessionId: current.live.sessionId,
        account: session.apiProviderId, configFingerprint: mcpServerConfigFingerprint(current.mcpServers[binding.server]),
      })
    }
    assertBinding()
    return createClaudeMcpAppsProvider(binding, {
      assertBinding,
      query: async () => current.live.query,
      providerSessionId: () => current.live.sessionId,
      tools: async () => {
        await current.refreshMcpAppsCatalog(true)
        return current.mcpAppsCatalog.tools(binding.server) ?? new Map()
      },
      serverStatus: async () => {
        await current.refreshMcpAppsCatalog()
        return current.mcpAppsCatalog.status(binding.server)
      },
    })
  }

  runner.disposeSession = async (sessionId: string) => {
    await disposeEntry(sessionId)
  }

  runner.reloadPlugins = async () => {
    await Promise.all([...lives.values()].map(async (entry) => {
      const result = await entry.live.query?.reloadPlugins().catch(() => null)
      if (result) entry.onAmbientEvent?.({ type: 'session_commands', commands: sdkSlashCommands(result.commands, entry.live.terminalSlashCommands) })
    }))
  }

  // Like the desktop: an op never revives a released process; views redraw
  // when the next process announces `mod_ui_state`.
  runner.modUi = async (session, op, request) => {
    const entry = lives.get(session.sessionId)
    if (!entry?.modSurface) throw Object.assign(new Error('No live Claude runtime for this session'), { name: MOD_UI_UNAVAILABLE, code: 'unavailable' })
    if (MOD_UI_MUTATING_OPS.has(op)) entry.lastActivityAt = Date.now()
    return entry.modSurface.call(op, request)
  }

  runner.isModHostRequestPending = (sessionId, requestId) => lives.get(sessionId)?.modSurface?.isHostRequestPending(requestId) ?? false

  runner.disposeAll = async () => {
    const keys = [...lives.keys()]
    await Promise.all(keys.map((id) => disposeEntry(id)))
  }

  runner.listActiveRuntimes = () => [...lives.entries()].map(([sessionId, entry]) => ({
    sessionId,
    lastActivityAt: entry.lastActivityAt,
    busy: entry.busyCount > 0 || entry.live.isBusy || entry.live.hasActiveBackgroundTasks,
  }))

  return runner
}
