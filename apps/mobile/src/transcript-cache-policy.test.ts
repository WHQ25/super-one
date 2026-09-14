import { expect, it } from 'vitest'
import type { CachedTranscript } from '@superone/relay-client'
import { trimTranscriptForCache } from './transcript-cache-policy'

it('moves the older-history cursor with the retained suffix, including a previously complete history', () => {
  const transcript: CachedTranscript = {
    messages: Array.from({ length: 210 }, (_, i) => ({ id: String(i), role: 'assistant', createdAt: '', providerId: 'claude', status: 'complete', content: [{ type: 'text', text: 'hello' }] })),
    cursor: null, hasMore: false,
  }
  const trimmed = trimTranscriptForCache(transcript)!
  expect(trimmed.messages[0]!.id).toBe('10')
  expect(trimmed.cursor).toBe(10)
  expect(trimmed.hasMore).toBe(true)
  expect(trimTranscriptForCache({ ...transcript, cursor: 50, hasMore: true })!.cursor).toBe(60)
})

it('does not persist an unfinished tail or invent a missing paging anchor', () => {
  const transcript: CachedTranscript = { messages: [
    { id: '1', role: 'assistant', createdAt: '', providerId: 'claude', status: 'complete', content: [] },
    { id: '2', role: 'assistant', createdAt: '', providerId: 'claude', status: 'streaming', content: [] },
  ], hasMore: false, cursor: null }
  expect(trimTranscriptForCache(transcript)!.messages.map(m => m.id)).toEqual(['1'])
  expect(trimTranscriptForCache({ ...transcript, hasMore: true })).toBeNull()
})
