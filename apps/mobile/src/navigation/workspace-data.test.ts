import { describe, expect, it } from 'vitest'
import type { RelayClient } from '@superone/relay-client'
import { readProjectSessions, readSettledSessions, SESSION_PAGE_SIZE } from './workspace-data'
import { resolveTestProject } from '../project-rpc.test-fixtures'

function stubClient(reply: Record<string, unknown>): RelayClient {
  return { resolveProject: resolveTestProject, rpc: async () => reply } as unknown as RelayClient
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

describe('readSettledSessions', () => {
  it('reads the settled page and its total', async () => {
    const page = await readSettledSessions(stubClient({ sessions: rows(2), totalCount: 9 }), '/p')
    expect(page).toEqual({ sessions: rows(2), totalCount: 9 })
  })

  it('treats a desktop that does not serve the method as an empty group', async () => {
    const client = {
      resolveProject: resolveTestProject,
      rpc: async () => {
        throw Object.assign(new Error('unknown method: sessionList.settled'), { code: 'not_found' })
      },
    } as unknown as RelayClient
    await expect(readSettledSessions(client, '/p')).resolves.toEqual({ sessions: [], totalCount: 0 })
  })
})
