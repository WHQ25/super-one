/** Built-in @-mention capabilities (computer / browser / widget / debug). */

export type BuiltinCapabilityId = 'computer' | 'browser' | 'widget' | 'debug'

/**
 * Retired capability ids that still exist in stored messages.
 *
 * `collab` was replaced by naming the agent directly (`@codex`, `@grok`) — see
 * `@superone/shared/agent-mention-tags`. It is no longer offered in the popup
 * and no longer emits a reminder, but old user bubbles must keep rendering it
 * as a chip instead of leaking the raw tag.
 */
export type LegacyCapabilityId = 'collab'

export const LEGACY_CAPABILITY_IDS: readonly LegacyCapabilityId[] = ['collab'] as const

/** Any capability id that can appear in a persisted message. */
export type StoredCapabilityId = BuiltinCapabilityId | LegacyCapabilityId

export interface BuiltinCapability {
  id: BuiltinCapabilityId
  /** Stable English label stored in the serialized tag and shown as fallback. */
  displayName: string
  /** One-line intent for the agent reminder. */
  intent: string
  /**
   * Bare tool-name prefix after the server qualifier.
   * Claude: `mcp__superone__${toolPrefix}…`
   * Codex:  `mcp__superone.${toolPrefix}…` (dot after server — listed the same way as miniapp).
   * Omit when the capability is a manual/workflow (e.g. debug), not a tool family.
   */
  toolPrefix?: string
  /**
   * Replaces the default `tools start with "…"` reminder clause.
   * Use when the capability is not a tool-prefix family.
   */
  hint?: string
}

export const BUILTIN_CAPABILITIES: readonly BuiltinCapability[] = [
  {
    id: 'computer',
    displayName: 'Computer Use',
    intent: 'control the desktop UI via Computer Use tools',
    toolPrefix: 'computer_',
  },
  {
    id: 'browser',
    displayName: 'Super Browser',
    intent: 'automate the built-in browser via browser tools',
    toolPrefix: 'browser_',
  },
  {
    id: 'widget',
    displayName: 'Widget',
    intent: 'render SVG, diagrams, charts, or interactive HTML inline in chat via widget tools',
    toolPrefix: 'widget_',
  },
  {
    id: 'debug',
    displayName: 'Debug',
    intent: 'diagnose SuperOne bugs, gather logs, and help file an upstream issue when the user wants',
    hint:
      'first call read_manual({ domain: "product", topic: "debug" }); then read_manual({ domain: "product", topic: "contribute" }) only if they want to report upstream. If they have no GitHub account, draft the issue for them to copy — do not open a PR',
  },
] as const

export const BUILTIN_CAPABILITY_IDS: readonly BuiltinCapabilityId[] = BUILTIN_CAPABILITIES.map((c) => c.id)

const byId = new Map(BUILTIN_CAPABILITIES.map((c) => [c.id, c]))

export function getBuiltinCapability(id: string): BuiltinCapability | undefined {
  return byId.get(id as BuiltinCapabilityId)
}

export function isBuiltinCapabilityId(id: string): id is BuiltinCapabilityId {
  return byId.has(id as BuiltinCapabilityId)
}

const legacyIds = new Set<string>(LEGACY_CAPABILITY_IDS)

/** True for ids the composer can still insert AND ids only old messages carry. */
export function isStoredCapabilityId(id: string): id is StoredCapabilityId {
  return byId.has(id as BuiltinCapabilityId) || legacyIds.has(id)
}

export const CAPABILITY_TAG_REGEX =
  /<superone-capability>\s*<name>([\s\S]*?)<\/name>\s*<id>([\s\S]*?)<\/id>\s*<\/superone-capability>/g

export const CAPABILITY_REMINDER_REGEX =
  /\n*<superone-capability-reminder>[\s\S]*?<\/superone-capability-reminder>\n*/g

export function wrapCapabilityMention(id: BuiltinCapabilityId, displayName?: string): string {
  const cap = getBuiltinCapability(id)
  const name = displayName?.trim() || cap?.displayName || id
  return `<superone-capability><name>${name}</name><id>${id}</id></superone-capability>`
}

export function replaceCapabilityTagsWithMention(text: string): string {
  return text
    .replace(CAPABILITY_REMINDER_REGEX, '')
    .replace(CAPABILITY_TAG_REGEX, (_, name) => `@${String(name).trim()}`)
}

export function stripCapabilityMarkup(text: string): string {
  return text
    .replace(CAPABILITY_REMINDER_REGEX, '')
    .replace(CAPABILITY_TAG_REGEX, (_, name) => `@${String(name).trim()}`)
    .replace(/\s+/g, ' ')
    .trim()
}

/** Claude-style qualified prefix (double underscore). */
export function capabilityToolPrefixClaude(cap: BuiltinCapability): string | undefined {
  return cap.toolPrefix ? `mcp__superone__${cap.toolPrefix}` : undefined
}

/** Codex-style qualified prefix (dot after server). */
export function capabilityToolPrefixCodex(cap: BuiltinCapability): string | undefined {
  return cap.toolPrefix ? `mcp__superone.${cap.toolPrefix}` : undefined
}

export function formatCapabilityReminderLine(
  cap: BuiltinCapability,
  harness: 'claude' | 'codex',
): string {
  if (cap.hint) {
    return `- "${cap.displayName}" (${cap.intent}): ${cap.hint}`
  }
  const prefix = harness === 'codex'
    ? capabilityToolPrefixCodex(cap)
    : capabilityToolPrefixClaude(cap)
  return `- "${cap.displayName}" (${cap.intent}): tools start with "${prefix}"`
}
