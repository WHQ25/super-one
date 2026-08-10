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

// Single source of truth for the browser tool surface: registerBrowserTools()
// registers exactly these, and they are spread into the permission-bypass list
// below. Keeping one list means a new tool cannot silently miss the bypass.
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
] as const

export const BROWSER_ACTION_TOOL_NAMES = [
  'browser_action_list',
  'browser_action_save',
  'browser_action_do',
] as const

export const BROWSER_TOOL_NAMES = [
  ...BROWSER_PRIMITIVE_TOOL_NAMES,
  ...BROWSER_ACTION_TOOL_NAMES,
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
  ...BROWSER_TOOL_NAMES,
] as const

export type BuiltInSuperoneToolName = (typeof BUILT_IN_SUPERONE_TOOL_NAMES)[number]

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
