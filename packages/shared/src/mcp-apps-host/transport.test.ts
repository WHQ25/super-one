// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { createMcpAppTransport } from './transport'
import { MCP_APP_DATA_MAX_BYTES } from '../mcp-apps'
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
