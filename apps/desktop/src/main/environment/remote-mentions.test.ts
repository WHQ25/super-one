import { describe, expect, it, vi } from 'vitest'
import {
  listRemoteAgents,
  listRemoteDirectoryForMentions,
  listRemoteSkillsAndCommands,
  readRemoteAgentFile,
} from './remote-mentions'
import type { EnvironmentHost } from './environment-host'
import { RemoteEnvironmentGateway } from './remote-environment-gateway'

function mockHost(listDir = vi.fn()): EnvironmentHost {
  return {
    connections: {
      listKnown: () => [{ connectionId: 'conn-1', environmentId: 'env-1' }],
    },
    listProjects: vi.fn().mockResolvedValue([{ projectId: 'p1', path: '/work/app' }]),
    openProject: vi.fn(),
    getGateway: () => ({}),
    workspace: () => ({
      listDir: listDir.mockResolvedValue([
        { name: 'src', path: 'src', type: 'directory' },
        { name: 'README.md', path: 'README.md', type: 'file' },
        { name: 'node_modules', path: 'node_modules', type: 'directory' },
      ]),
    }),
  } as unknown as EnvironmentHost
}

describe('listRemoteDirectoryForMentions', () => {
  it('lists directory entries and skips node_modules', async () => {
    const listDir = vi.fn()
    const host = mockHost(listDir)
    const entries = await listRemoteDirectoryForMentions(host, 'remote:conn-1:/work/app', '')
    expect(entries).toEqual(
      expect.arrayContaining([
        { name: 'src', isDirectory: true },
        { name: 'README.md', isDirectory: false },
      ]),
    )
    expect(entries?.some((e) => e.name === 'node_modules')).toBe(false)
  })

  it('returns null for local paths', async () => {
    expect(await listRemoteDirectoryForMentions(mockHost(), '/local/app', '')).toBeNull()
    expect(await listRemoteSkillsAndCommands(mockHost(), '/local/app')).toBeNull()
    expect(await listRemoteAgents(mockHost(), '/local/app')).toBeNull()
  })
})

describe('listRemoteAgents', () => {
  it('maps agents.list RPC rows', async () => {
    const agentsList = vi.fn().mockResolvedValue({
      agents: [
        {
          name: 'reviewer',
          description: 'Reviews PRs',
          model: 'sonnet',
          source: 'project',
          scope: 'project',
        },
      ],
    })
    const gw = { agentsList } as unknown as RemoteEnvironmentGateway
    Object.setPrototypeOf(gw, RemoteEnvironmentGateway.prototype)
    const host = {
      ...mockHost(),
      getGateway: () => gw,
    } as unknown as EnvironmentHost

    const agents = await listRemoteAgents(host, 'remote:conn-1:/work/app')
    expect(agents).toEqual([
      {
        name: 'reviewer',
        description: 'Reviews PRs',
        model: 'sonnet',
        source: 'project',
        scope: 'project',
      },
    ])
    expect(agentsList).toHaveBeenCalledWith('p1')
  })

  it('reads agent file via agents.readFile', async () => {
    const agentsReadFile = vi.fn().mockResolvedValue({ content: '# reviewer\n' })
    const gw = { agentsReadFile } as unknown as RemoteEnvironmentGateway
    Object.setPrototypeOf(gw, RemoteEnvironmentGateway.prototype)
    const host = {
      ...mockHost(),
      getGateway: () => gw,
    } as unknown as EnvironmentHost

    const content = await readRemoteAgentFile(host, 'remote:conn-1:/work/app', 'reviewer')
    expect(content).toBe('# reviewer\n')
    expect(agentsReadFile).toHaveBeenCalledWith('p1', 'reviewer')
    expect(await readRemoteAgentFile(mockHost(), '/local/app', 'x')).toBeNull()
  })
})
