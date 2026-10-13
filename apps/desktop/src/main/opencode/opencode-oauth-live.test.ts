import { describe, expect, it, vi } from 'vitest'
vi.mock('../logger', () => ({ default: { debug: vi.fn(), warn: vi.fn(), info: vi.fn() } }))
import { OpenCodeV2Client } from './opencode-v2-client'
import { OpenCodeOAuth } from './opencode-oauth'
import { startOpenCodeOAuthProvider } from '../../test/fixtures/opencode-oauth-provider'

const baseUrl = process.env.SUPERONE_OPENCODE_SMOKE_URL
const directory = process.env.SUPERONE_OPENCODE_SMOKE_DIRECTORY

describe('OpenCode V2 native OAuth smoke', () => {
  it.skipIf(!baseUrl || !directory)('signs into an isolated OAuth MCP provider through native attempts without an account or model', async () => {
    const provider = await startOpenCodeOAuthProvider()
    const client = new OpenCodeV2Client({ baseUrl: baseUrl!, directory: directory!, password: process.env.SUPERONE_OPENCODE_SMOKE_PASSWORD })
    const session = await client.createSession([])
    const name = `oauth_fixture_${Date.now()}`
    const oauth = new OpenCodeOAuth({ client, sessionId: session.id, signal: new AbortController().signal,
      onEvent: () => {}, openUrl: async (url) => { expect((await fetch(url)).ok).toBe(true) }, pollMs: 100, timeoutMs: 15000 })
    try {
      await client.putMcp(name, { type: 'remote', url: `${provider.baseUrl}/mcp`, codemode: false })
      await vi.waitFor(async () => expect((await client.nativeMcpServers()).find((server) => server.name === name)).toMatchObject({
        status: { status: 'needs_auth' }, integrationID: expect.any(String),
      }), { timeout: 5000 })
      await oauth.authenticate(name)
      expect(provider.authorized).toBe(true)
      expect((await client.nativeMcpServers()).find((server) => server.name === name)).toMatchObject({ status: { status: 'connected' } })
      expect(oauth.snapshotEvents).toEqual([])
    } finally {
      await oauth.close()
      await client.disconnectMcp(name).catch(() => undefined)
      await client.deleteSession(session.id)
      await provider.close()
    }
  }, 30000)
})
