import { describe, expect, it } from 'vitest'
import { mapCodexMcpStatusForIpc } from './codex-mcp-status'

describe('mapCodexMcpStatusForIpc', () => {
  it('maps connected tools and resources', () => {
    expect(mapCodexMcpStatusForIpc({
      name: 'docs',
      serverInfo: { name: 'docs', version: '1' },
      authStatus: 'unsupported',
      tools: { search: { name: 'search', description: 'Find docs' } },
      resources: [{ uri: 'docs://guide', name: 'Guide', mimeType: 'text/markdown' }],
    })).toMatchObject({
      name: 'docs',
      status: 'connected',
      toolCount: 1,
      tools: [{ name: 'search', description: 'Find docs' }],
      resources: [{ uri: 'docs://guide', name: 'Guide', mimeType: 'text/markdown' }],
      authStatus: 'unknown',
    })
  })

  it('maps an OAuth server without a token to needs-auth', () => {
    expect(mapCodexMcpStatusForIpc({ name: 'linear', authStatus: 'notLoggedIn', serverInfo: null }))
      .toMatchObject({ name: 'linear', status: 'needs-auth', authStatus: 'needs-auth' })
  })

  it('maps a server without handshake info to failed and drops malformed entries', () => {
    expect(mapCodexMcpStatusForIpc({ name: 'broken', authStatus: 'unsupported', serverInfo: null }))
      .toMatchObject({ name: 'broken', status: 'failed' })
    expect(mapCodexMcpStatusForIpc({ serverInfo: {} })).toBeNull()
  })
})
