import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  deleteDshMcpConfig,
  getDshPatchPath,
  listDshMcpConfigs,
  saveDshMcpConfig,
  toggleDshMcpConfig,
} from './mcp-config-dsh'

const dirs: string[] = []

function dshHome(patch?: string): { dshHome: string } {
  const home = mkdtempSync(join(tmpdir(), 'dsh-home-'))
  dirs.push(home)
  if (patch !== undefined) {
    const file = getDshPatchPath({ dshHome: home })
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, patch)
  }
  return { dshHome: home }
}

function readPatch(opts: { dshHome: string }): string {
  return readFileSync(getDshPatchPath(opts), 'utf8')
}

const EXISTING_PATCH = `# Your patch layer for this dsh profile.
- id: shell
  name: '@deepseek-ai/dsh-bash-local'
  disabled: !!js process.platform !== 'win32'
  config:
    timeoutMs: 1000 # keep it snappy

- id: mcp-github
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: github
    transport: stdio
    command: npx
    args: ['-y', 'server-github']
`

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('dsh MCP config', () => {
  it('reads mcp-client entries out of the profile patch layer', () => {
    const opts = dshHome(EXISTING_PATCH)

    expect(listDshMcpConfigs('/any/cwd', opts)).toEqual([
      {
        name: 'github',
        scope: 'user',
        type: 'stdio',
        command: 'npx',
        args: ['-y', 'server-github'],
      },
    ])
  })

  it('returns nothing when dsh was never run', () => {
    expect(listDshMcpConfigs('/any/cwd', dshHome())).toEqual([])
  })

  // The whole point of editing dsh's own file: the user's other rows, their
  // comments, and dsh's `!!js` expressions have to survive our write.
  it('leaves every other row untouched when adding a server', () => {
    const opts = dshHome(EXISTING_PATCH)

    saveDshMcpConfig('linear', { type: 'http', url: 'https://mcp.linear.app' }, 'user', '/cwd', opts)

    const written = readPatch(opts)
    expect(written).toContain("disabled: !!js process.platform !== 'win32'")
    expect(written).toContain('# keep it snappy')
    expect(written).toContain('# Your patch layer for this dsh profile.')
    expect(listDshMcpConfigs('/cwd', opts).map((c) => c.name).sort()).toEqual(['github', 'linear'])
    // dsh has no SSE transport; an http server is written as Streamable HTTP.
    expect(written).toContain('transport: streamable-http')
  })

  it('creates the patch layer with its header when dsh has no profile yet', () => {
    const opts = dshHome()

    saveDshMcpConfig('local', { type: 'stdio', command: 'node', args: ['s.js'] }, 'user', '/cwd', opts)

    expect(readPatch(opts)).toContain('# Your patch layer for this dsh profile')
    expect(listDshMcpConfigs('/cwd', opts)).toEqual([
      { name: 'local', scope: 'user', type: 'stdio', command: 'node', args: ['s.js'] },
    ])
  })

  it('replaces only the config when a server is re-saved', () => {
    const opts = dshHome(EXISTING_PATCH)

    saveDshMcpConfig('github', { type: 'stdio', command: 'gh-mcp', args: [] }, 'user', '/cwd', opts)

    expect(readPatch(opts)).toContain('id: mcp-github')
    expect(listDshMcpConfigs('/cwd', opts)[0]).toMatchObject({ command: 'gh-mcp' })
  })

  it('toggles through the entry-level disabled flag dsh already understands', () => {
    const opts = dshHome(EXISTING_PATCH)

    toggleDshMcpConfig('github', true, 'user', '/cwd', opts)
    expect(listDshMcpConfigs('/cwd', opts)[0]?.disabled).toBe(true)

    toggleDshMcpConfig('github', false, 'user', '/cwd', opts)
    expect(listDshMcpConfigs('/cwd', opts)[0]?.disabled).toBeUndefined()
  })

  it('deletes one entry and keeps the rest of the file', () => {
    const opts = dshHome(EXISTING_PATCH)

    deleteDshMcpConfig('github', 'user', '/cwd', opts)

    expect(listDshMcpConfigs('/cwd', opts)).toEqual([])
    expect(readPatch(opts)).toContain("name: '@deepseek-ai/dsh-bash-local'")
  })

  it('rejects a project scope, because dsh composes per deployment', () => {
    const opts = dshHome(EXISTING_PATCH)

    expect(() => saveDshMcpConfig('x', { type: 'stdio', command: 'y' }, 'project', '/cwd', opts))
      .toThrow(/project scope/)
  })

  it('rejects a name dsh could not use as a tool namespace', () => {
    const opts = dshHome(EXISTING_PATCH)

    expect(() => saveDshMcpConfig('has spaces', { type: 'stdio', command: 'y' }, 'user', '/cwd', opts))
      .toThrow(/invalid MCP server name/)
  })
})
