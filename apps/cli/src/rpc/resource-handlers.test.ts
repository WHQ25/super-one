import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { AuthenticatedClient } from '../auth/auth-service'
import type { ProjectRegistry } from '../workspace/project-registry'
import { dispatchResourceRpc } from './resource-handlers'

function client(scopes: AuthenticatedClient['scopes']): AuthenticatedClient {
  return {
    clientSessionId: 'c1',
    deviceId: 'd1',
    scopes,
    pairedAt: Date.now(),
  } as AuthenticatedClient
}

describe('resource RPC handlers', () => {
  let projectDir: string
  let homeDir: string
  let projects: ProjectRegistry

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'res-rpc-'))
    homeDir = mkdtempSync(join(tmpdir(), 'res-home-'))
    projects = {
      get: (id: string) =>
        id === 'p1' ? { projectId: 'p1', path: projectDir, name: 't', repoIdentity: null } : null,
      touch: () => {},
    } as unknown as ProjectRegistry
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

  it('installs and lists a skill via skills.* RPC', () => {
    const ctx = ctxFor(['workspace:read', 'workspace:write'])

    const installed = dispatchResourceRpc(
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

    const listed = dispatchResourceRpc(
      'skills.list',
      { projectId: 'p1', provider: 'claude' },
      ctx,
    )
    const skills = (listed?.result as { skills: Array<{ name: string }> }).skills
    expect(skills.some((s) => s.name === 'demo')).toBe(true)

    const deleted = dispatchResourceRpc(
      'skills.delete',
      { projectId: 'p1', provider: 'claude', sourcePath: skill.sourcePath },
      ctx,
    )
    expect(deleted?.result).toEqual({ ok: true, provider: 'claude' })
  })

  it('saves and lists claude MCP via mcp.* RPC', () => {
    const ctx = ctxFor(['workspace:read', 'workspace:write'])

    const saved = dispatchResourceRpc(
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

    const listed = dispatchResourceRpc(
      'mcp.list',
      { projectId: 'p1', provider: 'claude' },
      ctx,
    )
    const servers = (listed?.result as { servers: Array<{ name: string; command?: string }> })
      .servers
    expect(servers.some((s) => s.name === 'tools' && s.command === 'node')).toBe(true)

    const toggled = dispatchResourceRpc(
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

    const deleted = dispatchResourceRpc(
      'mcp.delete',
      { projectId: 'p1', provider: 'claude', name: 'tools', scope: 'project' },
      ctx,
    )
    expect(deleted?.result).toEqual({ ok: true, provider: 'claude' })
  })

  it('forbids write without workspace:write', () => {
    const ctx = ctxFor(['workspace:read'])
    const res = dispatchResourceRpc(
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

  it('requires provider for mcp.list', () => {
    const ctx = ctxFor(['workspace:read'])
    const res = dispatchResourceRpc('mcp.list', { projectId: 'p1' }, ctx)
    expect(res?.error?.code).toBe('invalid_argument')
  })

  it('does not expose MCP env or headers without node:admin', () => {
    const ctx = ctxFor(['workspace:read', 'workspace:write'])
    const saved = dispatchResourceRpc(
      'mcp.save',
      {
        projectId: 'p1',
        provider: 'claude',
        name: 'secret-tools',
        scope: 'project',
        config: {
          type: 'http',
          url: 'https://example.test/mcp',
          headers: { Authorization: 'Bearer top-secret' },
        },
      },
      ctx,
    )
    expect(saved?.error).toBeUndefined()

    const listed = dispatchResourceRpc(
      'mcp.list',
      { projectId: 'p1', provider: 'claude' },
      ctx,
    )
    const server = (listed?.result as { servers: Array<Record<string, unknown>> }).servers.find(
      (entry) => entry.name === 'secret-tools',
    )
    expect(server).toBeDefined()
    expect(server).not.toHaveProperty('headers')
  })

  it('requires node:admin for user-scope writes', () => {
    const ctx = ctxFor(['workspace:read', 'workspace:write'])
    const result = dispatchResourceRpc(
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

  it('rejects an unknown skills provider instead of defaulting to Claude', () => {
    const ctx = ctxFor(['workspace:read'])
    const res = dispatchResourceRpc('skills.list', { projectId: 'p1', provider: 'other' }, ctx)
    expect(res?.error?.code).toBe('invalid_argument')
  })
})
