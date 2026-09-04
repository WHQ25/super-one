import type { MentionItem } from './mentions'

export const IME_SETTLE_MS = 120

const BUILTIN_MENTIONS: MentionItem[] = [
  { kind: 'builtin', path: 'widget', label: '@widget' },
  { kind: 'builtin', path: 'debug', label: '@debug' },
  { kind: 'agent', path: 'claude', label: '@claude' },
  { kind: 'agent', path: 'codex', label: '@codex' },
  { kind: 'agent', path: 'grok', label: '@grok' },
]

export function shouldSubmitFromKeyboard(opts: {
  hasContent: boolean
  lastTextChangeAt: number
  now: number
}): boolean {
  return opts.hasContent && opts.now - opts.lastTextChangeAt >= IME_SETTLE_MS
}

export function mergeMentionItems(query: string, remote: MentionItem[]): MentionItem[] {
  const needle = query.toLowerCase()
  const builtins = BUILTIN_MENTIONS.filter((item) => item.path.toLowerCase().includes(needle))
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
