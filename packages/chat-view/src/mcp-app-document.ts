import type { ChatMessage, ContentBlock } from '@superone/shared/agent-types'
import type { McpUiResourceMeta, ToolAppAttachment } from '@superone/shared/mcp-apps'
import { mcpAppCspDomains, mcpAppCspMeta } from '@superone/shared/mcp-apps-host'

// Whitespace, comments and the doctype may precede the policy; anything after them may not.
const PROLOGUE = /^(?:\s|<!--[\s\S]*?-->)*(?:<!doctype[^>]*>)?/i

/**
 * The CSP domains a View actually gets on the phone, which is also what the host reports in
 * `hostCapabilities.sandbox.csp`. Nested frames are dropped: a `srcdoc` inherits the chat
 * document's `frame-src 'none'`, so a declared frame domain could never load.
 */
export function mobileMcpAppCsp(meta: McpUiResourceMeta | undefined): NonNullable<McpUiResourceMeta['csp']> {
  return { ...mcpAppCspDomains(meta?.csp), frameDomains: [] }
}

/**
 * The document an opaque `srcdoc` frame loads: the resource's own CSP as the first element,
 * so it governs the View's first script. A `<meta>` before `<html>` is parsed into the
 * implied `<head>`, and the doctype stays first so the View keeps standards mode.
 *
 * Two more policies apply on top and can only tighten it: the chat document's (a `srcdoc`
 * inherits it, see `index.html`) and any CSP meta the server's HTML carries itself.
 */
export function buildMcpAppSrcdoc(html: string, meta: McpUiResourceMeta | undefined): string {
  const prologue = PROLOGUE.exec(html)?.[0] ?? ''
  return prologue + mcpAppCspMeta(mobileMcpAppCsp(meta)) + html.slice(prologue.length)
}

type Arrival = 'live' | 'restored'
const arrivals = new Map<string, { arrival: Arrival; activated: boolean }>()

function attachmentsOf(message: ChatMessage): ToolAppAttachment[] {
  const found: ToolAppAttachment[] = []
  const visit = (block: ContentBlock): void => {
    if ((block.type === 'tool_use' || block.type === 'tool_result') && block.app) found.push(block.app)
  }
  message.content.forEach(visit)
  for (const item of message.metadata?.codex?.items ?? []) {
    if (item.type === 'mcp_tool_call' && item.app) found.push(item.app)
  }
  return found
}

/**
 * Record how each View first reached this document. A View first painted from a hydrate or
 * a history page is restored: it paints but calls nothing until the user activates it. One
 * first seen in a live patch stays live, including across the re-hydrate a reconnect sends.
 */
export function noteMcpAppArrivals(messages: readonly ChatMessage[] | undefined, arrival: Arrival): void {
  for (const message of messages ?? []) {
    for (const app of attachmentsOf(message)) {
      if (!arrivals.has(app.appInstanceId)) arrivals.set(app.appInstanceId, { arrival, activated: false })
    }
  }
}

/** A View this document has not seen arrive (a history window page) counts as restored. */
export function mcpAppNeedsActivation(appInstanceId: string): boolean {
  const seen = arrivals.get(appInstanceId)
  return !seen || (seen.arrival === 'restored' && !seen.activated)
}

/**
 * A live View this document has not yet announced. The host serves each device only the
 * Views it activated, so a live View activates itself once, before any other operation.
 */
export function mcpAppAwaitsLiveActivation(appInstanceId: string): boolean {
  const seen = arrivals.get(appInstanceId)
  return seen?.arrival === 'live' && !seen.activated
}

export function markMcpAppActivated(appInstanceId: string): void {
  arrivals.set(appInstanceId, { arrival: arrivals.get(appInstanceId)?.arrival ?? 'restored', activated: true })
}

/**
 * The host no longer serves this View (it restarted, for one). It waits for the user to
 * activate it again like a restored View, rather than activating itself or replaying the
 * request, and its next start asks the host again.
 */
export function markMcpAppInactive(appInstanceId: string): void {
  arrivals.set(appInstanceId, { arrival: 'restored', activated: false })
  starts.delete(appInstanceId)
}

type Resource = NonNullable<ToolAppAttachment['resource']>
const starts = new Map<string, Promise<Resource | null>>()

/**
 * Activate and load a View once per document. Its row remounts (a sealed turn, a virtualized
 * list scrolling back), so a remount joins the start in flight or reuses its result instead of
 * asking the host again. A failed start is forgotten, so Retry runs it again.
 */
export function startMcpApp(appInstanceId: string, run: () => Promise<Resource | null>): Promise<Resource | null> {
  const pending = starts.get(appInstanceId)
  if (pending) return pending
  const started = run()
  starts.set(appInstanceId, started)
  started.catch(() => { if (starts.get(appInstanceId) === started) starts.delete(appInstanceId) })
  return started
}

export function forgetMcpAppArrivals(): void {
  arrivals.clear()
  starts.clear()
}

let fullscreenExit: (() => void) | null = null

/** The open fullscreen View registers how to leave it; returns the unregister. */
export function setMcpAppFullscreenExit(exit: () => void): () => void {
  fullscreenExit = exit
  return () => { if (fullscreenExit === exit) fullscreenExit = null }
}

/** Native back leaves a fullscreen View before it leaves the chat. */
export function exitMcpAppFullscreen(): boolean {
  if (!fullscreenExit) return false
  fullscreenExit()
  return true
}
