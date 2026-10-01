import type { WebContents, WebFrameMain } from 'electron'
import { isMcpAppUrl, mcpAppUrlOrigin, mcpAppResources } from './protocol'
import type { McpAppResourceRegistry } from './protocol'
import { MCP_APP_DOCUMENT_REVOKED } from '@superone/shared/mcp-apps-host/document'
export { MCP_APP_DOCUMENT_REVOKED } from '@superone/shared/mcp-apps-host/document'

/** Use in both Electron permission handlers; includes cross-origin subframe details. */
export function deniesMcpAppPermission(...urls: Array<string | undefined>): boolean {
  return urls.some(isMcpAppUrl)
}

function frameUrl(frame: WebFrameMain | null | undefined): string {
  try { return frame?.url ?? '' } catch { return '' }
}

/** Native boundary for every chat window; cancellation happens before network navigation. */
export function attachMcpAppFrameGuards(contents: WebContents, resources: McpAppResourceRegistry = mcpAppResources): void {
  // Cross-origin iframe key events never bubble to the shell DOM. Relay only this
  // host UI shortcut from native input; it does not grant the View a native API.
  contents.on('before-input-event', (_event, input) => {
    const url = frameUrl(contents.focusedFrame)
    if (input.type === 'keyDown' && input.key === 'Escape' && isMcpAppUrl(url)) contents.send('mcpApp:escape', { url })
  })
  const documents = new Map<number, string>()
  const previousUrl = (frame: WebFrameMain | null | undefined): string => {
    if (!frame) return ''
    return documents.get(frame.frameTreeNodeId) ?? frameUrl(frame)
  }
  const prevent = (details: { frame: WebFrameMain | null; initiator?: WebFrameMain | null; isMainFrame: boolean; url: string; preventDefault(): void }): void => {
    const source = previousUrl(details.frame)
    if (isMcpAppUrl(source) && mcpAppUrlOrigin(details.url) !== mcpAppUrlOrigin(source)) details.preventDefault()
    // Defense in depth if a future iframe accidentally receives top-navigation permission.
    if (details.isMainFrame && isMcpAppUrl(frameUrl(details.initiator))) details.preventDefault()
  }
  contents.on('will-frame-navigate', prevent)
  contents.on('will-redirect', prevent)
  contents.on('did-start-navigation', details => {
    if (details.isSameDocument || !details.frame) return
    const previous = previousUrl(details.frame)
    if (isMcpAppUrl(previous)) {
      // Invalidate the host lease before new script can send using the same WindowProxy.
      resources.revoke(previous)
      contents.send(MCP_APP_DOCUMENT_REVOKED, { url: previous })
      return
    }
    if (isMcpAppUrl(details.url) && resources.isActive(details.url, contents.id)) {
      // Drop removed iframe ids as new Views mount; route changes keep the original registration.
      const live = new Set(contents.mainFrame.framesInSubtree.map(frame => frame.frameTreeNodeId))
      for (const id of documents.keys()) if (!live.has(id)) documents.delete(id)
      documents.set(details.frame.frameTreeNodeId, details.url)
    }
  })
  contents.once('destroyed', () => { documents.clear(); resources.releaseOwner(contents.id) })
}
