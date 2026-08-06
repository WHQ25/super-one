import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentIpcChannels } from '@superone/shared/agent-types'

const handle = vi.fn()
const listRemoteMcpConfigs = vi.fn(async () => ({ servers: [] }))
const saveRemoteMcpConfig = vi.fn(async () => ({ ok: true }))
const listRemoteSkills = vi.fn(async () => ({ skills: [] }))

vi.mock('electron', () => ({
  ipcMain: { handle },
}))

vi.mock('./environment-host', () => ({
  getEnvironmentHost: () => ({
    listRemoteMcpConfigs,
    saveRemoteMcpConfig,
    listRemoteSkills,
    getRemoteSkill: vi.fn(),
    readRemoteSkillFile: vi.fn(),
    deleteRemoteSkill: vi.fn(),
    installRemoteSkill: vi.fn(),
    toggleRemoteMcpConfig: vi.fn(),
    deleteRemoteMcpConfig: vi.fn(),
  }),
}))

describe('ensureEnvironmentResourceIpcRegistered', () => {
  beforeEach(() => {
    handle.mockClear()
    listRemoteMcpConfigs.mockClear()
    saveRemoteMcpConfig.mockClear()
    listRemoteSkills.mockClear()
    vi.resetModules()
  })

  it('registers Skills/MCP ENVIRONMENT_* handlers once', async () => {
    const mod = await import('./environment-resource-ipc')
    mod.resetEnvironmentResourceIpcForTests()
    mod.ensureEnvironmentResourceIpcRegistered()
    mod.ensureEnvironmentResourceIpcRegistered()

    const channels = handle.mock.calls.map((c) => c[0] as string)
    expect(channels).toContain(AgentIpcChannels.ENVIRONMENT_LIST_REMOTE_SKILLS)
    expect(channels).toContain(AgentIpcChannels.ENVIRONMENT_LIST_REMOTE_MCP_CONFIGS)
    expect(channels).toContain(AgentIpcChannels.ENVIRONMENT_SAVE_REMOTE_MCP_CONFIG)
    expect(channels).toContain(AgentIpcChannels.ENVIRONMENT_TOGGLE_REMOTE_MCP_CONFIG)
    expect(channels).toContain(AgentIpcChannels.ENVIRONMENT_DELETE_REMOTE_MCP_CONFIG)
    // Idempotent
    expect(
      channels.filter((c) => c === AgentIpcChannels.ENVIRONMENT_SAVE_REMOTE_MCP_CONFIG),
    ).toHaveLength(1)

    const saveCall = handle.mock.calls.find(
      (c) => c[0] === AgentIpcChannels.ENVIRONMENT_SAVE_REMOTE_MCP_CONFIG,
    )
    expect(saveCall).toBeTruthy()
    const listener = saveCall![1] as (
      e: unknown,
      connectionId: string,
      projectId: string,
      input: unknown,
    ) => Promise<unknown>
    await listener(null, 'conn-1', 'p1', {
      provider: 'claude',
      name: 'github',
      scope: 'project',
      config: { type: 'http', url: 'https://x' },
    })
    expect(saveRemoteMcpConfig).toHaveBeenCalledWith('conn-1', 'p1', {
      provider: 'claude',
      name: 'github',
      scope: 'project',
      config: { type: 'http', url: 'https://x' },
    })
  })
})
