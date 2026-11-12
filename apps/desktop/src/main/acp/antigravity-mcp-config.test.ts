import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  antigravityGlobalSuperoneServerName,
  ensureAntigravityGlobalSuperoneMcpConfig,
  extractSuperoneSessionEnv,
  resolveAntigravityGlobalMcpConfigPath,
} from './antigravity-mcp-config'
import type { SuperoneMcpStdioConfig } from '../mcp/superone-mcp-stdio-state'

const tempDirs: string[] = []

function makeTempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'superone-agy-mcp-'))
  tempDirs.push(dir)
  return dir
}

const sampleStdioConfig: SuperoneMcpStdioConfig = {
  command: '/app/Electron',
  args: ['/app/out/main/superone-mcp-stdio-bridge.js'],
  env: {
    ELECTRON_RUN_AS_NODE: '1',
    CUSTOM_NODE_OPT: 'abc',
    SUPERONE_MCP_IPC_ENDPOINT: '/tmp/superone.sock',
    SUPERONE_MCP_IPC_TOKEN: 'secret-session-token',
    SUPERONE_MCP_SESSION_ID: 'session-123',
  },
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('antigravity-mcp-config', () => {
  it('maps variants to distinct MCP server names', () => {
    expect(antigravityGlobalSuperoneServerName('stable')).toBe('superone')
    expect(antigravityGlobalSuperoneServerName('alpha')).toBe('superone-alpha')
    expect(antigravityGlobalSuperoneServerName('dev')).toBe('superone-dev')
  })

  it('writes generic superone entry without session credentials and preserves existing servers', () => {
    const home = makeTempHome()
    const configPath = resolveAntigravityGlobalMcpConfigPath(home)
    mkdirSync(join(home, '.gemini', 'config'), { recursive: true })
    writeFileSync(
      configPath,
      JSON.stringify({
        mcpServers: {
          github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] },
        },
        otherSetting: true,
      }),
      'utf8',
    )

    expect(ensureAntigravityGlobalSuperoneMcpConfig(sampleStdioConfig, home, 'dev')).toBe(true)
    expect(ensureAntigravityGlobalSuperoneMcpConfig(sampleStdioConfig, home, 'alpha')).toBe(true)
    expect(ensureAntigravityGlobalSuperoneMcpConfig(sampleStdioConfig, home, 'stable')).toBe(true)

    const saved = JSON.parse(readFileSync(configPath, 'utf8'))
    expect(saved.otherSetting).toBe(true)
    expect(saved.mcpServers.github).toEqual({
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
    })
    expect(saved.mcpServers['superone-dev']).toEqual({
      command: '/app/Electron',
      args: ['/app/out/main/superone-mcp-stdio-bridge.js'],
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        CUSTOM_NODE_OPT: 'abc',
        SUPERONE_MCP_EXPECTED_VARIANT: 'dev',
      },
    })
    expect(saved.mcpServers['superone-alpha'].env.SUPERONE_MCP_EXPECTED_VARIANT).toBe('alpha')
    expect(saved.mcpServers.superone.env.SUPERONE_MCP_EXPECTED_VARIANT).toBe('stable')
  })

  it('is idempotent when entry already matches', () => {
    const home = makeTempHome()
    expect(ensureAntigravityGlobalSuperoneMcpConfig(sampleStdioConfig, home, 'dev')).toBe(true)
    const configPath = resolveAntigravityGlobalMcpConfigPath(home)
    const first = readFileSync(configPath, 'utf8')
    expect(ensureAntigravityGlobalSuperoneMcpConfig(sampleStdioConfig, home, 'dev')).toBe(true)
    expect(readFileSync(configPath, 'utf8')).toBe(first)
  })

  it('returns false without overwriting when existing mcp_config.json is invalid JSON', () => {
    const home = makeTempHome()
    const configPath = resolveAntigravityGlobalMcpConfigPath(home)
    mkdirSync(join(home, '.gemini', 'config'), { recursive: true })
    writeFileSync(configPath, '{ invalid json', 'utf8')

    expect(ensureAntigravityGlobalSuperoneMcpConfig(sampleStdioConfig, home, 'dev')).toBe(false)
    expect(readFileSync(configPath, 'utf8')).toBe('{ invalid json')
  })

  it('extracts session-specific env vars and active variant', () => {
    expect(extractSuperoneSessionEnv(sampleStdioConfig, 'alpha')).toEqual({
      SUPERONE_MCP_VARIANT: 'alpha',
      SUPERONE_MCP_IPC_ENDPOINT: '/tmp/superone.sock',
      SUPERONE_MCP_IPC_TOKEN: 'secret-session-token',
      SUPERONE_MCP_SESSION_ID: 'session-123',
    })
  })
})
