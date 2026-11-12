import type { HarnessId } from './harness-id'
import { resolveLegacyHarnessId } from './acp-brand'
import type { PromptKeyword } from '../prompt-keywords'
import type { HarnessRuntimeCapabilities } from './session-catalog'

/**
 * How a harness's session goal behaves. `null` on a harness means it has no goal
 * concept at all, so the composer, the indicator and the dialog stay out.
 *
 * Only differences that gate a real branch live here. Which *fields* a goal
 * carries (iterations, budget, phase) is self-describing on `SessionGoal` —
 * present means reported — so it is not restated as a flag.
 */
export interface GoalCapability {
  /**
   * Whole-arg `/goal` tokens the harness interprets itself. The composer passes
   * these through as plain text instead of opening the host dialog.
   */
  lifecycleArgs: readonly string[]
  /**
   * Has an explicit pause/resume lifecycle. False means the goal is either set
   * or gone, so the indicator must omit those controls rather than disable them.
   */
  canPause: boolean
  /**
   * How a set/clear reaches the harness: `slash` sends `/goal …` as ordinary
   * turn text, `rpc` calls a dedicated backend method.
   */
  transport: 'slash' | 'rpc'
  /**
   * What the user is actually writing. Claude wants a *condition* an evaluator
   * checks ("all tests pass"); Codex and Grok want an *objective* to pursue
   * ("migrate the auth module"). The two need different prompts and examples —
   * asking a Claude user for an objective teaches the wrong mental model.
   */
  semantics: 'objective' | 'condition'
}

/**
 * Static capability flags per harness. These describe what each harness's
 * backend actually supports — they are not user preferences. Consume from
 * UI render paths (e.g. "should we show the TODO panel for this session?")
 * and from store routing when a feature only makes sense for one harness.
 *
 * Adding a new capability:
 * 1. Add the field to HarnessCapabilities below.
 * 2. Set the right boolean for `claude` and `codex` in HARNESS_CAPABILITIES.
 * 3. Replace the corresponding `provider === 'codex'` check at the call site
 *    with `HARNESS_CAPABILITIES[provider].supportsXxx`.
 */
export interface HarnessCapabilities {
  /** Official-account realtime backend; host/native availability is negotiated separately. */
  supportsRealtimeVoice?: boolean
  /** Supports MCP server tool surface. */
  supportsMcp: boolean
  /** Has explicit plan/approve mode workflow. Both harnesses do, but the protocol differs. */
  supportsPlanMode: boolean
  /** Emits TODO list state via TodoWrite/TaskCreate/TaskUpdate tools. */
  supportsTodos: boolean
  /** Spawns subagent sessions (Agent tool). */
  supportsSubagents: boolean
  /** Has /compact thread-context compaction. */
  supportsCompact: boolean
  /** Streams content via streaming tool input previews (Edit/Write/etc). */
  supportsStreamingToolInput: boolean
  /** Can convert a SuperOne-held queued user message into an active-turn steer. */
  supportsQueuedSteer: boolean
  /**
   * Accepts working directories beyond the session cwd.
   *
   * Gates `/add-dir` and the workspace-folder UI: a harness without this reads
   * only its cwd, so offering the control would let a user configure something
   * that silently does nothing.
   */
  supportsAdditionalDirs: boolean
  /**
   * Can clone a conversation into an independent one that keeps the provider's
   * own context (`Harness.forkTranscript`).
   *
   * False means the harness has no transcript-fork API, so a "fork" would hand
   * back a session the agent has no memory of. Gates the fork entries and side
   * chat: offering them would look like it worked and silently lose everything.
   */
  supportsFork: boolean
  /**
   * Answers `session.contextUsage` with a live context breakdown after a turn.
   * False: the context ring reads only what the session's events reported.
   */
  supportsContextUsage: boolean
  /**
   * Cancel is a request the agent settles in its own time, not an immediate
   * abort: the Stop control keeps showing it is cancelling until the turn ends.
   */
  softCancel: boolean
  /**
   * Session-goal behaviour, or `null` when the harness has no goal concept.
   *
   * Grok ships a goal; Antigravity does not. Resolve through
   * {@link resolveGoalCapability}, which also accepts the legacy `acp` wire id.
   */
  goal: GoalCapability | null
  /**
   * Who authorizes a `terminal_tabs run` / `attach` command.
   *
   * `harness`: the tool is withheld from the harness's auto-allow projection, so the
   * harness's own permission layer (classifier, approval policy, yolo mode) sees the
   * command first; when it asks the host, the backend routes the request through the
   * terminal command gate. `executor`: the harness auto-approves MCP tools without a
   * host hook (Cursor), so the executor raises the gate itself before typing anything.
   */
  terminalCommandApproval: 'harness' | 'executor'
  /**
   * Can host Claude Code mods' interface (panes, the band above the prompt,
   * redrawn rows) through the CLI's remote-surface protocol. The per-session
   * runtime fact is the `mod_ui_state` event; this is the static ceiling.
   */
  modUi: boolean
  /**
   * `widget_show` answers a `widget_code` call with a short acknowledgement instead of the
   * render payload: the transcript carries the call's complete input, so surfaces render
   * the widget from it. Off where the reported input may be partial (ACP's `rawInput` is
   * optional), which keeps the full result.
   */
  supportsShortWidgetResult: boolean
  /**
   * The plugins settings page is a curated directory (shelves, categories, detail)
   * instead of the marketplace list.
   */
  supportsCuratedPluginDirectory: boolean
  /**
   * Each MCP tool can be set to allow, ask, or deny as a Claude Code permission
   * rule. Other harnesses have no equivalent settings-file rule for one tool.
   */
  supportsMcpToolPermissionRules: boolean
  /**
   * Words the harness acts on when they appear in the prompt text, for that turn
   * only. The composer highlights them; on any other harness they are plain text.
   */
  promptKeywords: readonly PromptKeyword[]
  /** User-facing display name for this harness. */
  displayName: string
}

