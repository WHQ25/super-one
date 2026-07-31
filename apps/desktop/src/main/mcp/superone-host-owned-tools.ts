/**
 * Single source of truth for SuperOne **host-owned** MCP bare tool names
 * (auto-approve at the harness permission layer).
 *
 * Keep this in sync with tools registered on the SuperOne MCP surface
 * (`listSuperoneMcpTools` / `createSuperoneMcpServer`). Mini-app tools
 * (`slug__tool`) are NOT host-owned — they use preapproved.json instead.
 *
 * Feature-gated tools:
 * - computer_*: recognized for rewrite always; auto-allow only when enabled
 * - mobile_share_file: always host-owned when present (session-gated registration)
 */

import {
  BUILT_IN_SUPERONE_TOOL_NAMES,
  MOBILE_SHARE_FILE_TOOL_NAME,
} from './superone-mcp-builtin-defs'
import {
  COMPUTER_USE_TOOL_NAMES,
  isComputerUseEnabled,
  normalizeComputerUseToolName,
} from '../computer-use/tools'

export const MCP_SUPERONE_TOOL_PREFIX = 'mcp__superone__' as const

/** Deprecated alias still registered on the MCP server for one release. */
const COMPUTER_USE_REGISTERED_ALIASES = ['computer_observe'] as const

/**
 * Bare names that are always SuperOne host system tools (static builtins + mobile share).
 * Does not include feature-gated computer_* (use {@link isHostOwnedSuperoneBareName}).
 */
export function isStaticHostOwnedSuperoneBareName(bare: string): boolean {
  if ((BUILT_IN_SUPERONE_TOOL_NAMES as readonly string[]).includes(bare)) return true
  if (bare === MOBILE_SHARE_FILE_TOOL_NAME) return true
  return false
}

/**
 * Whether a bare tool name (no mcp__superone__ prefix) is SuperOne host-owned.
 * Used by Codex elicitation rewrite so toolName becomes a qualified name that
 * {@link isBuiltInSuperoneToolQualified} can match.
 *
 * Computer tools are recognized even when the feature is off so rewrite still
 * works; auto-allow remains gated by {@link isBuiltInSuperoneToolQualified}.
 */
export function isHostOwnedSuperoneBareName(bare: string): boolean {
  if (isStaticHostOwnedSuperoneBareName(bare)) return true
  if (normalizeComputerUseToolName(bare) != null) return true
  return false
}

export function toQualifiedSuperoneToolName(bare: string): string {
  return `${MCP_SUPERONE_TOOL_PREFIX}${bare}`
}

/**
 * Claude / Codex / ACP auto-allow check for qualified names
 * (`mcp__superone__…`). Mini-app tools return false here (use preapprove).
 */
export function isBuiltInSuperoneToolQualified(qualifiedName: string): boolean {
  if (!qualifiedName.startsWith(MCP_SUPERONE_TOOL_PREFIX)) return false
  const bare = qualifiedName.slice(MCP_SUPERONE_TOOL_PREFIX.length)
  if (isStaticHostOwnedSuperoneBareName(bare)) return true
  if (isComputerUseEnabled() && normalizeComputerUseToolName(bare) != null) return true
  return false
}

/**
 * Bare names to pre-allow in OpenCode permission rules for the current settings.
 * Mobile share is always listed (harmless if the tool is not registered).
 * Computer tools only when Computer Use is enabled.
 */
export function listOpenCodeAutoAllowSuperoneBareNames(): string[] {
  const names: string[] = [
    ...BUILT_IN_SUPERONE_TOOL_NAMES,
    MOBILE_SHARE_FILE_TOOL_NAME,
  ]
  if (isComputerUseEnabled()) {
    names.push(...COMPUTER_USE_TOOL_NAMES)
    names.push(...COMPUTER_USE_REGISTERED_ALIASES)
  }
  return names
}

/** Test/debug: every bare name we consider host-owned for rewrite (incl. computer when off). */
export function listAllHostOwnedSuperoneBareNamesForRecognition(): string[] {
  return [
    ...BUILT_IN_SUPERONE_TOOL_NAMES,
    MOBILE_SHARE_FILE_TOOL_NAME,
    ...COMPUTER_USE_TOOL_NAMES,
    ...COMPUTER_USE_REGISTERED_ALIASES,
  ]
}
