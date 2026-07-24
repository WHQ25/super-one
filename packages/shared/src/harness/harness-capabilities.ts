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
    supportsMcp: false,
    supportsPlanMode: false,
    supportsTodos: false,
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
    supportsCompact: false,
    supportsStreamingToolInput: false,
    displayName: 'OpenCode',
  },
}
