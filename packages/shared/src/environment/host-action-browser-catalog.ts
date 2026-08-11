/**
 * Host Action catalog for the full SuperOne MCP tool surface.
 *
 * Descriptors (name / description / JSON Schema) are dumped from desktop
 * listSuperoneMcpTools + computer use + widgets + mobile share so remote
 * discovery matches local SuperOne. Classification (toolGroup + replayPolicy)
 * is owned here.
 */

import {
  DEFAULT_HOST_ACTION_TOOL_GROUPS,
  HOST_ACTION_TOOL_GROUPS,
  type HostActionReplayPolicy,
  type HostActionToolGroup,
} from './host-actions'
import {
  HOST_ACTION_SUPERONE_TOOL_DESCRIPTORS,
  type HostActionSuperoneToolDescriptor,
} from './host-action-superone-descriptors'

export {
  HOST_ACTION_SUPERONE_TOOL_DESCRIPTORS,
  type HostActionSuperoneToolDescriptor,
} from './host-action-superone-descriptors'

export type HostActionBrowserToolDescriptor = HostActionSuperoneToolDescriptor

export interface HostActionBrowserToolEntry extends HostActionSuperoneToolDescriptor {
  toolGroup: HostActionToolGroup
  replayPolicy: HostActionReplayPolicy
}

/** Read-only browser tools — claim TTL may requeue. */
const BROWSER_READ_NAMES = new Set<string>([
  'browser_snapshot',
  'browser_query',
  'browser_inspect',
  'browser_screenshot',
  'browser_tabs',
  'browser_list_downloads',
  'browser_network_body',
  'browser_network_wait',
  'browser_action_list',
])

/** Mutating browser tools — claim TTL cancels (no requeue). */
const BROWSER_ACT_PREFIX = 'browser_'

/** Computer Use tools. */
const COMPUTER_PREFIX = 'computer_'

/**
 * Node-local SuperOne tools (SessionRuntime collab service).
 * Never advertised as Host Actions — remote agents call them in-process on the node.
 */
export const NODE_LOCAL_SUPERONE_TOOL_NAMES = [
  'session_collab_list_agents',
  'session_collab_request',
  'session_collab_start',
  'session_collab_send',
  'session_collab_retrieve',
] as const

export type NodeLocalSuperoneToolName = (typeof NODE_LOCAL_SUPERONE_TOOL_NAMES)[number]

export function isNodeLocalSuperoneTool(name: string): boolean {
  return (NODE_LOCAL_SUPERONE_TOOL_NAMES as readonly string[]).includes(name)
}

/** Read-only / idempotent SuperOne tools outside browser. */
const SUPERONE_READ_NAMES = new Set<string>([
  'read_manual',
  'config_read',
  'media_list_providers',
  'media_video_status',
  'widget_list_templates',
  'miniapp_list',
  'automation_list',
  // session_collab_* are node-local (not HA); list_agents stays "safe" if ever reclassified
  'computer_apps',
  'computer_snapshot',
  'computer_zoom',
  'computer_query',
  'computer_wait_for',
])

export function classifyHostActionTool(name: string): {
  toolGroup: HostActionToolGroup
  replayPolicy: HostActionReplayPolicy
} {
  if (BROWSER_READ_NAMES.has(name)) {
    return {
      toolGroup: HOST_ACTION_TOOL_GROUPS.browserRead,
      replayPolicy: 'safe',
    }
  }
  if (name.startsWith(BROWSER_ACT_PREFIX)) {
    return {
      toolGroup: HOST_ACTION_TOOL_GROUPS.browserAct,
      replayPolicy: 'unsafe',
    }
  }
  if (name.startsWith(COMPUTER_PREFIX)) {
    const safe = SUPERONE_READ_NAMES.has(name)
    return {
      toolGroup: HOST_ACTION_TOOL_GROUPS.computer,
      replayPolicy: safe ? 'safe' : 'unsafe',
    }
  }
  // session_*, media generate, config_apply, miniapp_*, widget_show, mobile_share, …
  const safe = SUPERONE_READ_NAMES.has(name)
  return {
    toolGroup: HOST_ACTION_TOOL_GROUPS.superone,
    replayPolicy: safe ? 'safe' : 'unsafe',
  }
}

/** @deprecated Use {@link classifyHostActionTool}. */
export function classifyHostActionBrowserTool(name: string) {
  return classifyHostActionTool(name)
}

/** Full SuperOne Host Action tool list (discovery + policy), excluding node-local tools. */
export const HOST_ACTION_BROWSER_TOOL_CATALOG: HostActionBrowserToolEntry[] =
  HOST_ACTION_SUPERONE_TOOL_DESCRIPTORS.filter((d) => !isNodeLocalSuperoneTool(d.name)).map(
    (d) => {
      const cls = classifyHostActionTool(d.name)
      return {
        ...d,
        toolGroup: cls.toolGroup,
        replayPolicy: cls.replayPolicy,
      }
    },
  )

/** Alias preferred name for the full surface catalog. */
export const HOST_ACTION_SUPERONE_TOOL_CATALOG = HOST_ACTION_BROWSER_TOOL_CATALOG

export function listHostActionBrowserTools(): HostActionBrowserToolEntry[] {
  return HOST_ACTION_BROWSER_TOOL_CATALOG
}

export function listHostActionSuperoneTools(): HostActionBrowserToolEntry[] {
  return HOST_ACTION_SUPERONE_TOOL_CATALOG
}

export { DEFAULT_HOST_ACTION_TOOL_GROUPS }
