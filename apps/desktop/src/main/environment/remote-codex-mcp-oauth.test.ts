import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { relayCodexMcpOauth } from './remote-resources'

const servers: Server[] = []
afterEach(() => { for (const s of servers.splice(0)) s.close() })

async function listen(port = 0): Promise<{ server: Server; port: number }> {
  const server = createServer((_req, res) => res.end())
  servers.push(server)
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r))
  return { server, port: (server.address() as { port: number }).port }
}

async function freePort(): Promise<number> {
  const { server, port } = await listen()
  await new Promise((r) => server.close(r))
  return port
}

function nodeGateway(port: number) {
  const authorizationUrl = `https://mcp.example/authorize?state=s1&redirect_uri=${encodeURIComponent(`http://127.0.0.1:${port}/callback`)}`
  return {
    authorizationUrl,
    codexLoginMcpOauth: vi.fn(async () => ({ loginId: 'login-1', authorizationUrl })),
    codexCompleteMcpOauth: vi.fn(async () => ({ success: true })),
  }
}

describe('relayCodexMcpOauth', () => {
  it("opens the node's authorization page here and hands the browser's redirect back to the node", async () => {
    const port = await freePort()
    const gw = nodeGateway(port)
    const callback = `http://127.0.0.1:${port}/callback?code=c1&state=s1`
    // The browser lands on this desktop's loopback, where Codex is not listening.
    const openUrl = vi.fn(async () => { void fetch(callback) })

    expect(await relayCodexMcpOauth(gw, 'p1', 'linear', null, undefined, openUrl)).toEqual({ success: true })
    expect(openUrl).toHaveBeenCalledWith(gw.authorizationUrl)
    expect(gw.codexLoginMcpOauth).toHaveBeenCalledWith('p1', 'linear', null, undefined)
    expect(gw.codexCompleteMcpOauth).toHaveBeenCalledWith('login-1', callback)
  })

  it('lets the redirect reach the node itself when it listens on this machine', async () => {
    const { port } = await listen()
    const gw = nodeGateway(port)

    expect(await relayCodexMcpOauth(gw, 'p1', 'linear', null, undefined, async () => {})).toEqual({ success: true })
    expect(gw.codexCompleteMcpOauth).toHaveBeenCalledWith('login-1', null)
  })

  it('opens no sign-in page that is not a web page', async () => {
    for (const authorizationUrl of ['file:///System/Applications/Calculator.app', 'vscode://extension/x']) {
      const gw = { ...nodeGateway(1), codexLoginMcpOauth: vi.fn(async () => ({ loginId: 'login-1', authorizationUrl })) }
      const openUrl = vi.fn(async () => {})

      expect(await relayCodexMcpOauth(gw, 'p1', 'linear', null, undefined, openUrl)).toEqual({ success: false, error: 'The MCP server returned an unsupported sign-in URL' })
      expect(openUrl).not.toHaveBeenCalled()
      expect(gw.codexCompleteMcpOauth).not.toHaveBeenCalled()
    }
  })

  it('answers a sign-in the node could not start without opening anything', async () => {
    const gw = { ...nodeGateway(1), codexLoginMcpOauth: vi.fn(async () => ({ success: false, error: 'Codex returned no authorization URL' })) }
    const openUrl = vi.fn(async () => {})

    expect(await relayCodexMcpOauth(gw, 'p1', 'linear', null, undefined, openUrl)).toEqual({ success: false, error: 'Codex returned no authorization URL' })
    expect(openUrl).not.toHaveBeenCalled()
    expect(gw.codexCompleteMcpOauth).not.toHaveBeenCalled()
  })
})
