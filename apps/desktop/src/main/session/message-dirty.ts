import type { ChatMessage } from '@superone/shared/agent-types'

/**
 * Ids whose message object reference changed (or appeared) between two arrays.
 * Relies on reducers preserving identity for unchanged messages.
 */
export function collectChangedMessageIds(
  prev: readonly ChatMessage[],
  next: readonly ChatMessage[],
): string[] {
  if (prev === next) return []
  const prevById = new Map(prev.map((m) => [m.id, m]))
  const changed: string[] = []
  for (const m of next) {
    const p = prevById.get(m.id)
    if (!p || p !== m) changed.push(m.id)
  }
  return changed
}
