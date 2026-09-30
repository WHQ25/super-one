import { createMcpAppHost, createMcpAppHostSlot } from '@superone/shared/mcp-apps-host/host'
import { createMcpAppTransport } from '@superone/shared/mcp-apps-host/transport'
import { createMcpAppDocument, mcpAppAllowAttribute } from '@superone/shared/mcp-apps-host'
import type { McpAppHostExecutor, McpAppHost } from '@superone/shared/mcp-apps-host/host'
import type { ToolAppAttachment } from '@superone/shared/mcp-apps'
import { createElement, StrictMode, useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'

declare global {
  interface Window {
    securityNative: { onRevoke(fn: (url: string) => void): void; canExecute(url: string): boolean }
    securityHarness: { mount(app: ToolAppAttachment, url: string, origin: string, overgrantProbe?: boolean, strict?: boolean): Promise<void>; state: { loads: number; calls: number; errors: string[]; revoked: boolean; setups: number; cleanups: number }; sameWindow(): boolean }
  }
}
const slot = createMcpAppHostSlot()
let current: { host: McpAppHost; url: string; frame: HTMLIFrameElement; target: Window } | undefined
let reactRoot: Root | undefined
let reactContainer: HTMLDivElement | undefined
const state = { loads: 0, calls: 0, errors: [] as string[], revoked: false, setups: 0, cleanups: 0 }
window.securityNative.onRevoke(url => { if (current?.url === url) { current.host.revoke(); state.revoked = true } })
window.securityHarness = {
  state,
  sameWindow: () => current?.target === current?.frame.contentWindow,
  async mount(app, url, origin, overgrantProbe = false, strict = false) {
    current?.host.revoke()
    reactRoot?.unmount()
    reactRoot = undefined
    reactContainer?.remove()
    current?.frame.remove()
    state.loads = 0; state.calls = 0; state.errors = []; state.revoked = false; state.setups = 0; state.cleanups = 0
    if (strict) {
      reactContainer = document.createElement('div')
      document.body.appendChild(reactContainer)
      reactRoot = createRoot(reactContainer)
      reactRoot.render(createElement(StrictMode, {}, createElement(StrictFrame, { app, url, origin })))
      return
    }
    const documentGeneration = createMcpAppDocument()
    const frame = document.createElement('iframe')
    frame.id = 'mcp-view'
    frame.sandbox.value = 'allow-scripts allow-same-origin allow-forms'
    frame.allow = mcpAppAllowAttribute(overgrantProbe ? { camera: {} } : {}) // Default: never resource-declared permissions. Probe overgrants to prove native denial.
    frame.src = url // Set before insertion: no initial about:blank load.
    frame.addEventListener('load', () => { state.loads++; if (!documentGeneration.loaded()) state.revoked = true })
    document.body.appendChild(frame)
    const target = frame.contentWindow!
    const executor: McpAppHostExecutor = {
      async callTool() {
        if (!window.securityNative.canExecute(url)) throw new Error('Native document lease revoked')
        state.calls++
        return { result: { content: [{ type: 'text', text: 'called' }] }, outcome: 'completed' }
      },
      async readResource() { return { contents: [] } }, async sendMessage() { return {} },
      async updateModelContext() {}, async openLink() { return {} }, async requestDisplayMode(mode) { return mode },
    }
    const host = createMcpAppHost({ app, document: documentGeneration, transport: createMcpAppTransport(target, origin, window, documentGeneration), executor,
      context: { theme: 'light', platform: 'desktop' }, capabilities: { serverTools: {}, sandbox: { permissions: {} } },
      onError: error => state.errors.push(String(error)),
    })
    current = { host, url, frame, target }
    slot.replace(host)
    await host.connect()
  },
}

/** Exercise the production core under actual React effect replay in Chromium. */
function StrictFrame({ app, url, origin }: { app: ToolAppAttachment; url: string; origin: string }) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const slotRef = useRef(createMcpAppHostSlot())
  useEffect(() => {
    state.setups++
    const frame = frameRef.current!
    const target = frame.contentWindow!
    const documentGeneration = createMcpAppDocument()
    const onLoad = () => { state.loads++; if (!documentGeneration.loaded()) state.revoked = true }
    frame.addEventListener('load', onLoad)
    const host = createMcpAppHost({ app, document: documentGeneration, transport: createMcpAppTransport(target, origin, window, documentGeneration),
      context: { theme: 'light' }, capabilities: { serverTools: {}, sandbox: { permissions: {} } },
      executor: {
        async callTool() { if (!window.securityNative.canExecute(url)) throw new Error('Native document lease revoked'); state.calls++; return { result: { content: [{ type: 'text', text: 'called' }] }, outcome: 'completed' } },
        async readResource() { return { contents: [] } }, async sendMessage() { return {} }, async updateModelContext() {}, async openLink() { return {} }, async requestDisplayMode(mode) { return mode },
      },
      onError: error => state.errors.push(String(error)),
    })
    slotRef.current.replace(host)
    current = { host, url, frame, target }
    void host.connect()
    return () => { state.cleanups++; frame.removeEventListener('load', onLoad); void slotRef.current.release(host) }
  }, [app, url, origin])
  return createElement('iframe', { id: 'mcp-view', ref: frameRef, src: url, sandbox: 'allow-scripts allow-same-origin allow-forms', allow: mcpAppAllowAttribute({}) })
}
