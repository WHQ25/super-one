import { describe, expect, test } from 'vitest'
import { answerTranscriptRequest, historyRows, transcriptProjection, transcriptStates } from './transcript-fixtures'

describe('transcriptProjection', () => {
  test('history states hydrate the latest page with navigation on', () => {
    const projection = transcriptProjection('history', [])
    expect(projection.historyNavigation).toBe(true)
    expect(projection.messages?.map((row) => row.id)).toEqual(historyRows.slice(-8).map((row) => row.id))
  })

  test('every session state clears the facts the previous one set', () => {
    // Switching from `api-retry` to `creating` must not leave the retry banner up:
    // `mergeSessionFacts` only overwrites keys that are present.
    for (const state of transcriptStates) {
      if (state === 'restoring') continue
      const projection = transcriptProjection(state, [])
      if (projection.historyNavigation) continue
      for (const key of ['pendingTurn', 'apiRetry', 'isCompacting', 'compactError', 'isRecapping']) expect(projection).toHaveProperty(key)
    }
    expect(transcriptProjection('creating', []).pendingTurn).toBe('creating')
    expect(transcriptProjection('api-retry', []).apiRetry?.phase).toBe('retrying')
    expect(transcriptProjection('compact-error', []).compactError).toMatch(/compaction/)
  })
})

describe('answerTranscriptRequest', () => {
  test('pages before an anchor the way the shell does', async () => {
    const result = await answerTranscriptRequest('history', 'loadHistoryWindow', { anchorId: 'history-52', direction: 'before' }) as { messages: { id: string }[] }
    expect(result.messages.map((row) => row.id)).toEqual(historyRows.slice(44, 52).map((row) => row.id))
  })

  test('the failing state rejects with the error the document shows', async () => {
    await expect(answerTranscriptRequest('history-failed', 'loadHistoryWindow', { anchorId: 'history-52', direction: 'before' }))
      .rejects.toThrow('Temporary history failure')
    await expect(answerTranscriptRequest('index-failed', 'loadNavigationIndex', undefined)).rejects.toThrow(/index/)
  })
})
