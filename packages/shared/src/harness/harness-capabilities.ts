import type { HarnessId } from './harness-id'
import { isGrokAcpAgent } from './acp-brand'

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
   * On top of {@link supportsQueuedSteer}, can deliver a queued message at the
   * turn's next safe boundary *without* aborting the tool in flight.
   *
   * Claude only: the SDK's `priority: 'next'` parks the message in the CLI's own
   * command queue, which drains between steps. `priority: 'now'` (plain steer)
   * aborts instead. Codex's steer has no such middle setting — its Core queue
   * item either interrupts or waits for the whole turn.
   */
  supportsQueuedSteerSoon: boolean
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
   * Session-goal behaviour, or `null` when the harness has no goal concept.
   *
   * ACP is a container, not one agent: the entry here describes Grok, the only
   * ACP agent that ships a goal. Resolve through {@link resolveGoalCapability}
   * so the per-agent check lives in one named place.
   */
  goal: GoalCapability | null
  /** User-facing display name for this harness. */
  displayName: string
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
    supportsQueuedSteerSoon: true,
    // SDK `additionalDirectories`.
    supportsAdditionalDirs: true,
    // SDK `forkSession()` copies + remaps the transcript jsonl.
    supportsFork: true,
    // Built-in `/goal <condition>`: a Stop hook re-checks the condition after
    // each turn and keeps going until it is met, so there is no paused state —
    // the goal is either live or cleared.
    goal: { lifecycleArgs: ['clear'], canPause: false, transport: 'slash', semantics: 'condition' },
    displayName: 'Claude',
  },
  codex: {
    supportsMcp: true,
    supportsPlanMode: true,
    supportsTodos: false,
    supportsSubagents: false,
    supportsCompact: true,
    supportsStreamingToolInput: false,
    supportsQueuedSteer: true,
    // Core's queue item either interrupts the turn or waits it out.
    supportsQueuedSteerSoon: false,
    // sandbox_workspace_write.writable_roots, re-sent every turn.
    supportsAdditionalDirs: true,
    // app-server thread fork, truncatable at a turn id.
    supportsFork: true,
    // `thread/goal/{get,set,clear}` over the app server; SuperOne drives the
    // follow-up turns itself, so every transition is an explicit RPC.
    goal: { lifecycleArgs: [], canPause: true, transport: 'rpc', semantics: 'objective' },
    displayName: 'Codex',
  },
  acp: {
    // Host injects SuperOne MCP on every ACP session; user MCP attach is a separate gap.
    supportsMcp: true,
    // Agent-driven plan + x.ai/exit_plan_mode approval is shipped (not host enter-plan).
    supportsPlanMode: true,
    // ACP session/update plan entries map to todo_write-style UI events.
    supportsTodos: true,
    supportsSubagents: false,
    // Host intercepts `/compact` → `x.ai/compact_conversation`.
    supportsCompact: true,
    supportsStreamingToolInput: false,
    // Mid-turn send / queued steer → `x.ai/interject` (next safe point, no abort).
    supportsQueuedSteer: true,
    supportsQueuedSteerSoon: true,
    // session/new additionalDirectories, gated per agent capability.
    supportsAdditionalDirs: true,
    // Cold `x.ai/session/fork` copies Grok session files; SuperOne then resumes the child.
    supportsFork: true,
    // Grok only — see `resolveGoalCapability`. The agent owns the loop and
    // reports back over `goal_updated`; the host just posts `/goal …` lines.
    goal: {
      lifecycleArgs: ['status', 'pause', 'resume', 'clear'],
      canPause: true,
      transport: 'slash',
      semantics: 'objective',
    },
    displayName: 'Others',
  },
  opencode: {
    supportsMcp: true,
    supportsPlanMode: true,
    supportsTodos: true,
    supportsSubagents: true,
    supportsCompact: true,
    supportsStreamingToolInput: false,
    supportsQueuedSteer: false,
    supportsQueuedSteerSoon: false,
    // Single `directory` only.
    supportsAdditionalDirs: false,
    // Server-side `forkSession(id, anchor)` + `moveSession`.
    supportsFork: true,
    goal: null,
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
    supportsQueuedSteerSoon: false,
    // Single cwd; multi-root parked in the harness design doc.
    supportsAdditionalDirs: false,
    // SDK has no transcript-fork API; the adapter creates a blank agent.
    supportsFork: false,
    goal: null,
    displayName: 'Cursor',
  },
  dsh: {
    // In-process dsh Cordis tree (docs/draft/deepseek-harness-integration.md).
    // Flags flip only when the corresponding event path is wired: streaming
    // tool input → tool-call-delta mapping.
    // `supportsCompact`: `compaction-basic` compacts automatically at context
    // pressure and on provider overflow; `/compact` drives `compactNow()`.
    // `supportsMcp` covers both SuperOne's own tools (native dsh rows) and
    // third-party servers read from dsh's own profile patch layer.
    // `supportsSubagents`: foreground delegation (`dsh-tool-subagent` over the
    // in-process spawn provider), rendered as a Task block with the child's
    // steps nested under it. Background and continuable children are not wired.
    supportsMcp: true,
    supportsPlanMode: false,
    supportsTodos: true,
    supportsSubagents: true,
    supportsCompact: true,
    supportsStreamingToolInput: false,
    supportsQueuedSteer: false,
    supportsQueuedSteerSoon: false,
    // Single cwd.
    supportsAdditionalDirs: false,
    // `runtime.forkSession` copies the log prefix up to an event seq.
    supportsFork: true,
    goal: null,
    displayName: 'DeepSeek',
  },
}

/**
 * Goal capability for a session, accounting for ACP being a container.
 *
 * `HARNESS_CAPABILITIES.acp.goal` describes Grok; any other ACP agent has no
 * goal surface, so it resolves to `null`. Every render/composer path should go
 * through here rather than testing the harness id, so the one agent-level
 * exception stays in a single named place.
 */
export function resolveGoalCapability(
  harnessId: HarnessId | null | undefined,
  acpAgentId?: string | null,
): GoalCapability | null {
  if (!harnessId) return null
  if (harnessId === 'acp') {
    return isGrokAcpAgent(acpAgentId) ? HARNESS_CAPABILITIES.acp.goal : null
  }
  return HARNESS_CAPABILITIES[harnessId]?.goal ?? null
}
