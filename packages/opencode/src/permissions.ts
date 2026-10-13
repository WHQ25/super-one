import type { PermissionRuleset } from '@opencode-ai/sdk/v2'
import {
  BUILT_IN_SUPERONE_TOOL_NAMES,
  MINIAPP_LIST_BARE_NAME,
  MINIAPP_CALL_BARE_NAME,
  STATIC_HOST_OWNED_SUPERONE_QUALIFIED_TOOL_NAMES,
  isNeverAutoAllowSuperoneBareName,
} from '@superone/shared/superone-host-owned-tools'
const SUPERONE_MCP_NAME = 'superone'
const nodeNames = [...BUILT_IN_SUPERONE_TOOL_NAMES, MINIAPP_LIST_BARE_NAME, MINIAPP_CALL_BARE_NAME].filter(
  (name) => !isNeverAutoAllowSuperoneBareName(name),
)
const recognizedNames = STATIC_HOST_OWNED_SUPERONE_QUALIFIED_TOOL_NAMES.map((name) =>
  name.replace(/^mcp__superone__/, ''),
)

export function buildOpenCodeHostPermissionRules(names: readonly string[] = nodeNames): PermissionRuleset {
  return names.map((name) => ({
    permission: `${SUPERONE_MCP_NAME}_${name}`,
    pattern: '*',
    action: 'allow' as const,
  }))
}

/** Remove the old SuperOne preset overlay, keeping native session rules intact. */
export function reconcileOpenCodePermissions(
  existing: PermissionRuleset = [],
  names: readonly string[] = nodeNames,
  recognized: readonly string[] = recognizedNames,
): PermissionRuleset {
  const hostNames = new Set(recognized.map((name) => `${SUPERONE_MCP_NAME}_${name}`))
  const isHostAllow = (rule: PermissionRuleset[number]) =>
    rule.action === 'allow' && rule.pattern === '*' && hostNames.has(rule.permission)
  const first = existing[0]
  const legacyPreset =
    first?.permission === '*' &&
    first.pattern === '*' &&
    existing
      .slice(1)
      .every(
        (rule) =>
          isHostAllow(rule) ||
          (rule.action === 'allow' &&
            rule.pattern === '*' &&
            (rule.permission === 'question' || rule.permission === 'edit')),
      )
  const nativeRules = legacyPreset ? [] : existing.filter((rule) => !isHostAllow(rule))
  return [...nativeRules, ...buildOpenCodeHostPermissionRules(names)]
}
