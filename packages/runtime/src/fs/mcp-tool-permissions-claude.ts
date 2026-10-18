/**
 * Per-tool permission rules for Claude MCP tools — electron-free.
 *
 * A tool's rule is its exact `mcp__{server}__{tool}` name in a settings file's
 * `permissions.allow|ask|deny`. Claude Code merges every layer and checks deny,
 * then ask, then allow, so the strictest list holding the name decides.
 */

import type { McpToolPermission, ResourceScope } from '@superone/shared/agent-types'
import { claudeMcpToolRuleName } from '@superone/shared/tool-ui'
import {
  getLocalSettingsPath,
  getUserSettingsPath,
  readJsonObject,
  settingsLayers,
  writeSettingsJson,
  type ClaudeSettingsFileOptions,
} from './claude-settings-files'

/** Claude Code's evaluation order. */
const PERMISSION_LISTS: readonly McpToolPermission[] = ['deny', 'ask', 'allow']

function permissionsOf(data: Record<string, unknown>): Record<string, unknown> {
  const p = data.permissions
  return p && typeof p === 'object' && !Array.isArray(p) ? p as Record<string, unknown> : {}
}

function ruleList(permissions: Record<string, unknown>, list: McpToolPermission): unknown[] {
  const rules = permissions[list]
  return Array.isArray(rules) ? rules : []
}

/** Effective permission of every exact MCP tool rule that applies to `cwd`, keyed by rule name. */
export function listClaudeMcpToolPermissions(cwd: string, opts?: ClaudeSettingsFileOptions): Record<string, McpToolPermission> {
  const lists = new Map<McpToolPermission, Set<string>>(PERMISSION_LISTS.map((l) => [l, new Set()]))
  for (const file of settingsLayers(cwd, opts)) {
    const permissions = permissionsOf(readJsonObject(file))
    for (const list of PERMISSION_LISTS) {
      for (const rule of ruleList(permissions, list)) {
        if (typeof rule === 'string' && rule.startsWith('mcp__')) lists.get(list)!.add(rule)
      }
    }
  }
  const result: Record<string, McpToolPermission> = {}
  for (const list of PERMISSION_LISTS) {
    for (const rule of lists.get(list)!) result[rule] ??= list
  }
  return result
}

/**
 * Sets a tool's rule, or clears it with `null`. The exact rule is removed from
 * every layer first so no other file outranks the choice; the new rule goes to
 * user settings for user and claude.ai servers, else the project's local settings.
 */
export function setClaudeMcpToolPermission(
  cwd: string,
  serverName: string,
  toolName: string,
  permission: McpToolPermission | null,
  scope: ResourceScope,
  opts?: ClaudeSettingsFileOptions,
): void {
  const rule = claudeMcpToolRuleName(serverName, toolName)
  const target = scope === 'project' && cwd ? getLocalSettingsPath(cwd) : getUserSettingsPath(opts)
  for (const file of new Set([...settingsLayers(cwd, opts), target])) {
    const data = readJsonObject(file)
    const permissions = permissionsOf(data)
    let changed = false
    const next: Record<string, unknown> = { ...permissions }
    for (const list of PERMISSION_LISTS) {
      const rules = ruleList(permissions, list)
      const kept = rules.filter((r) => r !== rule)
      if (kept.length !== rules.length) {
        next[list] = kept
        changed = true
      }
    }
    if (file === target && permission) {
      next[permission] = [...ruleList(next, permission), rule]
      changed = true
    }
    if (changed) writeSettingsJson(file, { ...data, permissions: next })
  }
}
