import { describe, expect, it } from 'vitest'
import type { RelayClient } from '@superone/relay-client'
import { readProjectSessions, SESSION_PAGE_SIZE } from './workspace-data'

function stubClient(reply: Record<string, unknown>): RelayClient {
  return { request: async () => reply } as unknown as RelayClient
}

const rows = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ sessionId: `s${index}`, title: `s${index}` }))

describe('readProjectSessions', () => {
  it('passes the host total through', async () => {
    const page = await readProjectSessions(stubClient({ sessions: rows(30), totalCount: 91 }), '/p')
    expect(page.totalCount).toBe(91)
    expect(page.sessions).toHaveLength(30)
  })

  it('surfaces a host error as a rejection', async () => {
    await expect(readProjectSessions(stubClient({ error: 'no such project' }), '/p'))
      .rejects.toThrow('no such project')
  })

  it('infers "there is more" from a full page when the host omits totalCount', async () => {
    const page = await readProjectSessions(stubClient({ sessions: rows(SESSION_PAGE_SIZE) }), '/p')
    expect(page.totalCount).toBeGreaterThan(SESSION_PAGE_SIZE)
  })

  it('ends the list on a short page from a host that omits totalCount', async () => {
    const page = await readProjectSessions(stubClient({ sessions: rows(4) }), '/p', { offset: 30 })
    expect(page.totalCount).toBe(34)
  })

  it('ends the list on an empty page', async () => {
    const page = await readProjectSessions(stubClient({ sessions: [] }), '/p', { offset: 30 })
    expect(page.totalCount).toBe(30)
  })
})
