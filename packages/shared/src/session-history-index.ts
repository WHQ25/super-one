import type { ChatMessage } from './agent-types'
import { extractTurnOutline, type TurnOutlineEntry } from './turn-outline'

/** Navigation metadata only. IDs also describe gaps between cached message pages. */
export interface SessionHistoryIndex {
  messageIds: string[]
  entries: TurnOutlineEntry[]
  compacts: { id: string; index: number }[]
}
export const HISTORY_PREVIEW_LENGTH = 160

export function extendHistoryIndex(base: SessionHistoryIndex, messages: ChatMessage[]): SessionHistoryIndex {
  const messageIds = [...base.messageIds]
  const positions = new Map(messageIds.map((id, index) => [id, index]))
  for (const message of messages) {
    if (!positions.has(message.id)) { positions.set(message.id, messageIds.length); messageIds.push(message.id) }
  }
  const entries = new Map(base.entries.map(entry => [entry.id, entry]))
  const runs: ChatMessage[][] = []
  for (const message of messages) {
    const run = runs.at(-1)
    if (!run || positions.get(message.id)! !== positions.get(run.at(-1)!.id)! + 1) runs.push([message])
    else run.push(message)
  }
  for (const entry of runs.flatMap(extractTurnOutline)) {
    entries.set(entry.id, { ...entries.get(entry.id), ...entry, index: positions.get(entry.id)!,
      text: entry.text.slice(0, HISTORY_PREVIEW_LENGTH),
      reply: entry.reply?.slice(0, HISTORY_PREVIEW_LENGTH) ?? entries.get(entry.id)?.reply })
  }
  const compacts = new Map(base.compacts.map(entry => [entry.id, entry]))
  for (const message of messages) {
    const block = message.content[0]
    if (message.providerId === 'system' && block?.type === 'text' && /^__compact__:(manual|auto):\d+(?::\d*:\d*)?$/.test(block.text)) {
      compacts.set(message.id, { id: message.id, index: positions.get(message.id)! })
    }
  }
  return { messageIds, entries: [...entries.values()].sort((a, b) => a.index - b.index),
    compacts: [...compacts.values()].sort((a, b) => a.index - b.index) }
}

/** Existing rows may contain newer streaming data than a database page. */
export function mergeIndexedHistory(index: SessionHistoryIndex, page: ChatMessage[], current: ChatMessage[]): ChatMessage[] {
  const rows = new Map([...page, ...current].map(message => [message.id, message]))
  const ordered = index.messageIds.flatMap(id => {
    const row = rows.get(id)
    if (!row) return []
    rows.delete(id)
    return [row]
  })
  return [...ordered, ...rows.values()]
}
