import { createMcpAppHost, createMcpAppHostSlot } from '@superone/shared/mcp-apps-host/host'
import { createMcpAppTransport } from '@superone/shared/mcp-apps-host/transport'
import { createMcpAppDocument, mcpAppAllowAttribute } from '@superone/shared/mcp-apps-host'
import type { McpAppHostExecutor, McpAppHost } from '@superone/shared/mcp-apps-host/host'
import type { ToolAppAttachment } from '@superone/shared/mcp-apps'
import McpAppFrame from '../../src/renderer/src/components/mcp-apps/McpAppFrame'
import { useMcpAppLayout } from '../../src/renderer/src/components/mcp-apps/layout-store'
import type { McpAppDesktopApi } from '../../src/renderer/src/components/mcp-apps/desktop-executor'
import { createElement, StrictMode, useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { DockviewReact } from 'dockview-react'
import type { DockviewApi, IDockviewPanelHeaderProps } from 'dockview-core'
import { McpAppPanel } from '../../src/renderer/src/components/mcp-apps/McpAppPanel'
import { connectMcpAppTabs } from '../../src/renderer/src/components/activity/mcp-app-tabs'
import { useActivityPanelStore } from '../../src/renderer/src/stores/activity-panel'

declare global {
  interface Window {
    securityNative: { onRevoke(fn: (url: string) => void): void; onEscape(fn: (url: string) => void): void; canExecute(url: string): boolean }
    securityHarness: { mount(app: ToolAppAttachment, url: string, origin: string, overgrantProbe?: boolean, strict?: boolean, production?: boolean): Promise<void>; move(mode: 'inline' | 'fullscreen' | 'pip'): void; removeSurfaceFirst(): void; activity(): { showPanel: boolean; maximized: boolean; panels: string[] }; baseline(): void; state: { loads: number; calls: number; errors: string[]; revoked: boolean; setups: number; cleanups: number }; sameWindow(): boolean }
  }
}
const slot = createMcpAppHostSlot()
let current: { host: McpAppHost; url: string; frame: HTMLIFrameElement; target: Window } | undefined
let reactRoot: Root | undefined
let reactContainer: HTMLDivElement | undefined
let dockRoot: Root | undefined
let dockContainer: HTMLDivElement | undefined
let dockApi: DockviewApi | undefined
const state = { loads: 0, calls: 0, errors: [] as string[], revoked: false, setups: 0, cleanups: 0 }
window.securityNative.onRevoke(url => { if (current?.url === url) { current.host.revoke(); state.revoked = true } })
window.securityNative.onEscape(url => { if (current?.url === url) useMcpAppLayout.getState().setMode('security', 'inline') })
window.securityHarness = {
  state,
  activity() { const s = useActivityPanelStore.getState(); return { showPanel: s.showPanel, maximized: s.maximized, panels: dockApi?.panels.map(panel => panel.id) ?? [] } },
  baseline() {
    const panel = dockApi!.addPanel({ id: 'baseline', component: 'baseline' })
    useActivityPanelStore.getState().setShowPanel(true); panel.api.maximize()
    useActivityPanelStore.getState().setMaximizedGroup(panel.group.id)
  },
  sameWindow: () => current?.target === current?.frame.contentWindow,
  move(mode) { useMcpAppLayout.getState().setMode('security', mode) },
  removeSurfaceFirst() {
    document.querySelector('[data-mcp-app-fullscreen]')!.parentElement!.remove()
    useMcpAppLayout.getState().surface('security', 'fullscreen', null)
  },
  async mount(app, url, origin, overgrantProbe = false, strict = false, production = false) {
    connectMcpAppTabs(null)
    current?.host.revoke()
    reactRoot?.unmount()
    reactRoot = undefined
    dockRoot?.unmount(); dockRoot = undefined; dockContainer?.remove()
    reactContainer?.remove()
    current?.frame.remove()
    document.querySelectorAll('[data-production-mode], #production-transcript').forEach(element => element.remove())
    useMcpAppLayout.getState().clear()
    state.loads = 0; state.calls = 0; state.errors = []; state.revoked = false; state.setups = 0; state.cleanups = 0
    if (production) {
      useActivityPanelStore.setState({ showPanel: false, maximized: false, maximizedGroupId: null })
      const transcript = document.createElement('div'); transcript.id = 'production-transcript'
      transcript.style.cssText = 'height:300px;width:600px;overflow:auto'
      transcript.innerHTML = '<div style="height:100px"></div><div data-production-mode="inline" style="height:200px;width:100%"></div><div style="height:1200px"></div>'
      document.body.appendChild(transcript)
      const row = transcript.querySelector<HTMLElement>('[data-production-mode=inline]')!
      const nativeListeners = new Set<(event: { url: string }) => void>()
      const api = { onMcpAppDocumentRevoked: (callback: (event: { url: string }) => void) => { nativeListeners.add(callback); return () => nativeListeners.delete(callback) }, mcpAppRelease: async () => {} } as McpAppDesktopApi
      window.securityNative.onRevoke(url => nativeListeners.forEach(callback => callback({ url })))
      useMcpAppLayout.getState().claim({ app, route: { projectPath: '/security', sessionId: app.binding.session }, api, row })
      useMcpAppLayout.getState().surface(app.appInstanceId, 'inline', row)
      for (const mode of ['pip'] as const) {
        const element = document.createElement('div'); element.dataset.productionMode = mode
        element.style.cssText = 'width:600px;height:300px'; document.body.appendChild(element)
        useMcpAppLayout.getState().surface(app.appInstanceId, mode, element)
      }
      dockContainer = document.createElement('div'); dockContainer.style.cssText = 'width:700px;height:400px'; document.body.appendChild(dockContainer)
      dockRoot = createRoot(dockContainer)
      await new Promise<void>(resolve => dockRoot!.render(createElement(DockviewReact, {
        components: { 'mcp-app': McpAppPanel, baseline: () => createElement('div', {}, 'Existing activity') }, tabComponents: { 'mcp-app-tab': NativeTab },
        onReady({ api }: { api: DockviewApi }) { dockApi = api; connectMcpAppTabs(api); resolve() },
      })))
      reactContainer = document.createElement('div'); document.body.appendChild(reactContainer)
      reactRoot = createRoot(reactContainer)
      reactRoot.render(createElement(McpAppFrame, {
        app, meta: {}, registration: { id: 'native', url, origin, appInstanceId: app.appInstanceId }, api,
        executor: { async callTool() { state.calls++; return { result: { content: [] }, outcome: 'completed' } }, async readResource() { return { contents: [] } }, async sendMessage() { return {} }, async updateModelContext() {}, async openLink() { return {} }, async requestDisplayMode(mode) { useMcpAppLayout.getState().setMode(app.appInstanceId, mode); return mode } },
        context: { theme: 'light', platform: 'desktop', availableDisplayModes: ['inline', 'fullscreen', 'pip'] }, active: true,
        onHost(host) {
          if (!host) return
          const frame = document.querySelector<HTMLIFrameElement>('[data-mcp-app-frame]')!
          current = { host, frame, target: frame.contentWindow!, url }
          frame.id = 'mcp-view'; frame.addEventListener('load', () => state.loads++)
        },
        onInitialized() {}, onHeight() {}, onUnknown() {}, onRevoked() { state.revoked = true }, onError(error) { state.errors.push(String(error)) },
      }))
      return
    }
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

/** Native tests drive the same Dockview operations as the standard ActivityTab. */
function NativeTab({ api }: IDockviewPanelHeaderProps) {
  return createElement('div', {}, api.title,
    createElement('button', { onClick: () => api.close() }, 'Close'),
    createElement('button', { onClick: () => api.exitMaximized() }, 'Shrink'))
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
