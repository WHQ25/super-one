import { describe, expect, it, vi } from 'vitest'
import {
  deleteRemoteManagedHook,
  deleteRemoteManagedMcp,
  deleteRemoteManagedPlugin,
  getRemoteManagedPlugin,
  installRemoteManagedPlugin,
  listRemoteManagedHooks,
  listRemoteManagedMcp,
  listRemoteManagedPlugins,
  listRemoteManagedSkills,
  saveRemoteManagedHook,
  saveRemoteManagedMcp,
  updateRemoteManagedPlugin,
} from './remote-resources'
import { RemoteEnvironmentGateway } from './remote-environment-gateway'
import type { EnvironmentHost } from './environment-host'

function mockHost(opts: {
  folderPath?: string
  projectId?: string
  environmentId?: string
  connectionId?: string
  gw?: RemoteEnvironmentGateway | null
}): EnvironmentHost {
  const connectionId = opts.connectionId ?? 'conn-1'
  const environmentId = opts.environmentId ?? 'env-1'
  const projectId = opts.projectId ?? 'proj-1'
  const hostPath = '/work/app'
  const gw = opts.gw ?? null

  return {
    connections: {
      listKnown: () => [{ connectionId, environmentId }],
    },
    listProjects: async () => [{ projectId, path: hostPath, name: 'app' }],
    openProject: async () => ({ projectId, path: hostPath, name: 'app' }),
    getGateway: () => gw,
  } as unknown as EnvironmentHost
}

