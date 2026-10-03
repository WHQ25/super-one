import { mcpAppCspDomains } from '@superone/shared/mcp-apps-host/csp'
import { MCP_APP_OPEN_FILES_EXTENSION, mcpAppFileCapabilities, mcpAppMessageCapabilities } from '@superone/shared/mcp-apps-host/capabilities'
import { useLayoutEffect, useRef } from 'react'
import type { McpUiHostContext } from '@modelcontextprotocol/ext-apps/app-bridge'
import type { ToolAppAttachment, McpUiResourceMeta } from '@superone/shared/mcp-apps'
import type { McpAppDocumentRegistration } from '@superone/shared/mcp-apps-desktop'
import { createMcpAppHost, createMcpAppHostSlot, type McpAppHost, type McpAppHostExecutor } from '@superone/shared/mcp-apps-host/host'
import { createMcpAppDocument } from '@superone/shared/mcp-apps-host/document'
import { createMcpAppTransport } from '@superone/shared/mcp-apps-host/transport'
import type { McpAppDesktopApi } from './desktop-executor'
import { useMcpAppLayout } from './layout-store'

export interface McpAppFrameProps {
  app: ToolAppAttachment; meta: McpUiResourceMeta; registration: McpAppDocumentRegistration; api: McpAppDesktopApi
  executor: McpAppHostExecutor; context: McpUiHostContext; active: boolean
  onHost(host: McpAppHost | null): void; onInitialized(modes: Array<'inline' | 'fullscreen' | 'pip'>): void
  onError(error: unknown): void; onUnknown(): void; onRevoked(): void; onHeight(height: number): void
}

/** Desktop shows files only from its own machine, so remote sessions do not offer `openai/files`. */
function mcpAppDesktopCapabilities(app: ToolAppAttachment) {
  const base = app.file ? mcpAppFileCapabilities : mcpAppMessageCapabilities
  return app.binding.node === 'local' ? { ...base, experimental: { ...base.experimental, ...MCP_APP_OPEN_FILES_EXTENSION } } : base
}

/** Store-owned imperative iframe: React never removes it while changing surfaces. */
export default function McpAppFrame(props: McpAppFrameProps) {
  const hostRef = useRef<McpAppHost | null>(null)
  const slot = useRef<ReturnType<typeof createMcpAppHostSlot> | null>(null)
  const latest = useRef(props); latest.current = props
  useLayoutEffect(() => {
    const element = window.document.createElement('iframe')
    element.title = `${props.app.binding.server} MCP App`
    element.dataset.mcpAppFrame = props.app.appInstanceId
    element.sandbox.value = 'allow-scripts allow-same-origin allow-forms'
    element.allow = ''; element.referrerPolicy = 'no-referrer'
    element.className = 'block h-full w-full border-0'
    const releaseFrame = useMcpAppLayout.getState().frame(props.app.appInstanceId, element, () => {
      hostRef.current?.revoke(); latest.current.onRevoked()
      void props.api.mcpAppRelease(props.registration.id).catch(() => {})
    })
    const document = createMcpAppDocument()
    const host = createMcpAppHost({ app: latest.current.app, resourceMeta: props.meta, executor: latest.current.executor,
      transport: createMcpAppTransport(element.contentWindow!, props.registration.origin, window, document), document,
      restored: !latest.current.active, context: latest.current.context,
      // Permissions are deliberately ungranted, even if the resource requests them.
      capabilities: { ...mcpAppDesktopCapabilities(props.app), serverTools: {}, serverResources: {}, openLinks: {}, logging: {}, sandbox: { permissions: {}, csp: mcpAppCspDomains(props.meta.csp) } },
      onInitialized: () => latest.current.onInitialized(host.appCapabilities()?.availableDisplayModes ?? ['inline']),
      onError: error => latest.current.onError(error), onUnknownOutcome: () => latest.current.onUnknown(),
      onSizeChanged: size => { if (size.height) latest.current.onHeight(size.height) },
    })
    slot.current ??= createMcpAppHostSlot()
    slot.current.replace(host); hostRef.current = host; latest.current.onHost(host)
    const unsubscribeRevoked = props.api.onMcpAppDocumentRevoked(event => {
      if (event.url !== props.registration.url) return
      host.revoke(); latest.current.onRevoked()
    })
    const unsubscribeUpdates = props.app.file ? props.api.onMcpAppResourceUpdated?.(event => {
      if (event.appInstanceId === props.app.appInstanceId) host.resourceUpdated(event.uri)
    }) : undefined
    const unsubscribe = () => { unsubscribeRevoked(); unsubscribeUpdates?.() }
    const load = () => {
      try { if (element.contentWindow?.location.href === 'about:blank') return } catch { /* Isolated document. */ }
      if (!document.loaded()) { host.revoke(); latest.current.onRevoked() }
    }
    element.addEventListener('load', load)
    void host.connect().then(() => { if (document.active) element.src = props.registration.url }).catch(error => latest.current.onError(error))
    return () => {
      unsubscribe(); element.removeEventListener('load', load)
      host.revoke(); void slot.current!.release(host)
      hostRef.current = null; latest.current.onHost(null)
      releaseFrame()
    }
  }, [props.registration.id, props.api])
  useLayoutEffect(() => { if (props.active) hostRef.current?.activate() }, [props.active])
  useLayoutEffect(() => { void hostRef.current?.update(props.app).catch(props.onError) }, [props.app, props.onError])
  useLayoutEffect(() => { hostRef.current?.updateContext(props.context) }, [props.context])
  return null
}
