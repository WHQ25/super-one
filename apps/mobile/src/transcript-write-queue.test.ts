import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enqueueTranscriptWrite, flushTranscriptWrites, holdTranscriptCover } from './transcript-write-queue'

beforeEach(() => { vi.spyOn(console, 'info').mockImplementation(() => {}) })
afterEach(() => { flushTranscriptWrites(); vi.useRealTimers(); vi.restoreAllMocks() })

describe('transcript write queue', () => {
  it('keeps the latest snapshot for a session and writes it when idle', async () => {
    vi.useFakeTimers()
    const writes: string[] = []
    enqueueTranscriptWrite('a', () => writes.push('old'))
    enqueueTranscriptWrite('a', () => writes.push('new'))
    enqueueTranscriptWrite('b', () => writes.push('b'))
    expect(writes).toEqual([])
    await vi.advanceTimersByTimeAsync(0)
    expect(writes).toEqual(['new', 'b'])
  })

  it('waits until the cover drops', async () => {
    vi.useFakeTimers()
    const writes: string[] = []
    const release = holdTranscriptCover()
    enqueueTranscriptWrite('a', () => writes.push('a'))
    await vi.advanceTimersByTimeAsync(0)
    expect(writes).toEqual([])
    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(writes).toEqual(['a'])
  })

  it('drops each hold once, so an earlier open cannot release a later cover', async () => {
    vi.useFakeTimers()
    const writes: string[] = []
    const first = holdTranscriptCover()
    const second = holdTranscriptCover()
    enqueueTranscriptWrite('a', () => writes.push('a'))
    // The first open paints its window, then its `finally` runs.
    first()
    first()
    await vi.advanceTimersByTimeAsync(0)
    expect(writes).toEqual([])
    second()
    await vi.advanceTimersByTimeAsync(0)
    expect(writes).toEqual(['a'])
  })

  it('writes immediately when asked, including a snapshot queued under the cover', () => {
    const writes: string[] = []
    const release = holdTranscriptCover()
    enqueueTranscriptWrite('a', () => writes.push('a'))
    flushTranscriptWrites()
    expect(writes).toEqual(['a'])
    release()
  })
})
