import type { HarnessId } from './harness-id'

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
   * Accepts working directories beyond the session cwd.
   *
   * Gates `/add-dir` and the workspace-folder UI: a harness without this reads
   * only its cwd, so offering the control would let a user configure something
   * that silently does nothing.
   */
  supportsAdditionalDirs: boolean
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
    // SDK `additionalDirectories`.
    supportsAdditionalDirs: true,
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
    // sandbox_workspace_write.writable_roots, re-sent every turn.
    supportsAdditionalDirs: true,
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
    supportsCompact: false,
    supportsStreamingToolInput: false,
    supportsQueuedSteer: false,
    // session/new additionalDirectories, gated per agent capability.
    supportsAdditionalDirs: true,
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
    // Single `directory` only.
    supportsAdditionalDirs: false,
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
    // Single cwd.
    supportsAdditionalDirs: false,
    displayName: 'DeepSeek',
  },
}
