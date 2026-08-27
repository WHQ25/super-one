/**
 * Single source of truth for SuperOne **host-owned** MCP bare tool names
 * (auto-approve at the harness permission layer).
 *
 * Static names + judgement live in `@superone/shared/superone-host-owned-tools`
 * so remote-node Claude can short-circuit without Electron. This module re-exports
 * that core and layers desktop-only computer-use feature gating.
 *
 * Keep static names in sync with tools registered on the SuperOne MCP surface
 * (`listSuperoneMcpTools` / `createSuperoneMcpServer`). Mini-app tools
 * (`miniapp_call`) are NOT host-owned — they use preapproved.json instead.
 *
 * Feature-gated tools:
 * - computer_*: recognized for rewrite always; auto-allow only when enabled
 * - mobile_share_file: always host-owned when present (session-gated registration)
 */

import {
  BUILT_IN_SUPERONE_TOOL_NAMES,
  MCP_SUPERONE_TOOL_PREFIX,
  MINIAPP_CALL_BARE_NAME,
  MINIAPP_LIST_BARE_NAME,
  MOBILE_SHARE_FILE_TOOL_NAME,
  isNeverAutoAllowSuperoneBareName,
  isStaticHostOwnedSuperoneBareName,
} from '@superone/shared/superone-host-owned-tools'
import {
  COMPUTER_USE_TOOL_NAMES,
  isComputerUseEnabled,
  normalizeComputerUseToolName,
} from '../computer-use/tools'
import { isWebMcpEnabled } from '../browser/browser-webmcp'

export {
  MCP_SUPERONE_TOOL_PREFIX,
  isStaticHostOwnedSuperoneBareName,
}

/** Deprecated alias still registered on the MCP server for one release. */
const COMPUTER_USE_REGISTERED_ALIASES = ['computer_observe'] as const
/**
 * `browser_tools_list` is read-only reconnaissance, auto-allowed like `browser_snapshot` once
 * WebMCP is on — the host's own site-trust gate is what actually guards it. `browser_tools_call`
 * is excluded everywhere via {@link isNeverAutoAllowSuperoneBareName}.
 */
const WEBMCP_AUTO_ALLOW_TOOL_NAMES = new Set(['browser_tools_list'])

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
  if (isNeverAutoAllowSuperoneBareName(bare)) return false
  if (WEBMCP_AUTO_ALLOW_TOOL_NAMES.has(bare)) return isWebMcpEnabled()
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
    ...BUILT_IN_SUPERONE_TOOL_NAMES.filter(
      (name) => !isNeverAutoAllowSuperoneBareName(name)
        && (!WEBMCP_AUTO_ALLOW_TOOL_NAMES.has(name) || isWebMcpEnabled()),
    ),
    MOBILE_SHARE_FILE_TOOL_NAME,
    MINIAPP_LIST_BARE_NAME,
    MINIAPP_CALL_BARE_NAME,
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
    MINIAPP_LIST_BARE_NAME,
    MINIAPP_CALL_BARE_NAME,
    ...COMPUTER_USE_TOOL_NAMES,
    ...COMPUTER_USE_REGISTERED_ALIASES,
  ]
}
