import { describe, expect, it, vi } from 'vitest'
import { AgentIpcChannels } from '@superone/shared/agent-types'
import {
  createIpcBackedResourceApi,
  deleteSkillForProject,
  fetchMcpConfigsForProject,
  fetchSkillsForProject,
  saveMcpConfigForProject,
  selectResourceTransport,
} from './remote-resource-ops'

describe('selectResourceTransport', () => {
  it('uses local-fs for host paths and remote-rpc for remote: keys', () => {
    expect(selectResourceTransport('/Users/me/app')).toBe('local-fs')
    expect(selectResourceTransport('remote:conn-1:/work/app')).toBe('remote-rpc')
  })
})

describe('fetchSkillsForProject / fetchMcpConfigsForProject', () => {
  it('local path calls window.app-style local list', async () => {
    const localListSkills = vi.fn(async () => [{ name: 'local-skill' } as never])
    const localListCodexSkills = vi.fn(async () => [])
    const skills = await fetchSkillsForProject({
      projectPath: '/local/app',
      provider: 'claude',
      localListSkills,
      localListCodexSkills,
    })
    expect(localListSkills).toHaveBeenCalledWith('/local/app')
    expect(skills[0]?.name).toBe('local-skill')
  })

  it('remote path invokes listRemoteSkills / listRemoteMcpConfigs via env API', async () => {
    const listRemoteSkills = vi.fn(async () => ({
      skills: [{ name: 'node-skill', description: '', scope: 'project', sourcePath: '/n/s' }],
    }))
    const listRemoteMcpConfigs = vi.fn(async () => ({
      servers: [{ name: 'github', type: 'http', scope: 'project', url: 'https://x' }],
    }))
    const listProjects = vi.fn(async () => [{ projectId: 'p1', path: '/work/app' }])
    const env = { listRemoteSkills, listRemoteMcpConfigs, listProjects }

    const skills = await fetchSkillsForProject({
      projectPath: 'remote:conn-1:/work/app',
      provider: 'claude',
      env,
      localListSkills: vi.fn(async () => {
        throw new Error('must not use local FS')
      }),
      localListCodexSkills: vi.fn(async () => []),
    })
    expect(listRemoteSkills).toHaveBeenCalledWith('conn-1', 'p1', 'claude')
    expect(skills[0]?.name).toBe('node-skill')

    const mcps = await fetchMcpConfigsForProject({
      projectPath: 'remote:conn-1:/work/app',
      provider: 'claude',
      env,
      localListMcp: vi.fn(async () => {
        throw new Error('must not use local FS')
      }),
      localListCodexMcp: vi.fn(async () => []),
    })
    expect(listRemoteMcpConfigs).toHaveBeenCalledWith('conn-1', 'p1', 'claude')
    expect(mcps[0]?.name).toBe('github')
  })

  it('saveMcpConfigForProject remote path calls mcp.save via env', async () => {
    const saveRemoteMcpConfig = vi.fn(async () => ({ ok: true }))
    const listProjects = vi.fn(async () => [{ projectId: 'p1', path: '/work/app' }])
    const transport = await saveMcpConfigForProject({
      projectPath: 'remote:conn-1:/work/app',
      provider: 'claude',
      name: 'github',
      config: { type: 'http', url: 'https://x' },
      scope: 'project',
      env: { saveRemoteMcpConfig, listProjects },
      localSave: vi.fn(async () => {
        throw new Error('local')
      }),
      localCodexSave: vi.fn(async () => {
        throw new Error('local')
      }),
    })
    expect(transport).toBe('remote-rpc')
    expect(saveRemoteMcpConfig).toHaveBeenCalledWith('conn-1', 'p1', {
      provider: 'claude',
      name: 'github',
      scope: 'project',
      config: { type: 'http', url: 'https://x' },
    })
  })

  it('createIpcBackedResourceApi invokes ENVIRONMENT_* channels when preload methods missing', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === AgentIpcChannels.ENVIRONMENT_LIST_REMOTE_MCP_CONFIGS) {
        return { servers: [{ name: 'via-ipc' }] }
      }
      if (channel === AgentIpcChannels.ENVIRONMENT_SAVE_REMOTE_MCP_CONFIG) {
        return { ok: true }
      }
      return {}
    })
    const listProjects = vi.fn(async () => [{ projectId: 'p1', path: '/work/app' }])
    const env = createIpcBackedResourceApi(invoke, { listProjects })

    const mcps = await fetchMcpConfigsForProject({
      projectPath: 'remote:conn-1:/work/app',
      provider: 'claude',
      env,
      localListMcp: vi.fn(async () => {
        throw new Error('local')
      }),
      localListCodexMcp: vi.fn(async () => []),
    })
    expect(mcps[0]?.name).toBe('via-ipc')
    expect(invoke).toHaveBeenCalledWith(
      AgentIpcChannels.ENVIRONMENT_LIST_REMOTE_MCP_CONFIGS,
      'conn-1',
      'p1',
      'claude',
    )

    await saveMcpConfigForProject({
      projectPath: 'remote:conn-1:/work/app',
      provider: 'claude',
      name: 'github',
      config: { type: 'http', url: 'https://x' },
      scope: 'project',
      env,
      localSave: vi.fn(async () => {
        throw new Error('local')
      }),
      localCodexSave: vi.fn(async () => {
        throw new Error('local')
      }),
    })
    expect(invoke).toHaveBeenCalledWith(
      AgentIpcChannels.ENVIRONMENT_SAVE_REMOTE_MCP_CONFIG,
      'conn-1',
      'p1',
      {
        provider: 'claude',
        name: 'github',
        scope: 'project',
        config: { type: 'http', url: 'https://x' },
      },
    )
  })

  it('deleteSkillForProject remote path calls skills.delete via env', async () => {
    const deleteRemoteSkill = vi.fn(async () => ({ ok: true }))
    const listProjects = vi.fn(async () => [{ projectId: 'p1', path: '/work/app' }])
    const transport = await deleteSkillForProject({
      projectPath: 'remote:conn-1:/work/app',
      provider: 'claude',
      sourcePath: '/node/skills/demo',
      env: { deleteRemoteSkill, listProjects },
      localDelete: vi.fn(async () => {
        throw new Error('local')
      }),
      localCodexDelete: vi.fn(async () => {
        throw new Error('local')
      }),
    })
    expect(transport).toBe('remote-rpc')
    expect(deleteRemoteSkill).toHaveBeenCalledWith(
      'conn-1',
      'p1',
      '/node/skills/demo',
      'claude',
    )
  })
})