const ACP_PROTOCOL_CAPABILITIES = {
  supportsMcp: true,
  supportsPlanMode: true,
  supportsTodos: true,
  supportsSubagents: false,
  supportsCompact: true,
  supportsStreamingToolInput: false,
  supportsQueuedSteer: true,
  supportsAdditionalDirs: true,
  supportsFork: true,
  supportsContextUsage: true,
  softCancel: true,
  terminalCommandApproval: 'harness' as const,
  modUi: false,
  supportsShortWidgetResult: false,
  supportsCuratedPluginDirectory: false,
  supportsMcpToolPermissionRules: false,
  promptKeywords: [] as const,
}

export const HARNESS_CAPABILITIES: Record<HarnessId, HarnessCapabilities> = {
  claude: {
    supportsMcp: true,
    supportsPlanMode: true,
    supportsTodos: true,
    supportsSubagents: true,
    supportsCompact: true,
    supportsStreamingToolInput: true,
    supportsQueuedSteer: true,
    // SDK `additionalDirectories`.
    supportsAdditionalDirs: true,
    // SDK `forkSession()` copies + remaps the transcript jsonl.
    supportsFork: true,
    supportsContextUsage: true,
    softCancel: false,
    // Built-in `/goal <condition>`: a Stop hook re-checks the condition after
    // each turn and keeps going until it is met, so there is no paused state —
    // the goal is either live or cleared.
    goal: { lifecycleArgs: ['clear'], canPause: false, transport: 'slash', semantics: 'condition' },
    terminalCommandApproval: 'harness',
    modUi: true,
    supportsShortWidgetResult: true,
    supportsCuratedPluginDirectory: false,
    supportsMcpToolPermissionRules: true,
    // `ultrathink` adds a deeper-reasoning reminder to the turn (effort is
    // untouched); `ultracode` opts it into the Workflow tool, on messages stamped
    // human — see `claudeMessageOrigin`.
    promptKeywords: ['ultrathink', 'ultracode'],
    displayName: 'Claude',
  },
  codex: {
    supportsRealtimeVoice: true,
    supportsMcp: true,
    supportsPlanMode: true,
    supportsTodos: false,
    supportsSubagents: false,
    supportsCompact: true,
    supportsStreamingToolInput: false,
    supportsQueuedSteer: true,
    // sandbox_workspace_write.writable_roots, re-sent every turn.
    supportsAdditionalDirs: true,
    // app-server thread fork, truncatable at a turn id.
    supportsFork: true,
    // Token usage arrives on the session snapshot only.
    supportsContextUsage: false,
    softCancel: false,
    // `thread/goal/{get,set,clear}` over the app server; SuperOne drives the
    // follow-up turns itself, so every transition is an explicit RPC.
    goal: { lifecycleArgs: [], canPause: true, transport: 'rpc', semantics: 'objective' },
    terminalCommandApproval: 'harness',
    modUi: false,
    supportsShortWidgetResult: true,
    supportsCuratedPluginDirectory: true,
    supportsMcpToolPermissionRules: false,
    promptKeywords: [],
    displayName: 'Codex',
  },
  'acp-grok': {
    ...ACP_PROTOCOL_CAPABILITIES,
    goal: {
      lifecycleArgs: ['status', 'pause', 'resume', 'clear'],
      canPause: true,
      transport: 'slash',
      semantics: 'objective',
    },
    displayName: 'Grok',
  },
  'acp-antigravity': {
    ...ACP_PROTOCOL_CAPABILITIES,
    goal: null,
    displayName: 'Antigravity',
  },
  opencode: {
    supportsMcp: true,
    supportsPlanMode: true,
    supportsTodos: true,
    supportsSubagents: true,
    supportsCompact: true,
    supportsStreamingToolInput: false,
    supportsQueuedSteer: false,
    // Single `directory` only.
    supportsAdditionalDirs: false,
    // Server-side `forkSession(id, anchor)` + `moveSession`.
    supportsFork: true,
    supportsContextUsage: true,
    softCancel: true,
    goal: null,
    terminalCommandApproval: 'harness',
    modUi: false,
    supportsShortWidgetResult: false,
    supportsCuratedPluginDirectory: false,
    supportsMcpToolPermissionRules: false,
    promptKeywords: [],
    displayName: 'OpenCode',
  },
  cursor: {
    supportsMcp: true,
    supportsPlanMode: true,
    // updateTodos / task tool deltas when event map lands (PR5+)
    supportsTodos: true,
    supportsSubagents: true,
    supportsCompact: false,
    supportsStreamingToolInput: true,
    supportsQueuedSteer: false,
    // Single cwd; multi-root parked in the harness design doc.
    supportsAdditionalDirs: false,
    // SDK has no transcript-fork API; the adapter creates a blank agent.
    supportsFork: false,
    supportsContextUsage: true,
    softCancel: false,
    goal: null,
    // The @cursor/sdk local executor auto-approves custom tools with no host hook.
    terminalCommandApproval: 'executor',
    modUi: false,
    supportsShortWidgetResult: false,
    supportsCuratedPluginDirectory: false,
    supportsMcpToolPermissionRules: false,
    promptKeywords: [],
    displayName: 'Cursor',
  },
  dsh: {
    // In-process dsh Cordis tree (docs/harness/dsh/deepseek-harness-integration.md).
    // Flags flip only when the corresponding event path is wired.
    // `supportsStreamingToolInput`: live `tool-call-delta` frames open the row
    // and stream its arguments before the durable `tool/call` completes it.
    // `supportsCompact`: `compaction-basic` compacts automatically at context
    // pressure and on provider overflow; `/compact` drives `compactNow()`.
    // `supportsMcp` covers both SuperOne's own tools (native dsh rows) and
    // third-party servers read from dsh's own profile patch layer.
    // `supportsSubagents`: foreground delegation (`dsh-tool-subagent` over the
    // in-process spawn provider), rendered as a Task block with the child's
    // steps nested under it. Background and continuable children are not wired.
    // `supportsPlanMode`: `plan` also turns on dsh plan mode; `exit_plan_mode`
    // reaches the plan-approval card through the user-questions seam.
    // `supportsQueuedSteer`: `agent.steer()` lands at the next step boundary
    // and never cancels a tool, so there is one steer and no separate "soon".
    supportsMcp: true,
    supportsPlanMode: true,
    supportsTodos: true,
    supportsSubagents: true,
    supportsCompact: true,
    supportsStreamingToolInput: true,
    supportsQueuedSteer: true,
    // Single cwd.
    supportsAdditionalDirs: false,
    // `runtime.forkSession` copies the log prefix up to an event seq.
    supportsFork: true,
    supportsContextUsage: false,
    softCancel: false,
    goal: null,
    terminalCommandApproval: 'harness',
    modUi: false,
    supportsShortWidgetResult: false,
    supportsCuratedPluginDirectory: false,
    supportsMcpToolPermissionRules: false,
    promptKeywords: [],
    displayName: 'DeepSeek',
  },
}

