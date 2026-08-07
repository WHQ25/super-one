/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const listSessions = vi.fn()
const listProjects = vi.fn()

vi.stubGlobal('window', {
  environment: {
    listSessions,
    listProjects,
  },
})

const { listSessionsPage, listAllSessions, sessionsPageHasMore, connectionIdForProjectKey } =
  await import('./session-list-ops')

describe('session-list-ops', () => {
  beforeEach(() => {
    listSessions.mockReset()
    listProjects.mockReset()
  })

  it('connectionIdForProjectKey maps remote keys and local paths', () => {
    expect(connectionIdForProjectKey('/tmp/a')).toBe('local')
    expect(connectionIdForProjectKey('remote:conn-1:/work')).toBe('conn-1')
  })

  it('sessionsPageHasMore uses full-page convention', () => {
    expect(sessionsPageHasMore(new Array(30).fill({ sessionId: 'x' }), 30)).toBe(true)
    expect(sessionsPageHasMore(new Array(29).fill({ sessionId: 'x' }), 30)).toBe(false)
  })

  it('listSessionsPage for local uses environment.listSessions', async () => {
    listSessions.mockResolvedValueOnce([
      {
        sessionId: 's1',
        title: 'Hello',
        lastActiveAt: '2026-01-01T00:00:00.000Z',
        provider: 'claude',
        messageCount: 2,
      },
    ])
    const page = await listSessionsPage('/tmp/proj', { limit: 30, offset: 0 })
    expect(listSessions).toHaveBeenCalledWith('local', '/tmp/proj', { limit: 30, offset: 0 })
    expect(page).toHaveLength(1)
    expect(page[0]?.sessionId).toBe('s1')
    expect(page[0]?.title).toBe('Hello')
  })

  it('ignores preferred projectId for local (path is authoritative)', async () => {
    listSessions.mockResolvedValueOnce([])
    await listSessionsPage('/tmp/proj-b', {
      limit: 30,
      offset: 0,
      projectId: 'stale-uuid-from-project-a',
    })
    expect(listSessions).toHaveBeenCalledWith('local', '/tmp/proj-b', { limit: 30, offset: 0 })
  })

  it('preserves acpAgentId and providerSessionId from environment rows', async () => {
    const { mapEnvironmentSessionRow } = await import('./session-list-ops')
    const mapped = mapEnvironmentSessionRow({
      sessionId: 's1',
      title: 'ACP',
      lastActiveAt: '2026-01-01T00:00:00.000Z',
      provider: 'acp',
      messageCount: 1,
      acpAgentId: 'cursor',
      providerSessionId: 'prov-123',
    })
    expect(mapped.acpAgentId).toBe('cursor')
    expect(mapped.providerSessionId).toBe('prov-123')
  })

  it('listSessionsPage for remote resolves projectId then lists', async () => {
    listProjects.mockResolvedValueOnce([
      { projectId: 'pid-1', path: '/work/app', name: 'app' },
    ])
    listSessions.mockResolvedValueOnce([
      {
        sessionId: 'rs1',
        title: 'Remote',
        lastActiveAt: '2026-01-01T00:00:00.000Z',
        provider: 'claude',
        messageCount: 0,
      },
    ])
    const page = await listSessionsPage('remote:conn-9:/work/app', {
      limit: 10,
      offset: 0,
    })
    expect(listProjects).toHaveBeenCalledWith('conn-9')
    expect(listSessions).toHaveBeenCalledWith('conn-9', 'pid-1', { limit: 10, offset: 0 })
    expect(page[0]?.sessionId).toBe('rs1')
  })

  it('listAllSessions pages with limit/offset until short page', async () => {
    listSessions
      .mockResolvedValueOnce(
        Array.from({ length: 2 }, (_, i) => ({
          sessionId: `p${i}`,
          title: `P${i}`,
          lastActiveAt: '2026-01-01T00:00:00.000Z',
          messageCount: 0,
        })),
      )
      .mockResolvedValueOnce([
        {
          sessionId: 'last',
          title: 'Last',
          lastActiveAt: '2026-01-01T00:00:00.000Z',
          messageCount: 0,
        },
      ])
    const all = await listAllSessions('/tmp/p', { pageSize: 2 })
    expect(listSessions).toHaveBeenNthCalledWith(1, 'local', '/tmp/p', { limit: 2, offset: 0 })
    expect(listSessions).toHaveBeenNthCalledWith(2, 'local', '/tmp/p', { limit: 2, offset: 2 })
    expect(all.map((s) => s.sessionId)).toEqual(['p0', 'p1', 'last'])
  })
})
