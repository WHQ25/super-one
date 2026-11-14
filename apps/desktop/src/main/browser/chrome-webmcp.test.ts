import { afterEach, describe, expect, it } from 'vitest'
import { ChromeBridgeHub } from './chrome-bridge-hub'
import { bindChromeBridge, resetChromeBrowserForTests } from './chrome-browser'
import { chromeTargetId } from './cdp-transport'
import { callChromeWebMcpTool, readChromeWebMcp, resetChromeWebMcpForTests } from './chrome-webmcp'

const TAB = 4
const TARGET = chromeTargetId(TAB)

type Emit = (event: string, params: unknown) => void
type Outcome = { result?: unknown; error?: string }
type Handler = (method: string, params: unknown, emit: Emit) => Outcome

function scriptedHub(handle: Handler): ChromeBridgeHub {
  const hub = new ChromeBridgeHub()
  hub.attach((json) => {
    const request = JSON.parse(json) as { id: number; method: string; params: unknown }
    const emit: Emit = (event, params) => {
      hub.receive(JSON.stringify({ event, params }))
    }
    const outcome = handle(request.method, request.params, emit)
    if (outcome.error) hub.receive(JSON.stringify({ id: request.id, error: outcome.error }))
    else hub.receive(JSON.stringify({ id: request.id, result: outcome.result ?? {} }))
  })
  return hub
}

function bind(handle: Handler): void {
  bindChromeBridge(scriptedHub(handle))
}

function cdp(params: unknown): { method: string; params: Record<string, unknown> } {
  const body = params as { method?: string; params?: Record<string, unknown> }
  return { method: body.method ?? '', params: body.params ?? {} }
}

function frameTree(url: string): unknown {
  return {
    frameTree: {
      frame: { id: 'root', url },
      childFrames: [{ frame: { id: 'child', url: 'https://other.example/widget' } }],
    },
  }
}

function pageValue(value: unknown): unknown {
  return { result: { value } }
}

const searchTool = { name: 'search', description: 'Search', inputSchema: { type: 'object' }, frameId: 'root' }
const foreignTool = { name: 'foreign', description: 'Hidden', inputSchema: { type: 'object' }, frameId: 'child' }
const exposedTool = { name: 'exposed', description: 'From the page', inputSchema: { type: 'object' } }

function securePage(method: string, params: unknown, emit: Emit): Outcome {
  if (method !== 'cdp.send') return {}
  const body = cdp(params)
  if (body.method === 'WebMCP.enable') {
    emit('cdp.event', {
      tabId: TAB,
      method: 'WebMCP.toolsAdded',
      params: { tools: [searchTool, foreignTool] },
    })
    return {}
  }
  if (body.method === 'Page.getFrameTree') return { result: frameTree('https://example.com/path') }
  if (body.method === 'Runtime.evaluate') {
    return { result: pageValue({ available: true, href: 'https://example.com/path', tools: [exposedTool] }) }
  }
  return {}
}

