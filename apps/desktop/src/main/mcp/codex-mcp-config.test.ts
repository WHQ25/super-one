import { describe, it, expect, vi, beforeEach } from 'vitest'

const { readFileSyncMock, writeFileMock, mkdirMock } = vi.hoisted(() => ({
  readFileSyncMock: vi.fn(),
  writeFileMock: vi.fn(() => Promise.resolve()),
  mkdirMock: vi.fn(() => Promise.resolve()),
}))

vi.mock('fs', () => ({ readFileSync: readFileSyncMock }))
vi.mock('fs/promises', () => ({ writeFile: writeFileMock, mkdir: mkdirMock }))
vi.mock('os', () => ({ homedir: () => '/home/testuser' }))
vi.mock('../logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { writeCodexMcpConfig, removeCodexMcpConfig } from './codex-mcp-config'

describe('writeCodexMcpConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates config from scratch when no file exists', async () => {
    readFileSyncMock.mockImplementation(() => { throw new Error('ENOENT') })

    await writeCodexMcpConfig(9100)

    expect(mkdirMock).toHaveBeenCalledWith('/home/testuser/.codex', { recursive: true })
    expect(writeFileMock).toHaveBeenCalledWith(
      '/home/testuser/.codex/config.toml',
      expect.stringContaining('url = "http://127.0.0.1:9100/mcp"'),
      'utf-8',
    )
  })

  it('preserves existing mcp_servers entries', async () => {
    readFileSyncMock.mockReturnValue(`
[mcp_servers.filesystem]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-filesystem"]
`)

    await writeCodexMcpConfig(8080)

    const written = writeFileMock.mock.calls[0][1] as string
    expect(written).toContain('filesystem')
    expect(written).toContain('url = "http://127.0.0.1:8080/mcp"')
  })

  it('preserves non-mcp config sections', async () => {
    readFileSyncMock.mockReturnValue('model = "o3"\n')

    await writeCodexMcpConfig(3000)

    const written = writeFileMock.mock.calls[0][1] as string
    expect(written).toContain('model = "o3"')
    expect(written).toContain('url = "http://127.0.0.1:3000/mcp"')
  })

  it('updates existing superone entry with new port', async () => {
    readFileSyncMock.mockReturnValue(`
[mcp_servers.superone]
url = "http://127.0.0.1:9999/mcp"
`)

    await writeCodexMcpConfig(4000)

    const written = writeFileMock.mock.calls[0][1] as string
    expect(written).toContain('url = "http://127.0.0.1:4000/mcp"')
    expect(written).not.toContain('9999')
  })

  it('handles malformed TOML gracefully', async () => {
    readFileSyncMock.mockReturnValue('this is not valid toml {{{')

    await writeCodexMcpConfig(5000)

    const written = writeFileMock.mock.calls[0][1] as string
    expect(written).toContain('url = "http://127.0.0.1:5000/mcp"')
  })
})

describe('removeCodexMcpConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('no-ops when config file does not exist', async () => {
    readFileSyncMock.mockImplementation(() => { throw new Error('ENOENT') })

    await removeCodexMcpConfig()

    expect(writeFileMock).not.toHaveBeenCalled()
  })

  it('removes superone entry and keeps others', async () => {
    readFileSyncMock.mockReturnValue(`
[mcp_servers.superone]
url = "http://127.0.0.1:9100/mcp"

[mcp_servers.filesystem]
command = "npx"
`)

    await removeCodexMcpConfig()

    const written = writeFileMock.mock.calls[0][1] as string
    expect(written).not.toContain('superone')
    expect(written).toContain('filesystem')
  })

  it('removes mcp_servers section entirely when superone was the only entry', async () => {
    readFileSyncMock.mockReturnValue(`
model = "o3"

[mcp_servers.superone]
url = "http://127.0.0.1:9100/mcp"
`)

    await removeCodexMcpConfig()

    const written = writeFileMock.mock.calls[0][1] as string
    expect(written).toContain('model = "o3"')
    expect(written).not.toContain('mcp_servers')
  })

  it('no-ops when superone entry does not exist', async () => {
    readFileSyncMock.mockReturnValue(`
[mcp_servers.filesystem]
command = "npx"
`)

    await removeCodexMcpConfig()

    expect(writeFileMock).not.toHaveBeenCalled()
  })
})
