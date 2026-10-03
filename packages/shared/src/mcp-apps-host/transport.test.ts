// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { createMcpAppTransport } from './transport'
import { MCP_APP_DATA_MAX_BYTES, MCP_APP_OUTPUT_MAX_BYTES, MCP_APP_RESULT_MAX_BYTES } from '../mcp-apps'
import { createMcpAppDocument } from './document'

let transport: Transport | undefined
afterEach(async () => { await transport?.close(); transport = undefined })

describe('MCP App postMessage transport', () => {
  it('checks source, origin and size before the SDK receives a message', async () => {
    const target = { postMessage: vi.fn() } as unknown as Window
    const origin = 'superone-mcp-app://stable'
    transport = createMcpAppTransport(target, origin)
    const received = vi.fn()
    transport.onmessage = received
    await transport.start()
    const notify = (source: Window, eventOrigin: string, params: unknown = {}) => window.dispatchEvent(new MessageEvent('message', {
      source, origin: eventOrigin, data: { jsonrpc: '2.0', method: 'ui/notifications/initialized', params },
    }))
    notify(window, origin)
    notify(target, 'https://attacker.test')
    notify(target, origin, { payload: 'a'.repeat(MCP_APP_DATA_MAX_BYTES) })
    expect(received).not.toHaveBeenCalled()
    notify(target, origin)
    expect(received).toHaveBeenCalledTimes(1)
    await transport.close()
    notify(target, origin)
    expect(received).toHaveBeenCalledTimes(1)
  })

  it('allows the transient output cap only for View request replies and the initial tool result', async () => {
    const target = { postMessage: vi.fn() } as unknown as Window
    transport = createMcpAppTransport(target, 'null')
    await transport.start()
    const request = (id: number, method: string) => window.dispatchEvent(new MessageEvent('message', { source: target, origin: 'null', data: { jsonrpc: '2.0', id, method, params: {} } }))
    const result = { content: [{ type: 'text' as const, text: 'a'.repeat(MCP_APP_OUTPUT_MAX_BYTES - 100) }] }
    for (const [id, method] of [[1, 'tools/call'], [2, 'resources/read']] as const) {
      request(id, method)
      await expect(transport.send({ jsonrpc: '2.0', id, result })).resolves.toBeUndefined()
    }
    request(3, 'tools/call')
    await expect(transport.send({ jsonrpc: '2.0', id: 3, result: { content: [{ type: 'text', text: 'a'.repeat(MCP_APP_OUTPUT_MAX_BYTES) }] } })).rejects.toThrow('size limit')
    await expect(transport.send({ jsonrpc: '2.0', id: 4, result })).rejects.toThrow('size limit')
    await expect(transport.send({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { content: [{ type: 'text', text: 'a'.repeat(MCP_APP_RESULT_MAX_BYTES - 100) }] } })).resolves.toBeUndefined()
    await expect(transport.send({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { content: [{ type: 'text', text: 'a'.repeat(MCP_APP_RESULT_MAX_BYTES + 1024) }] } })).rejects.toThrow('size limit')
    await expect(transport.send({ jsonrpc: '2.0', method: 'ui/notifications/tool-input', params: { arguments: { x: 'a'.repeat(MCP_APP_DATA_MAX_BYTES) } } })).rejects.toThrow('size limit')
  })

  it('pins outgoing messages and rejects sending after document revocation', async () => {
    const postMessage = vi.fn()
    transport = createMcpAppTransport({ postMessage } as unknown as Window, 'superone-mcp-app://stable')
    await transport.start()
    await transport.send({ jsonrpc: '2.0', method: 'ping' })
    expect(postMessage).toHaveBeenCalledWith({ jsonrpc: '2.0', method: 'ping' }, 'superone-mcp-app://stable')
    await transport.close()
    await expect(transport.send({ jsonrpc: '2.0', method: 'ping' })).rejects.toThrow('closed')
    expect(postMessage).toHaveBeenCalledTimes(1)
  })

  it('supports the opaque mobile origin with the exact child window as the boundary', async () => {
    const postMessage = vi.fn()
    const target = { postMessage } as unknown as Window
    transport = createMcpAppTransport(target, 'null')
    const received = vi.fn()
    transport.onmessage = received
    await transport.start()
    window.dispatchEvent(new MessageEvent('message', { source: target, origin: 'null', data: { jsonrpc: '2.0', method: 'ping', id: 1 } }))
    expect(received).toHaveBeenCalledTimes(1)
    await transport.send({ jsonrpc: '2.0', id: 1, result: {} })
    expect(postMessage).toHaveBeenCalledWith({ jsonrpc: '2.0', id: 1, result: {} }, '*')
  })

  it('revokes after a second load even when the WindowProxy and origin are unchanged', async () => {
    const document = createMcpAppDocument()
    const target = { postMessage: vi.fn() } as unknown as Window
    transport = createMcpAppTransport(target, 'null', window, document)
    const received = vi.fn()
    transport.onmessage = received
    await transport.start()
    const message = () => window.dispatchEvent(new MessageEvent('message', { source: target, origin: 'null', data: { jsonrpc: '2.0', method: 'ping', id: 1 } }))
    expect(document.loaded()).toBe(true)
    message()
    expect(received).toHaveBeenCalledTimes(1)
    expect(document.loaded()).toBe(false)
    message()
    expect(received).toHaveBeenCalledTimes(1)
    expect(document.accepts(document.generation)).toBe(false)
    await expect(transport.send({ jsonrpc: '2.0', method: 'ping' })).rejects.toThrow('closed')
    expect(createMcpAppDocument().generation).not.toBe(document.generation)
  })
})
