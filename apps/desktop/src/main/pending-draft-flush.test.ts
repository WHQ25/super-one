import { describe, expect, it, vi } from 'vitest'
import { flushPendingDraftItem } from './pending-draft-flush'
import type { DraftUpsertRequest } from '@superone/shared/environment'

const draft = (id = 'd1'): DraftUpsertRequest => ({ id, text: 'hello' })

describe('flushPendingDraftItem', () => {
  it('skips when the pending row was deleted before upsert starts', async () => {
    const upsert = vi.fn()
    const result = await flushPendingDraftItem(draft(), {
      isStillQueued: () => false,
      upsert,
      remoteDelete: vi.fn(),
      dequeue: vi.fn(),
      recordFailure: vi.fn(),
    })
    expect(result).toBe('skipped')
    expect(upsert).not.toHaveBeenCalled()
  })

  it('upserts then dequeues when the row survives the round trip', async () => {
    const dequeue = vi.fn()
    const result = await flushPendingDraftItem(draft(), {
      isStillQueued: () => true,
      upsert: vi.fn().mockResolvedValue(undefined),
      remoteDelete: vi.fn(),
      dequeue,
      recordFailure: vi.fn(),
    })
    expect(result).toBe('flushed')
    expect(dequeue).toHaveBeenCalledWith('d1')
  })

  it('deletes on the node when the user removed the pending row during upsert', async () => {
    let queued = true
    const remoteDelete = vi.fn().mockResolvedValue(undefined)
    const dequeue = vi.fn()
    const result = await flushPendingDraftItem(draft(), {
      isStillQueued: () => {
        const still = queued
        // After upsert starts we flip to deleted (simulates concurrent deleteDraft).
        return still
      },
      upsert: vi.fn().mockImplementation(async () => {
        queued = false
      }),
      remoteDelete,
      dequeue,
      recordFailure: vi.fn(),
    })
    // First isStillQueued true, upsert runs and clears queue, second check false.
    expect(result).toBe('undone')
    expect(remoteDelete).toHaveBeenCalledWith('d1')
    expect(dequeue).not.toHaveBeenCalled()
  })

  it('records failure without dequeue when upsert throws', async () => {
    const recordFailure = vi.fn()
    const dequeue = vi.fn()
    const result = await flushPendingDraftItem(draft(), {
      isStillQueued: () => true,
      upsert: vi.fn().mockRejectedValue(new Error('node down')),
      remoteDelete: vi.fn(),
      dequeue,
      recordFailure,
    })
    expect(result).toBe('failed')
    expect(recordFailure).toHaveBeenCalledWith('d1', 'node down')
    expect(dequeue).not.toHaveBeenCalled()
  })
})
