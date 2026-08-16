/** Built-in @-mention capabilities (collab / computer / browser / widget). */

export type BuiltinCapabilityId = 'collab' | 'computer' | 'browser' | 'widget'

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
   */
  toolPrefix: string
}

export const BUILTIN_CAPABILITIES: readonly BuiltinCapability[] = [
  {
    id: 'collab',
    displayName: 'Agents Collaboration',
    intent: 'spawn and coordinate child agent sessions via collaboration tools',
    toolPrefix: 'session_collab_',
  },
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
] as const

export const BUILTIN_CAPABILITY_IDS: readonly BuiltinCapabilityId[] = BUILTIN_CAPABILITIES.map((c) => c.id)

const byId = new Map(BUILTIN_CAPABILITIES.map((c) => [c.id, c]))

export function getBuiltinCapability(id: string): BuiltinCapability | undefined {
  return byId.get(id as BuiltinCapabilityId)
}

export function isBuiltinCapabilityId(id: string): id is BuiltinCapabilityId {
  return byId.has(id as BuiltinCapabilityId)
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
export function capabilityToolPrefixClaude(cap: BuiltinCapability): string {
  return `mcp__superone__${cap.toolPrefix}`
}

/** Codex-style qualified prefix (dot after server). */
export function capabilityToolPrefixCodex(cap: BuiltinCapability): string {
  return `mcp__superone.${cap.toolPrefix}`
}