describe('remote-resources (skills.*/mcp.*/plugins.*/hooks.* via gateway)', () => {
  it('returns null for local (non-remote) paths', async () => {
    const host = mockHost({})
    expect(await listRemoteManagedSkills(host, '/local/app')).toBeNull()
    expect(await listRemoteManagedMcp(host, '/local/app', 'claude')).toBeNull()
    expect(await listRemoteManagedPlugins(host, '/local/app')).toBeNull()
    expect(await listRemoteManagedHooks(host, '/local/app')).toBeNull()
  })

  it('lists skills via skills.list on RemoteEnvironmentGateway', async () => {
    const skillsList = vi.fn(async () => ({
      skills: [{ name: 'deploy', description: 'd', scope: 'project', sourcePath: '/n/deploy' }],
      provider: 'claude',
    }))
    const gw = { skillsList } as unknown as RemoteEnvironmentGateway
    Object.setPrototypeOf(gw, RemoteEnvironmentGateway.prototype)

    const host = mockHost({ gw })
    const skills = await listRemoteManagedSkills(host, 'remote:conn-1:/work/app', 'claude')
    expect(skillsList).toHaveBeenCalledWith('proj-1', 'claude')
    expect(skills).toEqual([
      { name: 'deploy', description: 'd', scope: 'project', sourcePath: '/n/deploy' },
    ])
  })

  it('lists / saves / deletes MCP via mcp.* RPC methods', async () => {
    const mcpList = vi.fn(async () => ({
      servers: [{ name: 'github', type: 'http', scope: 'project', url: 'https://x' }],
      provider: 'claude',
    }))
    const mcpSave = vi.fn(async () => ({ ok: true, provider: 'claude' }))
    const mcpDelete = vi.fn(async () => ({ ok: true, provider: 'claude' }))
    const gw = { mcpList, mcpSave, mcpDelete } as unknown as RemoteEnvironmentGateway
    Object.setPrototypeOf(gw, RemoteEnvironmentGateway.prototype)

    const host = mockHost({ gw })
    const folder = 'remote:conn-1:/work/app'

    const listed = await listRemoteManagedMcp(host, folder, 'claude')
    expect(mcpList).toHaveBeenCalledWith('proj-1', 'claude')
    expect(listed?.[0]?.name).toBe('github')

    const saved = await saveRemoteManagedMcp(host, folder, {
      provider: 'claude',
      name: 'github',
      scope: 'project',
      config: { type: 'http', url: 'https://x' },
    })
    expect(saved).toBe(true)
    expect(mcpSave).toHaveBeenCalledWith('proj-1', {
      provider: 'claude',
      name: 'github',
      scope: 'project',
      config: { type: 'http', url: 'https://x' },
    })

    const deleted = await deleteRemoteManagedMcp(host, folder, {
      provider: 'claude',
      name: 'github',
      scope: 'project',
    })
    expect(deleted).toBe(true)
    expect(mcpDelete).toHaveBeenCalled()
  })

  it('returns empty arrays when gateway is not remote', async () => {
    const host = mockHost({ gw: null })
    expect(await listRemoteManagedSkills(host, 'remote:conn-1:/work/app')).toEqual([])
    expect(await listRemoteManagedMcp(host, 'remote:conn-1:/work/app', 'codex')).toEqual([])
    expect(await listRemoteManagedPlugins(host, 'remote:conn-1:/work/app')).toEqual([])
    expect(await listRemoteManagedHooks(host, 'remote:conn-1:/work/app')).toEqual([])
  })

  it('lists plugins via plugins.list on RemoteEnvironmentGateway', async () => {
    const pluginsList = vi.fn(async () => ({
      plugins: [{ name: 'demo', key: 'demo@mp', marketplace: 'mp', scope: 'user' }],
      provider: 'claude',
    }))
    const gw = { pluginsList } as unknown as RemoteEnvironmentGateway
    Object.setPrototypeOf(gw, RemoteEnvironmentGateway.prototype)

    const host = mockHost({ gw })
    const plugins = await listRemoteManagedPlugins(host, 'remote:conn-1:/work/app')
    expect(pluginsList).toHaveBeenCalledWith('proj-1')
    expect(plugins?.[0]?.name).toBe('demo')
  })

  it('installs / deletes / updates plugins via plugins.* on RemoteEnvironmentGateway', async () => {
    const pluginsInstall = vi.fn(async () => ({ ok: true, provider: 'claude' }))
    const pluginsDelete = vi.fn(async () => ({ ok: true, provider: 'claude' }))
    const pluginsUpdate = vi.fn(async () => ({ ok: true, provider: 'claude' }))
    const pluginsGet = vi.fn(async () => ({
      plugin: { name: 'demo', key: 'demo@mp' },
      provider: 'claude',
    }))
    const gw = {
      pluginsInstall,
      pluginsDelete,
      pluginsUpdate,
      pluginsGet,
    } as unknown as RemoteEnvironmentGateway
    Object.setPrototypeOf(gw, RemoteEnvironmentGateway.prototype)
    const host = mockHost({ gw })
    const folder = 'remote:conn-1:/work/app'

    expect(await installRemoteManagedPlugin(host, folder, 'demo@mp', 'user')).toBe(true)
    expect(pluginsInstall).toHaveBeenCalledWith('proj-1', 'demo@mp', 'user')
    expect(await deleteRemoteManagedPlugin(host, folder, 'demo@mp', 'user')).toBe(true)
    expect(pluginsDelete).toHaveBeenCalledWith('proj-1', 'demo@mp', 'user')
    expect(await updateRemoteManagedPlugin(host, folder, 'demo@mp', 'project')).toBe(true)
    expect(pluginsUpdate).toHaveBeenCalledWith('proj-1', 'demo@mp', 'project')
    expect(await getRemoteManagedPlugin(host, folder, 'demo@mp')).toEqual({
      name: 'demo',
      key: 'demo@mp',
    })
    expect(pluginsGet).toHaveBeenCalledWith('proj-1', 'demo@mp')
  })

  it('lists / saves / deletes hooks via hooks.* RPC methods', async () => {
    const hooksList = vi.fn(async () => ({
      hooks: [{ id: 'project:Stop:0', scope: 'project', event: 'Stop', entry: { type: 'command', command: 'echo' } }],
    }))
    const hooksSave = vi.fn(async () => ({ ok: true }))
    const hooksDelete = vi.fn(async () => ({ ok: true }))
    const gw = { hooksList, hooksSave, hooksDelete } as unknown as RemoteEnvironmentGateway
    Object.setPrototypeOf(gw, RemoteEnvironmentGateway.prototype)

    const host = mockHost({ gw })
    const folder = 'remote:conn-1:/work/app'

    const listed = await listRemoteManagedHooks(host, folder)
    expect(hooksList).toHaveBeenCalledWith('proj-1')
    expect(listed?.[0]?.id).toBe('project:Stop:0')

    const payload = {
      scope: 'project' as const,
      event: 'Stop' as const,
      entry: { type: 'command' as const, command: 'echo stop' },
    }
    expect(await saveRemoteManagedHook(host, folder, payload)).toBe(true)
    expect(hooksSave).toHaveBeenCalledWith('proj-1', payload, undefined)

    expect(await deleteRemoteManagedHook(host, folder, 'project:Stop:0')).toBe(true)
    expect(hooksDelete).toHaveBeenCalledWith('proj-1', 'project:Stop:0')
  })
})
