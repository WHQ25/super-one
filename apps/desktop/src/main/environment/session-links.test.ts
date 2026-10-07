import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveSessionLinkTarget, sessionEnvironmentId, sessionLinkMetadata } from './session-links'
const m = vi.hoisted(() => ({ list: vi.fn(), connect: vi.fn(), get: vi.fn(), metadata: vi.fn(), project: vi.fn(), headers: vi.fn(), find: vi.fn(), load: vi.fn() }))
vi.mock('./environment-host', () => ({ getEnvironmentHost: () => ({ listEnvironments: m.list, connect: m.connect, getGateway: () => ({ sessions: { get: m.get, getMetadataBatch: m.metadata }, getProject: m.project }) }) }))
vi.mock('./session-identity', () => ({ localSessionEnvironmentId: () => 'desktop' }))
vi.mock('../database', () => ({ getDb: () => ({ prepare: () => ({ all: m.headers }) }) }))
vi.mock('../db-sessions', () => ({ findSessionAcrossProjects: m.find, loadSessionState: m.load }))
vi.mock('../session/session-repo', () => ({ deriveHarnessId: (row: { provider: string }) => row.provider }))
beforeEach(() => {
  vi.clearAllMocks()
  m.list.mockResolvedValue([{ environmentId: 'desktop', connectionId: 'local', kind: 'local', label: 'Desktop', state: 'connected' }, { environmentId: 'node', connectionId: 'route', kind: 'remote', state: 'disconnected' }])
  m.headers.mockReturnValue([{ id: 'same', provider: 'acp', acp_agent_id: 'grok-build' }])
  m.connect.mockResolvedValue({ environmentId: 'node' })
  m.get.mockResolvedValue({ projectId: 'p', title: 'Remote', harnessId: 'codex' })
  m.metadata.mockResolvedValue([])
  m.project.mockResolvedValue({ path: '/owning-project' })
})
describe('session link host resolution', () => {
  it('derives source identity from the containing remote project key', async () => {
    expect(await sessionEnvironmentId('remote:route:/app')).toBe('node')
    m.list.mockClear()
    expect(await sessionEnvironmentId('/local')).toBe('desktop')
    expect(m.list).not.toHaveBeenCalled()
  })
  it('does lightweight visible headers only and leaves offline routes unavailable', async () => {
    expect(await sessionLinkMetadata([{ environmentId: 'desktop', sessionId: 'same' }, { environmentId: 'node', sessionId: 'same' }])).toMatchObject([{ status: 'ok', metadata: { harness: 'acp', acpAgentId: 'grok-build' } }, { status: 'unavailable' }])
    expect(m.connect).not.toHaveBeenCalled(); expect(m.load).not.toHaveBeenCalled(); expect(m.get).not.toHaveBeenCalled()
  })
  it('resolves only the explicit environment and owning project, ignoring working directories', async () => {
    expect(await resolveSessionLinkTarget({ environmentId: 'node', sessionId: 'same' })).toMatchObject({ projectPath: 'remote:route:/owning-project', connectionId: 'route' })
    expect(m.find).not.toHaveBeenCalled()
    expect(m.get).toHaveBeenCalledWith({ environmentId: 'node', sessionId: 'same' })
  })
  it('rejects unknown hosts, hidden targets and identity drift without falling back', async () => {
    await expect(resolveSessionLinkTarget({ environmentId: 'unknown', sessionId: 'same' })).rejects.toThrow('Unknown session environment')
    m.connect.mockResolvedValue({ environmentId: 'different' })
    await expect(resolveSessionLinkTarget({ environmentId: 'node', sessionId: 'same' })).rejects.toThrow('identity changed')
    expect(m.get).not.toHaveBeenCalled(); expect(m.find).not.toHaveBeenCalled()
    m.connect.mockResolvedValue({ environmentId: 'node' }); m.get.mockResolvedValue({ isHidden: true, projectId: 'p' })
    await expect(resolveSessionLinkTarget({ environmentId: 'node', sessionId: 'same' })).rejects.toThrow('unavailable')
  })
})
