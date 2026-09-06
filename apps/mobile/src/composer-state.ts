import { BUILTIN_CAPABILITIES, isBuiltinCapabilityId } from '@superone/shared/capability-prompt-tags'
import type { MentionItem } from './mentions'

export const IME_SETTLE_MS = 120

export function shouldSubmitFromKeyboard(opts: {
  hasContent: boolean
  lastTextChangeAt: number
  now: number
}): boolean {
  return opts.hasContent && opts.now - opts.lastTextChangeAt >= IME_SETTLE_MS
}

export function mergeMentionItems(query: string, remote: MentionItem[], capabilityIds?: unknown): MentionItem[] {
  const needle = query.toLowerCase()
  const available = new Set(Array.isArray(capabilityIds) ? capabilityIds.filter(isBuiltinCapabilityId) : ['widget', 'debug'])
  const builtins: MentionItem[] = BUILTIN_CAPABILITIES.filter((cap) => available.has(cap.id)
    && [cap.id, cap.displayName].some((label) => label.toLowerCase().includes(needle)))
    .map((cap) => ({ kind: 'builtin', path: cap.id, label: cap.displayName, description: cap.intent }))
  const seen = new Set(builtins.map((item) => `${item.kind}:${item.path}`))
  return [
    ...builtins,
    ...remote.filter((item) => {
      const key = `${item.kind}:${item.path}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }),
  ]
}
