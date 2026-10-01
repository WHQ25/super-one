import { useLayoutEffect, useRef } from 'react'
import type { McpUiHostContext } from '@modelcontextprotocol/ext-apps/app-bridge'
import type { ToolAppAttachment } from '@superone/shared/mcp-apps'
import type { McpAppDocumentRegistration } from '@superone/shared/mcp-apps-desktop'
import { createMcpAppHost, createMcpAppHostSlot, type McpAppHost, type McpAppHostExecutor } from '@superone/shared/mcp-apps-host/host'
import { createMcpAppDocument } from '@superone/shared/mcp-apps-host/document'
import { createMcpAppTransport } from '@superone/shared/mcp-apps-host/transport'
import type { McpAppDesktopApi } from './desktop-executor'

export interface McpAppFrameProps {
  app: ToolAppAttachment; registration: McpAppDocumentRegistration; api: McpAppDesktopApi
  executor: McpAppHostExecutor; context: McpUiHostContext; active: boolean
  onHost(host: McpAppHost | null): void; onInitialized(modes: Array<'inline' | 'fullscreen' | 'pip'>): void
  onError(error: unknown): void; onUnknown(): void; onRevoked(): void; onHeight(height: number): void
}

/** This component and its iframe stay mounted when the display mode changes. */
export default function McpAppFrame(props: McpAppFrameProps) {
  const iframe = useRef<HTMLIFrameElement>(null)
  const hostRef = useRef<McpAppHost | null>(null)
  const slot = useRef<ReturnType<typeof createMcpAppHostSlot> | null>(null)
  const latest = useRef(props); latest.current = props
  useLayoutEffect(() => {
    const element = iframe.current!
    const document = createMcpAppDocument()
    const host = createMcpAppHost({ app: latest.current.app, executor: latest.current.executor,
      transport: createMcpAppTransport(element.contentWindow!, props.registration.origin, window, document), document,
      restored: !latest.current.active, context: latest.current.context,
      // Permissions are deliberately ungranted, even if the resource requests them.
      capabilities: { serverTools: {}, serverResources: {}, openLinks: {}, message: { text: {}, image: {} }, updateModelContext: { text: {} }, logging: {} },
      onInitialized: () => latest.current.onInitialized(host.appCapabilities()?.availableDisplayModes ?? ['inline']),
      onError: error => latest.current.onError(error), onUnknownOutcome: () => latest.current.onUnknown(),
      onSizeChanged: size => { if (size.height) latest.current.onHeight(size.height) },
    })
    slot.current ??= createMcpAppHostSlot()
    slot.current.replace(host); hostRef.current = host; latest.current.onHost(host)
    const unsubscribe = props.api.onMcpAppDocumentRevoked(event => {
      if (event.url !== props.registration.url) return
      host.revoke(); latest.current.onRevoked()
    })
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
    }
  }, [props.registration.id, props.api])
  useLayoutEffect(() => { if (props.active) hostRef.current?.activate() }, [props.active])
  useLayoutEffect(() => { void hostRef.current?.update(props.app).catch(props.onError) }, [props.app, props.onError])
  useLayoutEffect(() => { hostRef.current?.updateContext(props.context) }, [props.context])
  return <iframe ref={iframe} title={`${props.app.binding.server} MCP App`} data-mcp-app-frame={props.app.appInstanceId}
    sandbox="allow-scripts allow-same-origin allow-forms" allow="" referrerPolicy="no-referrer" className="h-full w-full border-0" />
}
