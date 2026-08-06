import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  ensureMcpMerge,
  resolveMcpMergeMode,
  toClaudeSdkMcpEntry,
  toCodexThreadMcpEntry,
  HOST_ACTION_MCP_NAME,
} from './mcp-merge'
import { saveMcpConfig } from './mcp-config'

describe('resolveMcpMergeMode', () => {
  it('defaults to merge', () => {
    expect(resolveMcpMergeMode({})).toBe('merge')
    expect(resolveMcpMergeMode({ SUPERONE_MCP_MERGE: '1' })).toBe('merge')
    expect(resolveMcpMergeMode({ SUPERONE_MCP_MERGE: 'yes' })).toBe('merge')
  })

  it('host-action-only from env flags', () => {
    expect(resolveMcpMergeMode({ SUPERONE_MCP_MERGE: '0' })).toBe('host-action-only')
    expect(resolveMcpMergeMode({ SUPERONE_MCP_MERGE: 'false' })).toBe('host-action-only')
    expect(resolveMcpMergeMode({ SUPERONE_MCP_MERGE: 'off' })).toBe('host-action-only')
    expect(resolveMcpMergeMode({ SUPERONE_MCP_MERGE: 'host-action-only' })).toBe(
      'host-action-only',
    )
  })
})

describe('toClaudeSdkMcpEntry / toCodexThreadMcpEntry', () => {
  it('maps stdio and http, skips disabled', () => {
    expect(
      toClaudeSdkMcpEntry({
        name: 'a',
        type: 'stdio',
        scope: 'project',
        command: 'npx',
        args: ['-y', 'srv'],
      }),
    ).toEqual({ type: 'stdio', command: 'npx', args: ['-y', 'srv'] })

    expect(
      toClaudeSdkMcpEntry({
        name: 'b',
        type: 'http',
        scope: 'user',
        url: 'https://mcp.example/mcp',
        headers: { Authorization: 'Bearer x' },
      }),
    ).toEqual({
      type: 'http',
      url: 'https://mcp.example/mcp',
      headers: { Authorization: 'Bearer x' },
    })

    expect(
      toClaudeSdkMcpEntry({
        name: 'c',
        type: 'stdio',
        scope: 'user',
        command: 'x',
        disabled: true,
      }),
    ).toBeNull()

    expect(
      toCodexThreadMcpEntry({
        name: 'h',
        type: 'http',
        scope: 'project',
        url: 'https://x',
        headers: { A: '1' },
      }),
    ).toEqual({ url: 'https://x', http_headers: { A: '1' } })
  })
})

describe('ensureMcpMerge', () => {
  let home: string
  let project: string

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'mcp-merge-home-'))
    project = mkdtempSync(join(tmpdir(), 'mcp-merge-proj-'))
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
    rmSync(project, { recursive: true, force: true })
  })

  it('merges enabled disk MCP with host-action superone (claude)', () => {
    saveMcpConfig(
      'claude',
      'github',
      { type: 'http', url: 'https://mcp.github.com' },
      'project',
      project,
      { homeDir: home },
    )
    saveMcpConfig(
      'claude',
      'disabled-one',
      { type: 'stdio', command: 'echo' },
      'user',
      project,
      { homeDir: home },
    )
    // mark disabled
    const userPath = join(home, '.claude.json')
    const user = JSON.parse(readFileSync(userPath, 'utf8')) as {
      mcpServers: Record<string, Record<string, unknown>>
    }
    user.mcpServers['disabled-one']!.disabled = true
    writeFileSync(userPath, JSON.stringify(user))

    const sdk = { type: 'sdk' as const, name: 'superone', instance: { id: 1 } }
    const result = ensureMcpMerge({
      provider: 'claude',
      cwd: project,
      homeDir: home,
      hostActionServers: { [HOST_ACTION_MCP_NAME]: sdk },
    })

    expect(result.mode).toBe('merge')
    expect(result.strictMcpConfig).toBe(true)
    expect(result.claudeMcpServers.superone).toEqual(sdk)
    expect(result.claudeMcpServers.github).toEqual({
      type: 'http',
      url: 'https://mcp.github.com',
    })
    expect(result.claudeMcpServers['disabled-one']).toBeUndefined()
    expect(result.diskNames).toContain('github')
    expect(result.diskNames).not.toContain('disabled-one')
  })

  it('host-action-only ignores disk configs', () => {
    saveMcpConfig(
      'claude',
      'github',
      { type: 'http', url: 'https://mcp.github.com' },
      'project',
      project,
      { homeDir: home },
    )
    const result = ensureMcpMerge({
      provider: 'claude',
      cwd: project,
      homeDir: home,
      mode: 'host-action-only',
      hostActionServers: {
        superone: { type: 'sdk', name: 'superone', instance: {} },
      },
    })
    expect(result.diskNames).toEqual([])
    expect(Object.keys(result.claudeMcpServers)).toEqual(['superone'])
  })

  it('never lets disk overwrite reserved superone name', () => {
    writeFileSync(
      join(project, '.mcp.json'),
      JSON.stringify({
        mcpServers: {
          superone: { type: 'stdio', command: 'evil' },
          tools: { type: 'stdio', command: 'node', args: ['t.js'] },
        },
      }),
    )
    const result = ensureMcpMerge({
      provider: 'claude',
      cwd: project,
      homeDir: home,
      hostActionServers: {
        superone: { type: 'sdk', name: 'superone', instance: { ok: true } },
      },
    })
    expect(result.claudeMcpServers.superone).toEqual({
      type: 'sdk',
      name: 'superone',
      instance: { ok: true },
    })
    expect(result.claudeMcpServers.tools).toMatchObject({
      type: 'stdio',
      command: 'node',
    })
  })

  it('merges codex mcp_servers for thread config', () => {
    const codexHome = join(home, '.codex')
    mkdirSync(codexHome, { recursive: true })
    saveMcpConfig(
      'codex',
      'linear',
      { type: 'http', url: 'https://mcp.linear.app/mcp', headers: { A: '1' } },
      'user',
      project,
      { homeDir: home, codexHome },
    )

    const result = ensureMcpMerge({
      provider: 'codex',
      cwd: project,
      homeDir: home,
      codexHome,
      hostActionServers: {
        superone: {
          url: 'http://127.0.0.1:9/mcp',
          http_headers: { Authorization: 'Bearer t' },
          startup_timeout_sec: 60,
        },
      },
    })

    expect(result.codexMcpServers.superone).toMatchObject({
      url: 'http://127.0.0.1:9/mcp',
    })
    expect(result.codexMcpServers.linear).toEqual({
      url: 'https://mcp.linear.app/mcp',
      http_headers: { A: '1' },
    })
  })
})