/** Runtime overrides belong only to the harness that advertised them. */
export function resolveHarnessCapabilities(harnessId: HarnessId, runtime?: HarnessRuntimeCapabilities): HarnessCapabilities {
  if (!runtime || runtime.harnessId !== harnessId) return HARNESS_CAPABILITIES[harnessId]
  const { harnessId: _owner, ...capabilities } = runtime
  return { ...HARNESS_CAPABILITIES[harnessId], ...capabilities }
}

/**
 * Every `/goal` lifecycle token any harness understands. Render paths that see
 * a message without knowing its harness (a `/goal …` user bubble) use this to
 * tell an objective from a `pause` / `clear`.
 */
export const ALL_GOAL_LIFECYCLE_ARGS: readonly string[] = [...new Set(
  Object.values(HARNESS_CAPABILITIES).flatMap((caps) => caps.goal?.lifecycleArgs ?? []),
)]

export function resolveGoalCapability(
  harnessId: string | null | undefined,
  acpAgentId?: string | null,
): GoalCapability | null {
  const resolved = resolveLegacyHarnessId(harnessId, { acpAgentId })
  if (!resolved) return null
  return HARNESS_CAPABILITIES[resolved].goal
}

/**
 * Whether `widget_show` answers this harness's `widget_code` calls with the short
 * acknowledgement. Takes any id a runtime reports; an unknown one keeps the full result.
 */
export function supportsShortWidgetResult(harnessId: string | null | undefined): boolean {
  return !!harnessId && Object.hasOwn(HARNESS_CAPABILITIES, harnessId)
    && HARNESS_CAPABILITIES[harnessId as HarnessId].supportsShortWidgetResult
}
