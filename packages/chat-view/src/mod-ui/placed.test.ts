import { describe, expect, it } from 'vitest'
import type { ModPlacedRow } from '@superone/shared/mod-ui'
import { partitionPlacedRows } from './react'

function row(id: string, afterUuid?: string): ModPlacedRow {
  return { plugin: 'theme-examples', id: 'theme-card', requestId: id, ...(afterUuid ? { afterUuid } : {}) }
}

describe('partitionPlacedRows', () => {
  it('keeps every placed card in the transcript', () => {
    const loose = row('req-1')
    const anchored = row('req-2', 'message-2')
    const unknown = row('req-3', 'missing')
    const parts = partitionPlacedRows([loose, anchored, unknown], new Set(['message-2']))
    expect(parts.start).toEqual([loose])
    expect(parts.after.get('message-2')).toEqual([anchored])
    expect(parts.tail).toEqual([unknown])
  })
})
