import { describe, expect, it } from 'vitest'
import { pendingStorageEntries } from './renderer-storage-migration'

describe('pendingStorageEntries', () => {
  it('copies every legacy key the new origin does not have', () => {
    expect(pendingStorageEntries([['a', '1'], ['b', '2']], [])).toEqual([['a', '1'], ['b', '2']])
  })

  it('keeps values already written at the new origin', () => {
    expect(pendingStorageEntries([['a', 'old'], ['b', '2']], [['a', 'new']])).toEqual([['b', '2']])
  })
})
