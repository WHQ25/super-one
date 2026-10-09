import { beforeEach, describe, expect, it, vi } from 'vitest'
import { decode } from '@toon-format/toon'
import { createEnvironmentArchiveTools } from './environment-archive-tools'

const mocks = vi.hoisted(() => ({ list: vi.fn(), connect: vi.fn(), archive: vi.fn(), owner: vi.fn(), liveStatus: vi.fn(), localContext: vi.fn() }))
vi.mock('./artifact-registry', () => ({ currentCallOwner: mocks.owner }))
vi.mock('../environment/environment-host', () => ({ getEnvironmentHost: () => ({ listEnvironments: mocks.list, connect: mocks.connect, getGateway: () => ({ sessions: { archive: mocks.archive }, getLiveStatus: mocks.liveStatus }) }) }))
vi.mock('../environment/local-node-context', () => ({ readLocalNodeContext: mocks.localContext }))
const local = vi.fn(() => ({ content: [{ type: 'text' as const, text: JSON.stringify({ hits: [{ sessionId: 'same', title: 'Local' }] }) }] }))
beforeEach(() => {
  vi.clearAllMocks()
  mocks.owner.mockReturnValue(undefined)
  mocks.list.mockResolvedValue([{ connectionId: 'local', environmentId: 'desktop', kind: 'local', label: 'Desktop', state: 'connected' }, { connectionId: 'connection', environmentId: 'node', kind: 'remote', label: 'Node', state: 'connected', capabilities: { sessionArchive: true } }])
  mocks.connect.mockResolvedValue({ environmentId: 'node', capabilities: { sessionArchive: true } })
  mocks.archive.mockResolvedValue({ content: [{ type: 'text', text: 'remote result' }] })
  mocks.liveStatus.mockRejectedValue(new Error('unsupported method on this environment: environment.status'))
  mocks.localContext.mockResolvedValue({ machine: { os: 'macOS 26.0', cpuModel: 'Apple M3 Max', cpuCores: 16, memoryBytes: 64 * 2 ** 30, gpus: ['Apple M3 Max'] }, live: { freeMemoryBytes: 8 * 2 ** 30 } })
})
describe('environment archive tools', () => {
  it('uses the Host Action caller as localhost, rather than the desktop executor', async () => {
    mocks.owner.mockReturnValue('connection')
    const tools = createEnvironmentArchiveTools('remote-session')
    await tools.archiveRead('session_search', { query: 'why' }, local)
    expect(local).not.toHaveBeenCalled()
    expect(mocks.archive).toHaveBeenCalledWith({ tool: 'session_search', args: { query: 'why', environmentId: 'localhost' }, sourceSessionId: 'remote-session' })
    const list = decode((await tools.environmentGetInfo()).content[0].text) as { environments: Array<{ environmentId: string; isLocal: boolean }> }
    expect(list.environments.find(item => item.environmentId === 'node')?.isLocal).toBe(true)
    expect(list.environments.find(item => item.environmentId === 'desktop')?.isLocal).toBe(false)
  })
  it('does not repeat the local selector in hits or connect during discovery', async () => {
    const tools = createEnvironmentArchiveTools('local-session')
    const value = decode((await tools.archiveRead('session_search', { query: 'why' }, local)).content[0].text) as { environmentId: string; hits: Array<Record<string, unknown>> }
    expect(value.environmentId).toBe('localhost'); expect(value.hits[0]).not.toHaveProperty('environmentId')
    expect(mocks.list).toHaveBeenLastCalledWith({ includeDescriptors: false })
    await tools.environmentGetInfo({ include: [] })
    expect(mocks.list).toHaveBeenLastCalledWith({ includeDescriptors: false })
    await tools.environmentGetInfo()
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
  it('lists hardware and free memory as flat rows, null where a node cannot say', async () => {
    mocks.list.mockResolvedValue([
      { connectionId: 'local', environmentId: 'desktop', kind: 'local', label: 'Desktop', state: 'connected', platform: { os: 'darwin', arch: 'arm64' } },
      { connectionId: 'old', environmentId: 'old', kind: 'remote', label: 'Old node', state: 'connected', platform: { os: 'linux', arch: 'x64' }, capabilities: { harnessIds: ['codex'] } },
      { connectionId: 'gpu', environmentId: 'gpu', kind: 'remote', label: 'GPU box', state: 'connected', platform: { os: 'linux', arch: 'x64' }, capabilities: { harnessIds: [] }, machine: { os: 'Ubuntu 24.04 LTS', cpuCores: 32, memoryBytes: 128 * 2 ** 30, gpus: ['NVIDIA GA102 [GeForce RTX 3090]'] } },
      { connectionId: 'off', environmentId: 'off', kind: 'remote', label: 'Offline', state: 'disconnected' },
    ])
    mocks.liveStatus.mockImplementation(async () => ({ freeMemoryBytes: 100 * 2 ** 30 }))
    mocks.liveStatus.mockRejectedValueOnce(new Error('unsupported'))
    const text = (await createEnvironmentArchiveTools('local-session').environmentGetInfo()).content[0].text
    expect(text).toMatch(/^environments\[4\]\{/)
    const rows = (decode(text) as { environments: Array<Record<string, unknown>> }).environments
    expect(rows[0]).toEqual({ environmentId: 'desktop', label: 'Desktop', isLocal: true, state: 'connected', searchable: true, os: 'macOS 26.0', arch: 'arm64', cpu: 'Apple M3 Max, 16 cores', gpus: 'Apple M3 Max', memoryGb: 64, freeMemoryGb: 8 })
    expect(rows[1]).toMatchObject({ environmentId: 'old', os: 'linux', cpu: null, memoryGb: null, freeMemoryGb: null })
    expect(rows[2]).toMatchObject({ environmentId: 'gpu', os: 'Ubuntu 24.04 LTS', cpu: '32 cores', gpus: 'NVIDIA GA102 [GeForce RTX 3090]', memoryGb: 128, freeMemoryGb: 100 })
    expect(rows[3]).toMatchObject({ environmentId: 'off', state: 'disconnected', os: null, freeMemoryGb: null })
    expect(mocks.liveStatus).toHaveBeenCalledTimes(2)
  })

  it('reads only the named environments, and only their identity when include is empty', async () => {
    const tools = createEnvironmentArchiveTools('local-session')
    const one = decode((await tools.environmentGetInfo({ environmentIds: ['node'], include: [] })).content[0].text) as { environments: Array<Record<string, unknown>> }
    expect(one.environments).toEqual([{ environmentId: 'node', label: 'Node', isLocal: false, state: 'connected', searchable: true }])
    expect(mocks.localContext).not.toHaveBeenCalled()
    expect(mocks.liveStatus).not.toHaveBeenCalled()
    const missing = await tools.environmentGetInfo({ environmentIds: ['nope'] })
    expect(missing.isError).toBe(true)
    expect(missing.content[0].text).toMatch(/Unknown environment: nope/)
  })
})
