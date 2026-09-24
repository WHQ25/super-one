import type { ChatMessage } from './agent-types'
import { extractTurnOutline, type TurnOutlineEntry } from './turn-outline'

/** Navigation metadata only. IDs also describe gaps between cached message pages. */
export interface SessionHistoryIndex {
  messageIds: string[]
  entries: TurnOutlineEntry[]
  compacts: { id: string; index: number }[]
}
export const HISTORY_PREVIEW_LENGTH = 160

const indexPositions = new WeakMap<SessionHistoryIndex, ReadonlyMap<string, number>>()

/** An index is never mutated, so its id → position map is built once per index. */
function positionsOf(index: SessionHistoryIndex): ReadonlyMap<string, number> {
  let positions = indexPositions.get(index)
  if (!positions) {
    positions = new Map(index.messageIds.map((id, position) => [id, position]))
    indexPositions.set(index, positions)
  }
  return positions
}

export interface HistoryPositions {
  /** Global position of a loaded or indexed row; undefined for anything else. */
  get(id: string): number | undefined
  /** Loaded rows the index does not know yet, in their appended order. */
  appended: string[]
}

/**
 * Where loaded rows sit on the session timeline: indexed rows keep their index
 * position, and rows newer than the index follow it in load order.
 */
export function historyPositions(index: SessionHistoryIndex | null, messages: readonly ChatMessage[]): HistoryPositions {
  const indexed = index ? positionsOf(index) : new Map<string, number>()
  const base = index?.messageIds.length ?? 0
  const added = new Map<string, number>()
  for (const message of messages) {
    if (!indexed.has(message.id) && !added.has(message.id)) added.set(message.id, base + added.size)
  }
  return { get: id => indexed.get(id) ?? added.get(id), appended: [...added.keys()] }
}

export function extendHistoryIndex(base: SessionHistoryIndex, messages: ChatMessage[]): SessionHistoryIndex {
  const positions = historyPositions(base, messages)
  const messageIds = [...base.messageIds, ...positions.appended]
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
