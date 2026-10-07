import type { ChatMessage } from '@superone/shared/agent-types'
import { upsertCodexItem } from '@superone/chat-core'
export { sessionMessageBlocksToChatMessages } from '@superone/shared/node-message-catalog'

/**
 * Merge node denser catalog with local streamed messages.
 *
 * Backbone rule:
 * - When **local is at least as long** as catalog (typical switch back to an
 *   in-memory multi-turn session), keep **local chronological order** and only
 *   densify matching ids. Catalog-first used to treat a newest-page *suffix*
 *   as the full timeline and append early local turns at the end — early agent
 *   replies vanished from the head of the thread after session switch.
 * - When **catalog is longer** (cold open / local only has the latest turn),
 *   keep catalog order; local still wins on id match when richer.
 */
export function preferCatalogMessages(
  localMessages: ChatMessage[],
  catalogMessages: ChatMessage[],
): ChatMessage[] {
  if (catalogMessages.length === 0) return localMessages
  if (localMessages.length === 0) return catalogMessages

  const pickRicher = (local: ChatMessage, cat: ChatMessage): ChatMessage => {
    const chosen = local.role === 'user' && cat.contexts?.length ? cat : local.content.length >= cat.content.length ? local : cat
    const message = { ...chosen, contexts: chosen.contexts ?? cat.contexts ?? local.contexts, attachments: chosen.attachments ?? cat.attachments ?? local.attachments }
    if (!cat.metadata && !local.metadata) return message
    const catalogCodex = cat.metadata?.codex
    const localCodex = local.metadata?.codex
    // Text snapshots and native Codex items are independent. Equal-length
    // transcript content must not discard the catalog's durable item rows.
    // Keep catalog order, add local-only items, and preserve newer live items
    // while hydration races the stream. Completed catalog items are canonical.
    const catalogItems = catalogCodex?.items ?? []
    const catalogIds = new Set(catalogItems.map(item => item.id))
    const items = (localCodex?.items ?? []).reduce((current, item) =>
      local.status === 'streaming' || !catalogIds.has(item.id) ? upsertCodexItem(current, item) : current, catalogItems)
    return { ...message, metadata: { ...local.metadata, ...cat.metadata,
      ...(catalogCodex || localCodex ? { codex: { threadId: null, usage: null, ...localCodex, ...catalogCodex, items } } : {}),
    } }
  }

  // Local timeline is complete enough — preserve order, densify by id.
  if (localMessages.length >= catalogMessages.length) {
    const catById = new Map(catalogMessages.map((m) => [m.id, m] as const))
    const localIds = new Set(localMessages.map((m) => m.id))
    const result = localMessages.map((local) => {
      const cat = catById.get(local.id)
      return cat ? pickRicher(local, cat) : local
    })
    // Catalog-only assistants (stream gap) — append; skip catalog-only users
    // (node blockIds diverge from clientMessageId; local already has the bubble).
    for (const cat of catalogMessages) {
      if (localIds.has(cat.id)) continue
      if (cat.role === 'assistant') result.push(cat)
    }
    return result
  }

  // Catalog has more history than local — catalog order, richer local by id.
  const localById = new Map(localMessages.map((m, i) => [m.id, i] as const))
  const usedLocal = new Set<number>()
  const result: ChatMessage[] = []

  for (const cat of catalogMessages) {
    const localAt = localById.get(cat.id)
    if (localAt !== undefined) {
      usedLocal.add(localAt)
      result.push(pickRicher(localMessages[localAt]!, cat))
    } else {
      result.push(cat)
    }
  }
  for (let i = 0; i < localMessages.length; i++) {
    if (!usedLocal.has(i)) result.push(localMessages[i]!)
  }
  return result
}
