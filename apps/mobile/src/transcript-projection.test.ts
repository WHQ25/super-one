import { expect, it } from 'vitest'
import { TranscriptProjection } from './transcript-projection'
import type { ChatMessage } from '@superone/shared/agent-types'
it('sends only changed rows and preserves explicit ordering across pagination and removals', () => {
  const a = { id: 'a' } as ChatMessage
  const b = { id: 'b' } as ChatMessage
  const projection = new TranscriptProjection()
  expect(projection.project([a, b], true)).toEqual({ messages: [a, b] })
  const next = { ...b, content: [{ type: 'text' as const, text: 'new' }] }
  expect(projection.project([a, next], false)).toEqual({ messagePatches: [next] })
  expect(projection.project([next], false)).toEqual({ messagePatches: [], messageOrder: ['b'] })
})
