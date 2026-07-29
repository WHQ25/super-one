/**
 * SuperOne Computer Use — harness injection matrix.
 *
 * Every harness must end up with the same six `computer_*` tools when
 * `computerUseEnabled` is true. There are two SuperOne MCP surfaces:
 *
 * | Surface | Used by | How tools appear |
 * |---|---|---|
 * | `listSuperoneMcpTools` (stdio IPC tools/list) | Codex stdio bridge floor refresh, ACP stdio, OpenCode stdio, any IPC client | Dynamic each list call |
 * | `createSuperoneMcpServer` + `registerComputerUseTools` | Claude in-process, Codex/OpenCode/ACP HTTP initialize | Registered at server create |
 *
 * When the setting toggles, main must:
 * 1. close HTTP MCP sessions (force re-initialize with current tool set)
 * 2. mark sessions needsRebuild for harnesses that snapshot MCP at start
 * 3. notifySessionToolsChanged (stdio re-list + codex reload / next-turn rebuild)
 */

import { COMPUTER_USE_TOOL_NAMES } from './tools'

export const COMPUTER_USE_HARNESS_IDS = ['claude', 'codex', 'acp', 'opencode'] as const
export type ComputerUseHarnessId = (typeof COMPUTER_USE_HARNESS_IDS)[number]

/** Qualified Claude-style names: mcp__superone__computer_apps, … */
export function computerUseQualifiedNames(): string[] {
  return COMPUTER_USE_TOOL_NAMES.map((n) => `mcp__superone__${n}`)
}

export function isComputerUseQualifiedName(name: string): boolean {
  if (!name.startsWith('mcp__superone__')) return false
  const bare = name.slice('mcp__superone__'.length)
  return (COMPUTER_USE_TOOL_NAMES as readonly string[]).includes(bare)
}

export function bareComputerUseToolNames(): readonly string[] {
  return COMPUTER_USE_TOOL_NAMES
}

/**
 * Harness-specific recovery after computerUseEnabled toggles.
 * Keep in sync with applyAppSettingsPatch in main/index.ts.
 */
export function harnessRecoveryForComputerUseToggle(harnessId: string): {
  markNeedsRebuild: boolean
  closeHttpSessions: boolean
  notifyToolsChanged: boolean
} {
  // All known harnesses need a fresh MCP tool set. Codex/ACP ignore
  // tools/list_changed for the thread snapshot, so markNeedsRebuild is required
  // so the next user turn rebuilds and re-snapshots. Claude/OpenCode bake tools
  // into createSuperoneMcpServer at start — same rebuild flag.
  const known = (COMPUTER_USE_HARNESS_IDS as readonly string[]).includes(harnessId)
  return {
    markNeedsRebuild: known,
    closeHttpSessions: known,
    notifyToolsChanged: true,
  }
}
