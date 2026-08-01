import { describe, expect, it, vi } from 'vitest'
import { listRemoteDirectoryForMentions, listRemoteSkillsAndCommands } from './remote-mentions'
import type { EnvironmentHost } from './environment-host'

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
  })
})
