/**
 * Static SuperOne host-owned MCP tool-name judgement (Electron-free).
 *
 * Desktop layers computer-use feature gating on top of this core.
 * Mini-app tools (`slug__tool`) are NOT host-owned — they use preapproved.json.
 *
 * Single source of truth for static bare names: browser tool lists live here so
 * registration (desktop) and auto-approve (node + desktop) cannot drift.
 */

export const MCP_SUPERONE_TOOL_PREFIX = 'mcp__superone__' as const

// Single source of truth for the browser tool surface. Permission / execute
// accept the union; list/register advertise either the legacy 30-tool surface
// or the compact 8-tool surface (see resolveBrowserToolSurface).
export const BROWSER_PRIMITIVE_TOOL_NAMES = [
  'browser_snapshot',
  'browser_query',
  'browser_inspect',
  'browser_screenshot',
  'browser_click',
  'browser_hover',
  'browser_type',
  'browser_navigate',
  'browser_wait_for',
  'browser_press',
  'browser_scroll',
  'browser_drag',
  'browser_select',
  'browser_open',
  'browser_evaluate',
  'browser_tabs',
  'browser_resize',
  'browser_network_start',
  'browser_network_stop',
  'browser_network_wait',
  'browser_network_body',
  'browser_cookies',
  'browser_upload_file',
  'browser_download',
  'browser_list_downloads',
  'browser_emulate',
  'browser_mock',
  'browser_perf_measure',
] as const

export const BROWSER_ACTION_TOOL_NAMES = [
  'browser_action_list',
  'browser_action_save',
  'browser_action_do',
] as const

export const BROWSER_LEGACY_TOOL_NAMES = [
  ...BROWSER_PRIMITIVE_TOOL_NAMES,
  ...BROWSER_ACTION_TOOL_NAMES,
] as const

/** 9-tool surface: observe / query / act / wait + tabs / evaluate / network / perf / saved actions. */
export const BROWSER_COMPACT_TOOL_NAMES = [
  'browser_tabs',
  'browser_snapshot',
  'browser_query',
  'browser_act',
  'browser_wait_for',
  'browser_evaluate',
  'browser_network',
  'browser_perf',
  'browser_action',
] as const

export const BROWSER_TOOL_NAMES = [
  ...BROWSER_LEGACY_TOOL_NAMES,
  ...BROWSER_COMPACT_TOOL_NAMES.filter(
    (name) => !(BROWSER_LEGACY_TOOL_NAMES as readonly string[]).includes(name),
  ),
] as const

/**
 * Touch-device control (phones / tablets). Host-owned like the browser tools rather
 * than feature-gated like `computer_*`: these drive a simulator, which is a sandbox
 * the user opened on purpose, not the user's own desktop.
 *
 * The desktop side additionally hides them off macOS, but the name set is shared so
 * permission and registration cannot disagree about what exists.
 */
export const DEVICE_AGENT_TOOL_NAMES = [
  'device_snapshot',
  'device_query',
  'device_act',
  'device_wait_for',
] as const

/**
 * Bare tool names registered as SuperOne MCP builtins (desktop surface).
 * Keep in sync with tools registered on the SuperOne MCP surface.
 */
export const BUILT_IN_SUPERONE_TOOL_NAMES = [
  'read_manual',
  'miniapp_dev_setup',
  'miniapp_dev_register',
  'miniapp_dev_pack',
  'miniapp_dev_update_types',
  'session_rename',
  'session_tag',
  'session_tag_list',
  'project_list',
  'session_list',
  'session_search',
  'session_read',
  'session_cleanup',
  'session_collab_list_agents',
  'session_collab_request',
  'session_collab_start',
  'session_collab_send',
  'session_collab_retrieve',
  'media_list_providers',
  'media_generate_image',
  'media_generate_video',
  'media_video_status',
  'widget_list_templates',
  'widget_show',
  'config_read',
  'config_apply',
  'automation_list',
  'automation_apply',
  'automation_delete',
  ...BROWSER_TOOL_NAMES,
  ...DEVICE_AGENT_TOOL_NAMES,
] as const

export type BuiltInSuperoneToolName = (typeof BUILT_IN_SUPERONE_TOOL_NAMES)[number]

/** Tools only the top-level (user-facing) agent may call — not Task/subagent workers. */
export const MAIN_THREAD_ONLY_SUPERONE_TOOL_NAMES = ['session_rename', 'session_tag'] as const

export function superoneBareToolName(name: string): string {
  if (name.startsWith(MCP_SUPERONE_TOOL_PREFIX)) return name.slice(MCP_SUPERONE_TOOL_PREFIX.length)
  if (name.startsWith('superone__')) return name.slice('superone__'.length)
  return name
}

export function isMainThreadOnlySuperoneTool(name: string): boolean {
  return (MAIN_THREAD_ONLY_SUPERONE_TOOL_NAMES as readonly string[]).includes(superoneBareToolName(name))
}

export const MOBILE_SHARE_FILE_TOOL_NAME = 'mobile_share_file' as const

/** Fixed mini-app MCP tools — both host-owned at the harness layer. */
export const MINIAPP_LIST_BARE_NAME = 'miniapp_list' as const
export const MINIAPP_CALL_BARE_NAME = 'miniapp_call' as const

/**
 * Bare names that are always SuperOne host system tools (static builtins + mobile share + miniapp).
 * Does not include feature-gated computer_* (desktop gates those separately).
 */
export function isStaticHostOwnedSuperoneBareName(bare: string): boolean {
  if ((BUILT_IN_SUPERONE_TOOL_NAMES as readonly string[]).includes(bare)) return true
  if (bare === MOBILE_SHARE_FILE_TOOL_NAME) return true
  if (bare === MINIAPP_LIST_BARE_NAME) return true
  if (bare === MINIAPP_CALL_BARE_NAME) return true
  return false
}

/**
 * Qualified-name variant (`mcp__superone__…`) for Claude / node canUseTool short-circuit.
 */
export function isStaticHostOwnedSuperoneToolQualified(qualifiedName: string): boolean {
  if (!qualifiedName.startsWith(MCP_SUPERONE_TOOL_PREFIX)) return false
  const bare = qualifiedName.slice(MCP_SUPERONE_TOOL_PREFIX.length)
  return isStaticHostOwnedSuperoneBareName(bare)
}

/**
 * Qualified names of every statically host-owned tool, for harness-level allow
 * rules (Claude `allowedTools`, Codex per-tool approval, OpenCode pre-allow, …).
 *
 * Why this exists on top of the `isStaticHostOwned…` predicates: those only run
 * inside `canUseTool`, which the harness reaches *after* it has already decided
 * to prompt — in `auto` mode that means every SuperOne tool call first pays a
 * classifier round-trip, and a classifier deny never reaches us at all. Feeding
 * the same set to the harness as an allow rule matches upstream of the
 * classifier, so tools whose approval lives in our own executor (session_collab_
 * request, config_apply, miniapp_call, …) can no longer be intercepted.
 *
 * Derived from the lists above — never hand-maintain entries here. Feature-gated
 * computer_* is deliberately excluded: this list must stay static so it cannot
 * drift against a warm session spawned under different settings.
 */
export const STATIC_HOST_OWNED_SUPERONE_QUALIFIED_TOOL_NAMES: readonly string[] = [
  ...BUILT_IN_SUPERONE_TOOL_NAMES,
  MOBILE_SHARE_FILE_TOOL_NAME,
  MINIAPP_LIST_BARE_NAME,
  MINIAPP_CALL_BARE_NAME,
].map((bare) => `${MCP_SUPERONE_TOOL_PREFIX}${bare}`)
