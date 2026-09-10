import { expect, it } from 'vitest'
import type { ChatMessage } from '@superone/shared/agent-types'
import { extendHistoryIndex, mergeIndexedHistory } from '@superone/shared/session-history-index'
import { contiguousHistoryRange, globalHistoryRange, needsHistoryPage } from './history-navigation'
const row = (i: number): ChatMessage => ({ id: `m${i}`, role: i % 2 ? 'assistant' : 'user', providerId: 'claude', status: 'complete', createdAt: '', content: [{ type: 'text', text: `Text ${i}` }] })
const all = Array.from({ length: 100 }, (_, i) => row(i))
const index = extendHistoryIndex({ messageIds: [], entries: [], compacts: [] }, all)
it('keeps all fifty ticks while only eight messages are cached', () => {
  expect(extendHistoryIndex(index, all.slice(-8)).entries).toHaveLength(50)
})
it('does not mount across a gap and asks for the missing neighboring page', () => {
  const sparse = [...all.slice(18,26), ...all.slice(-8)]
  const range = { start: 0, end: 8 }
  expect(needsHistoryPage(sparse, index, range, 'after')).toBe(true)
  expect(needsHistoryPage(sparse, index, range, 'before')).toBe(true)
  expect(contiguousHistoryRange(sparse, index, { start: 0, end: 16 }, 3)).toEqual(range)
  expect(globalHistoryRange(sparse, index, range)).toEqual({ start: 18, end: 26 })
})
it('orders fetched pages without replacing newer live text', () => {
  const live = { ...row(99), content: [{ type: 'text' as const, text: 'Streaming update' }] }
  const merged = mergeIndexedHistory(index, [row(20),row(99)], [row(98),live])
  expect(merged.map(row => row.id)).toEqual(['m20','m98','m99'])
  expect(merged.at(-1)).toBe(live)
})
it('does not attach a reply from a different cached segment to an older question', () => {
  const base = { ...index, entries: index.entries.map(entry => ({ ...entry, reply: undefined })) }
  expect(extendHistoryIndex(base, [row(20), row(99)]).entries.find(entry => entry.id === 'm20')?.reply).toBeUndefined()
})
