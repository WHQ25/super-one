import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  deleteMcpConfig,
  listMcpConfigs,
  saveMcpConfig,
  toggleMcpConfig,
} from './mcp-config'

describe('mcp-config (claude)', () => {
  let home: string
  let project: string

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'mcp-home-'))
    project = mkdtempSync(join(tmpdir(), 'mcp-proj-'))
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
    rmSync(project, { recursive: true, force: true })
  })

  it('saves project stdio server to .mcp.json and authorizes in user config', () => {
    saveMcpConfig(
      'claude',
      'my-tools',
      { type: 'stdio', command: 'node', args: ['srv.js'], env: { A: '1' } },
      'project',
      project,
      { homeDir: home },
    )

    const mcpJson = JSON.parse(readFileSync(join(project, '.mcp.json'), 'utf8'))
    expect(mcpJson.mcpServers['my-tools']).toMatchObject({
      type: 'stdio',
      command: 'node',
      args: ['srv.js'],
      env: { A: '1' },
    })

    const user = JSON.parse(readFileSync(join(home, '.claude.json'), 'utf8'))
    expect(user.projects[project].enabledMcpjsonServers).toContain('my-tools')

    const listed = listMcpConfigs('claude', project, { homeDir: home })
    expect(listed.some((s) => s.name === 'my-tools' && s.scope === 'project')).toBe(true)
  })

  it('toggles and deletes user-scope server', () => {
    saveMcpConfig(
      'claude',
      'user-srv',
      { type: 'http', url: 'https://example.com/mcp' },
      'user',
      project,
      { homeDir: home },
    )
    toggleMcpConfig('claude', 'user-srv', true, 'user', project, { homeDir: home })
    let listed = listMcpConfigs('claude', project, { homeDir: home })
    expect(listed.find((s) => s.name === 'user-srv')?.disabled).toBe(true)

    deleteMcpConfig('claude', 'user-srv', 'user', project, { homeDir: home })
    listed = listMcpConfigs('claude', project, { homeDir: home })
    expect(listed.find((s) => s.name === 'user-srv')).toBeUndefined()
  })

  it('merges user and project with user first-wins on name', () => {
    writeFileSync(
      join(home, '.claude.json'),
      JSON.stringify({ mcpServers: { shared: { command: 'user-cmd' } } }),
    )
    writeFileSync(
      join(project, '.mcp.json'),
      JSON.stringify({ mcpServers: { shared: { command: 'proj-cmd' } } }),
    )
    const listed = listMcpConfigs('claude', project, { homeDir: home })
    expect(listed).toHaveLength(1)
    expect(listed[0]?.command).toBe('user-cmd')
    expect(listed[0]?.scope).toBe('user')
  })
})

describe('mcp-config (codex)', () => {
  let home: string
  let project: string
  let codexHome: string

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'mcp-c-home-'))
    project = mkdtempSync(join(tmpdir(), 'mcp-c-proj-'))
    codexHome = join(home, '.codex')
    mkdirSync(codexHome, { recursive: true })
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
    rmSync(project, { recursive: true, force: true })
  })

  it('saves and lists project codex MCP in config.toml', () => {
    saveMcpConfig(
      'codex',
      'ctx7',
      { type: 'stdio', command: 'npx', args: ['-y', 'ctx7'] },
      'project',
      project,
      { homeDir: home, codexHome },
    )
    expect(existsSync(join(project, '.codex', 'config.toml'))).toBe(true)
    const listed = listMcpConfigs('codex', project, { homeDir: home, codexHome })
    expect(listed.some((s) => s.name === 'ctx7' && s.command === 'npx')).toBe(true)

    toggleMcpConfig('codex', 'ctx7', true, 'project', project, { homeDir: home, codexHome })
    const after = listMcpConfigs('codex', project, { homeDir: home, codexHome })
    expect(after.find((s) => s.name === 'ctx7')?.disabled).toBe(true)

    deleteMcpConfig('codex', 'ctx7', 'project', project, { homeDir: home, codexHome })
    expect(listMcpConfigs('codex', project, { homeDir: home, codexHome })).toEqual([])
  })
})
