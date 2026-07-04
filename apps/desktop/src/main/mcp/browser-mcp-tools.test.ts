import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../browser/browser-automation-bridge', () => ({
  browserAutomationCall: vi.fn(),
}))

const gates = {
  cdp: false,
  network: false,
  cookies: false,
  mock: false,
  emulate: false,
}

vi.mock('../browser/browser-cdp', () => ({
  isCdpEnabled: () => gates.cdp,
  isCdpNetworkEnabled: () => gates.cdp && gates.network,
  isCdpCookiesEnabled: () => gates.cdp && gates.cookies,
  isCdpMockEnabled: () => gates.cdp && gates.mock,
  isCdpEmulateEnabled: () => gates.cdp && gates.emulate,
  resolveCdpTarget: vi.fn(async () => 7),
  cdpScreenshot: vi.fn(),
  cdpClick: vi.fn(),
  cdpDrag: vi.fn(),
  cdpPress: vi.fn(),
  cdpType: vi.fn(),
  cdpEmulate: vi.fn(),
  cdpGetCookies: vi.fn(async () => [{ name: 'a' }]),
  cdpSetFileInput: vi.fn(),
}))

vi.mock('../browser/browser-cdp-network', () => ({
  enableNetworkCapture: vi.fn(async () => {}),
  readNetwork: vi.fn(() => [{ url: 'https://x.com/api' }]),
  waitForRequest: vi.fn(async () => ({ url: 'https://x.com/api', status: 200 })),
  getResponseBody: vi.fn(async () => null),
  addMockRule: vi.fn(async () => {}),
  clearMockRules: vi.fn(async () => {}),
}))

vi.mock('../agent/browser-screenshot-store', () => ({
  persistScreenshot: vi.fn(() => '/tmp/shot.png'),
}))

import { registerBrowserTools, BROWSER_TOOL_NAMES } from './browser-mcp-tools'
import { getResponseBody, waitForRequest } from './../browser/browser-cdp-network'

type Handler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text?: string }>; isError?: boolean }>

function buildTools(): Map<string, Handler> {
  const tools = new Map<string, Handler>()
  const server = {
    registerTool: (name: string, _cfg: unknown, handler: Handler) => {
      tools.set(name, handler)
      return {}
    },
  }
  registerBrowserTools(server as never, 'sess-1')
  return tools
}

function resultText(reply: { content: Array<{ type: string; text?: string }> }): string {
  return reply.content.map((c) => c.text ?? '').join('')
}

describe('browser tool registration under experimental gates', () => {
  beforeEach(() => {
    gates.cdp = false
    gates.network = false
    gates.cookies = false
    gates.mock = false
    gates.emulate = false
    vi.clearAllMocks()
  })

  it('registers every browser tool even when all CDP settings are off', () => {
    const tools = buildTools()
    for (const name of BROWSER_TOOL_NAMES) {
      expect(tools.has(name), name).toBe(true)
    }
  })

  it('rejects network tools with the CDP-required message when the master setting is off', async () => {
    const tools = buildTools()
    const reply = await tools.get('browser_network')!({})
    expect(reply.isError).toBe(true)
    expect(resultText(reply)).toContain('browser CDP setting')
  })

  it('rejects each experimental tool with a message naming its sub-setting when only CDP is on', async () => {
    gates.cdp = true
    const tools = buildTools()
    const cases: Array<[string, Record<string, unknown>, string]> = [
      ['browser_network', {}, 'network inspection'],
      ['browser_network_wait', { url: '/api', timeoutMs: 1000 }, 'network inspection'],
      ['browser_network_body', { url: '/api' }, 'network inspection'],
      ['browser_cookies', {}, 'cookie access'],
      ['browser_emulate', { reset: true }, 'device emulation'],
      ['browser_mock', { clear: true }, 'network mocking'],
    ]
    for (const [name, args, setting] of cases) {
      const reply = await tools.get(name)!(args)
      expect(reply.isError, name).toBe(true)
      expect(resultText(reply), name).toContain(setting)
    }
  })

  it('serves network list, wait, and body once the sub-setting is enabled mid-session', async () => {
    gates.cdp = true
    const tools = buildTools()
    gates.network = true

    const list = await tools.get('browser_network')!({})
    expect(list.isError).toBeUndefined()
    expect(resultText(list)).toContain('/api')

    const wait = await tools.get('browser_network_wait')!({ url: '/api', timeoutMs: 1000 })
    expect(wait.isError).toBeUndefined()
    expect(vi.mocked(waitForRequest)).toHaveBeenCalledWith(7, '/api', 1000)

    const body = await tools.get('browser_network_body')!({ url: '/missing' })
    expect(body.isError).toBe(true)
    expect(resultText(body)).toContain('/missing')
    expect(vi.mocked(getResponseBody)).toHaveBeenCalledWith(7, '/missing')
  })
})
