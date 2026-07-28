/** Pretty-print a Codex model id/name for UI (e.g. `gpt-5.6-sol` → `GPT5.6 Sol`). */
export function formatCodexModelLabel(raw: string): string {
  const normalized = raw.trim().split('/').pop()?.trim() ?? raw.trim()
  if (!normalized) return raw
  const gptVersion = normalized.match(/^gpt[-_\s]?(\d+(?:\.\d+)*)(?:[-_\s]+(.+))?$/i)
  if (gptVersion) {
    const variant = gptVersion[2]
      ?.split(/[-_\s]+/)
      .filter(Boolean)
      .map((token) => `${token.charAt(0).toUpperCase()}${token.slice(1).toLowerCase()}`)
      .join(' ')
    return `GPT${gptVersion[1]}${variant ? ` ${variant}` : ''}`
  }
  const tokens = normalized
    .replace(/_/g, '-')
    .split(/[-\s]+/)
    .filter(Boolean)
  if (tokens.length === 0) return normalized
  const formatted = tokens.map((token) => {
    const lower = token.toLowerCase()
    if (lower === 'gpt') return 'GPT'
    if (/^\d+(\.\d+)*$/.test(token)) return token
    return `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`
  })
  if (formatted[0] === 'GPT' && /^\d+(\.\d+)*$/.test(formatted[1] ?? '')) {
    return [`${formatted[0]}${formatted[1]}`, ...formatted.slice(2)].join(' ')
  }
  return formatted.join('-')
}

/**
 * Prefer a non-empty display name; GPT-style labels still go through
 * {@link formatCodexModelLabel} so ids like `gpt-5.6-sol` match the chat selector.
 */
export function formatCodexModelName(name: string | undefined, id: string): string {
  const displayName = name?.trim()
  if (!displayName) return formatCodexModelLabel(id)
  return /^gpt[-_\s]?\d/i.test(displayName) ? formatCodexModelLabel(displayName) : displayName
}
