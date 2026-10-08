import { describe, expect, it } from 'vitest'
import { buildSessionMessageCatalog } from './message-catalog'
import type { NodeSessionRecord } from './types'

describe('message catalog completion time', () => {
  it('reads an assistant block time as its completion time', () => {
    const doneAt = Date.parse('2026-10-08T05:00:00.000Z')
    const session = {
      sessionId: 's1',
      transcript: [
        { id: 'u1', role: 'user' as const, text: 'go', createdAt: doneAt - 60_000 },
        { id: 'a1', role: 'assistant' as const, text: 'done', createdAt: doneAt },
      ],
    } as Pick<NodeSessionRecord, 'sessionId' | 'transcript' | 'providerResume'>
    const [user, assistant] = buildSessionMessageCatalog(session, [])
    expect(user?.metadata).toBeUndefined()
    expect(assistant?.metadata).toEqual({ completedAt: '2026-10-08T05:00:00.000Z' })
  })
})
