import { createDefaultChatCoreSession } from './defaults'

const defaults = createDefaultChatCoreSession() as unknown as Record<string, unknown>

/** Snapshot overrides; receivers restore omitted fields from the same generation's defaults. */
export function compactChatCoreState(state: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(state).filter(([key, value]) =>
    !(key in defaults) || !equalsDefault(value, defaults[key])))
}

function equalsDefault(value: unknown, expected: unknown): boolean {
  if (value === expected) return true
  if (!value || !expected || typeof value !== 'object' || typeof expected !== 'object') return false
  if (Array.isArray(value) || Array.isArray(expected)) {
    return Array.isArray(value) && Array.isArray(expected) && value.length === expected.length &&
      value.every((item, index) => equalsDefault(item, expected[index]))
  }
  const entries = Object.entries(expected)
  return Object.keys(value).length === entries.length && entries.every(([key, item]) =>
    Object.hasOwn(value, key) && equalsDefault((value as Record<string, unknown>)[key], item))
}
