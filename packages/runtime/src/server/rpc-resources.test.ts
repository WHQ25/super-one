import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { AuthenticatedClient } from './auth-service'
import { dispatchResourceRpc, type ResourceProjects } from './rpc-resources'

function client(scopes: AuthenticatedClient['scopes']): AuthenticatedClient {
  return {
    clientSessionId: 'c1',
    scopes,
    devicePublicKeyFingerprint: 'fp-d1',
    devicePublicKeyPem: '-----BEGIN PUBLIC KEY-----\nd1\n-----END PUBLIC KEY-----\n',
  }
}

describe('resource RPC handlers', () => {
  let projectDir: string
  let homeDir: string
  let projects: ResourceProjects

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'res-rpc-'))
    homeDir = mkdtempSync(join(tmpdir(), 'res-home-'))
    projects = { get: (id: string) => (id === 'p1' ? { path: projectDir } : null) }
  })

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(homeDir, { recursive: true, force: true })
  })

  function ctxFor(scopes: AuthenticatedClient['scopes']) {
    return {
      client: client(scopes),
      projects,
      homeDir,
    }
  }

  it('installs and lists a skill via skills.* RPC', async () => {
    const ctx = ctxFor(['workspace:read', 'workspace:write'])

    const installed = await dispatchResourceRpc(
      'skills.install',
      {
        projectId: 'p1',
        provider: 'claude',
        scope: 'project',
        name: 'demo',
        files: { 'SKILL.md': '---\ndescription: Demo\n---\n# demo\n' },
      },
      ctx,
    )
    expect(installed?.error).toBeUndefined()
    const skill = (installed?.result as { skill: { name: string; sourcePath: string } }).skill
    expect(skill.name).toBe('demo')

    const listed = await dispatchResourceRpc(
      'skills.list',
      { projectId: 'p1', provider: 'claude' },
      ctx,
    )
    const skills = (listed?.result as { skills: Array<{ name: string }> }).skills
    expect(skills.some((s) => s.name === 'demo')).toBe(true)

    const deleted = await dispatchResourceRpc(
      'skills.delete',
      { projectId: 'p1', provider: 'claude', sourcePath: skill.sourcePath },
      ctx,
    )
    expect(deleted?.result).toEqual({ ok: true, provider: 'claude' })
  })

  it('saves and lists claude MCP via mcp.* RPC', async () => {
    const ctx = ctxFor(['workspace:read', 'workspace:write'])

    const saved = await dispatchResourceRpc(
      'mcp.save',
      {
        projectId: 'p1',
        provider: 'claude',
        name: 'tools',
        scope: 'project',
        config: { type: 'stdio', command: 'node', args: ['x.js'] },
      },
      ctx,
    )
    expect(saved?.error).toBeUndefined()

    const listed = await dispatchResourceRpc(
      'mcp.list',
      { projectId: 'p1', provider: 'claude' },
      ctx,
    )
    const servers = (listed?.result as { servers: Array<{ name: string; command?: string }> })
      .servers
    expect(servers.some((s) => s.name === 'tools' && s.command === 'node')).toBe(true)

    const toggled = await dispatchResourceRpc(
      'mcp.toggle',
      {
        projectId: 'p1',
        provider: 'claude',
        name: 'tools',
        scope: 'project',
        disabled: true,
      },
      ctx,
    )
    expect(toggled?.error).toBeUndefined()

    const deleted = await dispatchResourceRpc(
      'mcp.delete',
      { projectId: 'p1', provider: 'claude', name: 'tools', scope: 'project' },
      ctx,
    )
    expect(deleted?.result).toEqual({ ok: true, provider: 'claude' })
  })


  it('forbids write without workspace:write', async () => {
    const ctx = ctxFor(['workspace:read'])
    const res = await dispatchResourceRpc(
      'skills.install',
      {
        projectId: 'p1',
        scope: 'project',
        name: 'x',
        files: { 'SKILL.md': '# x\n' },
      },
      ctx,
    )
    expect(res?.error?.code).toBe('forbidden')
  })

  it('requires provider for mcp.list', async () => {
    const ctx = ctxFor(['workspace:read'])
    const res = await dispatchResourceRpc('mcp.list', { projectId: 'p1' }, ctx)
    expect(res?.error?.code).toBe('invalid_argument')
  })

  it('masks MCP env and header values for every client and keeps a secret sent back masked', async () => {
    const ctx = ctxFor(['workspace:read', 'workspace:write', 'node:admin'])
    const save = (config: Record<string, unknown>) =>
      dispatchResourceRpc('mcp.save', { projectId: 'p1', provider: 'claude', name: 'secret-tools', scope: 'project', config }, ctx)
    const listed = async () => {
      const res = await dispatchResourceRpc('mcp.list', { projectId: 'p1', provider: 'claude' }, ctx)
      return (res?.result as { servers: Array<Record<string, unknown>> }).servers.find((s) => s.name === 'secret-tools')!
    }
    const stored = () => (JSON.parse(readFileSync(join(projectDir, '.mcp.json'), 'utf8')) as {
      mcpServers: Record<string, { headers?: Record<string, string> }>
    }).mcpServers['secret-tools']!

    expect((await save({ type: 'http', url: 'https://example.test/mcp', headers: { Authorization: 'Bearer top-secret-value', 'X-Team': 'abc' } }))?.error).toBeUndefined()
    const shown = await listed()
    expect(shown.headers).toEqual({ Authorization: '***-value', 'X-Team': '***' })

    // An edit that changes the URL sends the headers back as it got them.
    expect((await save({ type: 'http', url: 'https://example.test/v2', headers: shown.headers }))?.error).toBeUndefined()
    expect(stored()).toMatchObject({ url: 'https://example.test/v2', headers: { Authorization: 'Bearer top-secret-value', 'X-Team': 'abc' } })

    // A value typed anew replaces the secret.
    await save({ type: 'http', url: 'https://example.test/v2', headers: { Authorization: 'Bearer rotated', 'X-Team': '***' } })
    expect(stored().headers).toEqual({ Authorization: 'Bearer rotated', 'X-Team': 'abc' })
  })

  it('tells the host what changed after an MCP or plugin write', async () => {
    const mcpChanged = vi.fn()
    const pluginsChanged = vi.fn()
    const ctx = { ...ctxFor(['workspace:read', 'workspace:write']), mcpChanged, pluginsChanged }
    const base = { projectId: 'p1', provider: 'claude', name: 'tools', scope: 'project' }

    await dispatchResourceRpc('mcp.save', { ...base, config: { type: 'stdio', command: 'node' } }, ctx)
    await dispatchResourceRpc('mcp.toggle', { ...base, disabled: true }, ctx)
    await dispatchResourceRpc('mcp.delete', base, ctx)
    expect(mcpChanged.mock.calls.map(([change]) => change)).toEqual([
      { provider: 'claude', projectPath: projectDir, name: 'tools', enabled: true, saved: true },
      { provider: 'claude', projectPath: projectDir, name: 'tools', enabled: false, saved: false },
      { provider: 'claude', projectPath: projectDir, name: 'tools', enabled: false, saved: false },
    ])

    await dispatchResourceRpc('plugins.setEnabled', { projectId: 'p1', key: 'demo@mp', scope: 'project', enabled: false }, ctx)
    expect(pluginsChanged).toHaveBeenCalledWith(projectDir)
  })

  it('requires node:admin for user-scope writes', async () => {
    const ctx = ctxFor(['workspace:read', 'workspace:write'])
    const result = await dispatchResourceRpc(
      'mcp.save',
      {
        projectId: 'p1',
        provider: 'claude',
        name: 'user-tools',
        scope: 'user',
        config: { type: 'stdio', command: 'node' },
      },
      ctx,
    )
    expect(result?.error?.code).toBe('forbidden')
  })

  it('rejects an unknown skills provider instead of defaulting to Claude', async () => {
    const ctx = ctxFor(['workspace:read'])
    const res = await dispatchResourceRpc('skills.list', { projectId: 'p1', provider: 'other' }, ctx)
    expect(res?.error?.code).toBe('invalid_argument')
  })

  it('lists plugins and agents from node-local home over RPC', async () => {
    const { mkdirSync, writeFileSync } = await import('node:fs')
    const { join } = await import('node:path')

    mkdirSync(join(homeDir, '.claude', 'plugins', 'cache', 'mp', 'demo', '1.0', '.claude-plugin'), {
      recursive: true,
    })
    const installPath = join(homeDir, '.claude', 'plugins', 'cache', 'mp', 'demo', '1.0')
    writeFileSync(
      join(installPath, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'demo', description: 'Demo' }),
    )
    writeFileSync(
      join(homeDir, '.claude', 'plugins', 'installed_plugins.json'),
      JSON.stringify({
        version: 1,
        plugins: {
          'demo@mp': [{ scope: 'user', installPath, version: '1.0' }],
        },
      }),
    )
    writeFileSync(join(homeDir, '.claude', 'plugins', 'known_marketplaces.json'), '{}')

    mkdirSync(join(projectDir, '.claude', 'agents'), { recursive: true })
    writeFileSync(
      join(projectDir, '.claude', 'agents', 'reviewer.md'),
      '---\ndescription: Reviews\n---\n# reviewer\n',
    )

    const ctx = ctxFor(['workspace:read'])
    const pluginsRes = await dispatchResourceRpc('plugins.list', { projectId: 'p1', provider: 'claude' }, ctx)
    expect(pluginsRes?.error).toBeUndefined()
    const plugins = (pluginsRes?.result as { plugins: Array<{ name: string }> }).plugins
    expect(plugins.some((p) => p.name === 'demo')).toBe(true)

    const agentsRes = await dispatchResourceRpc('agents.list', { projectId: 'p1' }, ctx)
    expect(agentsRes?.error).toBeUndefined()
    const agents = (agentsRes?.result as { agents: Array<{ name: string; scope: string }> })
      .agents
    expect(agents.some((a) => a.name === 'reviewer' && a.scope === 'project')).toBe(true)
  })

  it('hooks.save writes project settings.json', async () => {
    const { existsSync, readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const ctx = ctxFor(['workspace:read', 'workspace:write'])

    const saved = await dispatchResourceRpc(
      'hooks.save',
      {
        projectId: 'p1',
        payload: {
          scope: 'project',
          event: 'Stop',
          entry: { type: 'command', command: 'echo stop' },
        },
      },
      ctx,
    )
    expect(saved?.error).toBeUndefined()
    expect(saved?.result).toEqual({ ok: true })

    const settingsPath = join(projectDir, '.claude', 'settings.json')
    expect(existsSync(settingsPath)).toBe(true)
    const data = JSON.parse(readFileSync(settingsPath, 'utf-8')) as {
      hooks: { Stop: Array<{ hooks: Array<{ command: string }> }> }
    }
    expect(data.hooks.Stop[0]!.hooks[0]!.command).toBe('echo stop')

    const listed = await dispatchResourceRpc('hooks.list', { projectId: 'p1' }, ctx)
    const hooks = (listed?.result as { hooks: Array<{ id: string }> }).hooks
    expect(hooks).toHaveLength(1)

    const deleted = await dispatchResourceRpc(
      'hooks.delete',
      { projectId: 'p1', id: hooks[0]!.id },
      ctx,
    )
    expect(deleted?.result).toEqual({ ok: true })
  })

  it('requires node:admin for user-scope hooks.save', async () => {
    const ctx = ctxFor(['workspace:read', 'workspace:write'])
    const res = await dispatchResourceRpc(
      'hooks.save',
      {
        projectId: 'p1',
        payload: {
          scope: 'user',
          event: 'Stop',
          entry: { type: 'command', command: 'echo' },
        },
      },
      ctx,
    )
    expect(res?.error?.code).toBe('forbidden')
  })

  it('hooks.save writes user settings.json with node:admin', async () => {
    const { existsSync, readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const ctx = ctxFor(['workspace:read', 'workspace:write', 'node:admin'])

    const saved = await dispatchResourceRpc(
      'hooks.save',
      {
        projectId: 'p1',
        payload: {
          scope: 'user',
          event: 'Stop',
          entry: { type: 'command', command: 'echo user-stop' },
        },
      },
      ctx,
    )
    expect(saved?.error).toBeUndefined()
    expect(saved?.result).toEqual({ ok: true })

    const settingsPath = join(homeDir, '.claude', 'settings.json')
    expect(existsSync(settingsPath)).toBe(true)
    const data = JSON.parse(readFileSync(settingsPath, 'utf-8')) as {
      hooks: { Stop: Array<{ hooks: Array<{ command: string }> }> }
    }
    expect(data.hooks.Stop[0]!.hooks[0]!.command).toBe('echo user-stop')
  })
})
