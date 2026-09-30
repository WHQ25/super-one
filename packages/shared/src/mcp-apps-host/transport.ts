import { PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { assertMcpAppSize, McpAppsError } from '../mcp-apps'
import type { McpAppDocument } from './document'

/** One transport per document. Native navigation guards must call close before a new document executes. */
export function createMcpAppTransport(
  target: Window,
  origin: string,
  owner: Window = window,
  document?: McpAppDocument,
): Transport {
  let closed = false
  let started = false
  let unsubscribe: (() => void) | undefined
  const generation = document?.generation
  // The SDK sends to "*". Pin outgoing messages to the registered scheme origin.
  // Opaque mobile srcdoc origins can only use "*"; their window+generation is the boundary.
  const sender = { postMessage: (message: unknown) => target.postMessage(message, origin === 'null' ? '*' : origin) } as Window
  const base = new PostMessageTransport(sender, target)
  const filter = (event: MessageEvent): void => {
    if (event.source !== target) return
    try {
      if (closed || (document && !document.accepts(generation!)) || event.origin !== origin) throw new McpAppsError('denied', 'MCP App document changed')
      assertMcpAppSize(event.data)
    } catch {
      // Run in capture phase, before PostMessageTransport's global listener.
      event.stopImmediatePropagation()
    }
  }
  const transport: Transport = {
    async start() {
      if (closed || started || (document && !document.active)) throw new McpAppsError('cancelled', 'MCP App transport is closed or already started')
      started = true
      owner.addEventListener('message', filter, true)
      base.onmessage = (message, extra) => { if (!closed) transport.onmessage?.(message, extra) }
      base.onerror = error => transport.onerror?.(error)
      base.onclose = () => transport.onclose?.()
      await base.start()
    },
    async send(message, options) {
      if (closed || (document && !document.active)) throw new McpAppsError('cancelled', 'MCP App transport is closed')
      assertMcpAppSize(message)
      await base.send(message, options)
    },
    async close() {
      if (closed) return
      closed = true
      unsubscribe?.()
      owner.removeEventListener('message', filter, true)
      await base.close()
    },
  }
  unsubscribe = document?.onRevoke(() => { void transport.close() })
  return transport
}
