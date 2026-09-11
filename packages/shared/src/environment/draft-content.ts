export function hasPersistableDraftContent(draft: {
  text: string
  docJson?: object | null
  attachments?: readonly unknown[]
}): boolean {
  if (draft.text.trim() || draft.attachments?.length) return true
  const pending: unknown[] = [draft.docJson]
  const seen = new Set<object>()
  while (pending.length) {
    const node = pending.pop()
    if (!node || typeof node !== 'object') continue
    if (seen.has(node)) continue
    seen.add(node)
    const { type, text, attrs, content } = node as { type?: string; text?: string; attrs?: Record<string, unknown>; content?: unknown[] }
    if (type === 'text' && typeof text === 'string' && text.trim()) return true
    const value = type === 'pasteChip' ? attrs?.text : type === 'mention' ? attrs?.value : null
    if (typeof value === 'string' && value.trim()) return true
    if (Array.isArray(content)) pending.push(...content)
  }
  return false
}