describe('chrome WebMCP', () => {
  afterEach(() => {
    resetChromeWebMcpForTests()
    resetChromeBrowserForTests()
  })

  it('lists same-origin debugger tools and tools the top document may see', async () => {
    bind(securePage)
    const snap = await readChromeWebMcp(TARGET, { settleMs: 0 })
    expect(snap).toEqual({
      available: true,
      origin: 'https://example.com',
      tools: [
        { name: 'search', description: 'Search', inputSchema: '{"type":"object"}' },
        { name: 'exposed', description: 'From the page', inputSchema: '{"type":"object"}' },
      ],
    })
  })

  it('reports that WebMCP is unavailable when the debugger domain is missing', async () => {
    bind((method, params) => {
      if (method !== 'cdp.send') return {}
      const body = cdp(params)
      if (body.method === 'WebMCP.enable') return { error: "'WebMCP.enable' wasn't found" }
      if (body.method === 'Runtime.evaluate') {
        return { result: pageValue({ available: false, href: 'https://example.com/' }) }
      }
      return {}
    })
    await expect(readChromeWebMcp(TARGET, { settleMs: 0 })).resolves.toEqual({
      available: false,
      reason: 'unsupported',
      origin: 'https://example.com',
    })
  })

  it('rethrows a debugger failure that is not a missing WebMCP domain', async () => {
    bind((method, params) => {
      if (method !== 'cdp.send') return {}
      const body = cdp(params)
      if (body.method === 'WebMCP.enable') return { error: 'debugger detached' }
      return {}
    })
    await expect(readChromeWebMcp(TARGET, { settleMs: 0 })).rejects.toThrow(/debugger detached/)
  })

  it('drops tools on an http page and reports an insecure context', async () => {
    bind((method, params, emit) => {
      if (method !== 'cdp.send') return {}
      const body = cdp(params)
      if (body.method === 'WebMCP.enable') {
        emit('cdp.event', { tabId: TAB, method: 'WebMCP.toolsAdded', params: { tools: [searchTool] } })
        return {}
      }
      if (body.method === 'Page.getFrameTree') return { result: frameTree('http://example.com/') }
      if (body.method === 'Runtime.evaluate') {
        return { result: pageValue({ available: true, href: 'http://example.com/', tools: [exposedTool] }) }
      }
      return {}
    })
    await expect(readChromeWebMcp(TARGET, { settleMs: 0 })).resolves.toEqual({
      available: false,
      reason: 'insecure',
      origin: 'http://example.com',
    })
  })

  it('reports an insecure context when the page API is missing on http', async () => {
    bind((method, params) => {
      if (method !== 'cdp.send') return {}
      const body = cdp(params)
      if (body.method === 'WebMCP.enable') return { error: "'WebMCP.enable' wasn't found" }
      if (body.method === 'Runtime.evaluate') {
        return { result: pageValue({ available: false, href: 'http://example.com/' }) }
      }
      return {}
    })
    await expect(readChromeWebMcp(TARGET, { settleMs: 0 })).resolves.toEqual({
      available: false,
      reason: 'insecure',
      origin: 'http://example.com',
    })
  })

  it('invokes a same-origin tool and returns the completed output', async () => {
    let invoked: Record<string, unknown> | null = null
    bind((method, params, emit) => {
      if (method !== 'cdp.send') return {}
      const body = cdp(params)
      if (body.method === 'WebMCP.invokeTool') {
        invoked = body.params
        emit('cdp.event', {
          tabId: TAB,
          method: 'WebMCP.toolResponded',
          params: { invocationId: 'inv-1', status: 'Completed', output: '{"hits":1}' },
        })
        return { result: { invocationId: 'inv-1' } }
      }
      return securePage(method, params, emit)
    })
    await readChromeWebMcp(TARGET, { settleMs: 0 })
    await expect(callChromeWebMcpTool(TARGET, 'search', { q: 'a' }, { timeoutMs: 500 })).resolves.toEqual({
      outputJson: '{"hits":1}',
    })
    expect(invoked).toMatchObject({ frameId: 'root', toolName: 'search', input: { q: 'a' } })
  })

  it('does not invoke a cross-origin tool the list omitted', async () => {
    let invoked = false
    bind((method, params, emit) => {
      if (method !== 'cdp.send') return {}
      const body = cdp(params)
      if (body.method === 'WebMCP.invokeTool') {
        invoked = true
        return { result: { invocationId: 'inv-2' } }
      }
      return securePage(method, params, emit)
    })
    await readChromeWebMcp(TARGET, { settleMs: 0 })
    await expect(callChromeWebMcpTool(TARGET, 'foreign', {}, { timeoutMs: 500 })).rejects.toThrow(/does not register/)
    expect(invoked).toBe(false)
  })

  it('executes a page-mode tool through document.modelContext', async () => {
    let expression = ''
    bind((method, params) => {
      if (method !== 'cdp.send') return {}
      const body = cdp(params)
      if (body.method === 'WebMCP.enable') return { error: "'WebMCP.enable' wasn't found" }
      if (body.method === 'Runtime.evaluate') {
        expression = String(body.params.expression ?? '')
        if (expression.includes('executeTool')) {
          return { result: pageValue({ ok: true, output: 'done' }) }
        }
        return {
          result: pageValue({
            available: true,
            href: 'https://localhost:3000/',
            tools: [{ name: 'lookup', description: 'Look', inputSchema: { type: 'object' } }],
          }),
        }
      }
      return {}
    })
    await expect(readChromeWebMcp(TARGET, { settleMs: 0 })).resolves.toEqual({
      available: true,
      origin: 'https://localhost:3000',
      tools: [{ name: 'lookup', description: 'Look', inputSchema: '{"type":"object"}' }],
    })
    await expect(callChromeWebMcpTool(TARGET, 'lookup', { id: 1 }, { timeoutMs: 500 })).resolves.toEqual({
      outputJson: 'done',
    })
    expect(expression).toContain('executeTool')
    expect(expression).toContain('lookup')
  })
})
