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
    displayName: 'Claude',
  },
  codex: {
    supportsMcp: false,
    supportsPlanMode: true,
    supportsTodos: false,
    supportsSubagents: false,
    supportsCompact: true,
    supportsStreamingToolInput: false,
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
    displayName: 'Others',
  },
  opencode: {
    supportsMcp: true,
    supportsPlanMode: true,
    supportsTodos: true,
    supportsSubagents: true,
    supportsCompact: true,
    supportsStreamingToolInput: false,
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
    displayName: 'Cursor',
  },
  dsh: {
    // In-process dsh Cordis tree (docs/draft/deepseek-harness-integration.md).
    // Flags flip only when the corresponding event path is wired:
    // mcp → dsh-mcp-client mount (P4), streaming tool input →
    // tool-call-delta mapping, subagents (P4), compact (compaction-basic).
    supportsMcp: false,
    supportsPlanMode: false,
    supportsTodos: true,
    supportsSubagents: false,
    supportsCompact: false,
    supportsStreamingToolInput: false,
    displayName: 'DeepSeek',
  },
}
