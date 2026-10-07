import { beforeEach, describe, expect, it, vi } from 'vitest'
import { decode } from '@toon-format/toon'
import { createEnvironmentArchiveTools } from './environment-archive-tools'

const mocks = vi.hoisted(() => ({ list: vi.fn(), connect: vi.fn(), archive: vi.fn(), owner: vi.fn() }))
vi.mock('./artifact-registry', () => ({ currentCallOwner: mocks.owner }))
vi.mock('../environment/environment-host', () => ({ getEnvironmentHost: () => ({ listEnvironments: mocks.list, connect: mocks.connect, getGateway: () => ({ sessions: { archive: mocks.archive } }) }) }))
const local = vi.fn(() => ({ content: [{ type: 'text' as const, text: JSON.stringify({ hits: [{ sessionId: 'same', title: 'Local' }] }) }] }))
beforeEach(() => {
  vi.clearAllMocks()
  mocks.owner.mockReturnValue(undefined)
  mocks.list.mockResolvedValue([{ connectionId: 'local', environmentId: 'desktop', kind: 'local', label: 'Desktop', state: 'connected' }, { connectionId: 'connection', environmentId: 'node', kind: 'remote', label: 'Node', state: 'connected', capabilities: { sessionArchive: true } }])
  mocks.connect.mockResolvedValue({ environmentId: 'node', capabilities: { sessionArchive: true } })
  mocks.archive.mockResolvedValue({ content: [{ type: 'text', text: 'remote result' }] })
})
describe('environment archive tools', () => {
  it('uses the Host Action caller as localhost, rather than the desktop executor', async () => {
    mocks.owner.mockReturnValue('connection')
    const tools = createEnvironmentArchiveTools('remote-session')
    await tools.archiveRead('session_search', { query: 'why' }, local)
    expect(local).not.toHaveBeenCalled()
    expect(mocks.archive).toHaveBeenCalledWith({ tool: 'session_search', args: { query: 'why', environmentId: 'localhost' }, sourceSessionId: 'remote-session' })
    const list = decode((await tools.environmentList()).content[0].text) as { environments: Array<{ environmentId: string; isLocal: boolean }> }
    expect(list.environments.find(item => item.environmentId === 'node')?.isLocal).toBe(true)
    expect(list.environments.find(item => item.environmentId === 'desktop')?.isLocal).toBe(false)
  })
  it('does not repeat the local selector in hits or connect during discovery', async () => {
    const tools = createEnvironmentArchiveTools('local-session')
    const value = decode((await tools.archiveRead('session_search', { query: 'why' }, local)).content[0].text) as { environmentId: string; hits: Array<Record<string, unknown>> }
    expect(value.environmentId).toBe('localhost'); expect(value.hits[0]).not.toHaveProperty('environmentId')
    expect(mocks.list).toHaveBeenLastCalledWith({ includeDescriptors: false })
    await tools.environmentList()
    expect(mocks.list).toHaveBeenLastCalledWith({ includeDescriptors: true })
    expect(mocks.connect).not.toHaveBeenCalled()
  })
  it('never falls back to a local archive after an identity failure', async () => {
    mocks.connect.mockResolvedValue({ environmentId: 'changed', capabilities: { sessionArchive: true } })
    const result = await createEnvironmentArchiveTools('local').archiveRead('session_search', { environmentId: 'node', query: 'why', allProjects: true }, local)
    expect(result.isError).toBe(true); expect(local).not.toHaveBeenCalled(); expect(mocks.archive).not.toHaveBeenCalled()
  })
  it('requires a project scope when a remote caller targets the desktop', async () => {
    mocks.owner.mockReturnValue('connection')
    expect((await createEnvironmentArchiveTools('remote').archiveRead('session_search', { environmentId: 'desktop', query: 'why' }, local)).isError).toBe(true)
    expect(local).not.toHaveBeenCalled()
  })
  it('does not identify a colliding local ID as the foreign caller itself', async () => {
    mocks.owner.mockReturnValue('connection')
    const handler = () => ({ content: [{ type: 'text' as const, text: JSON.stringify({ sessions: [{ id: 'same', isSelf: true }] }) }] })
    const value = decode((await createEnvironmentArchiveTools('same').archiveRead('session_list', { environmentId: 'desktop', allProjects: true }, handler)).content[0].text) as { sessions: Array<{ isSelf: boolean }> }
    expect(value.sessions[0].isSelf).toBe(false)
  })
})
