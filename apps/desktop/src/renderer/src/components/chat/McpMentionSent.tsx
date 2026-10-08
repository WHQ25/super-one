/**
 * What the agent gets for an MCP mention chip. The host reads a mentioned resource
 * at send and stores that copy with the message: a sent chip's hover shows it. A
 * composer chip's hover reads the resource now to preview what will be inlined.
 */
import { useState, type ReactNode } from 'react'
import { mcpMentionPreviewState, type McpMentionCardState } from '@superone/shared/mcp-app-mentions'
import { McpMentionCard, useMcpMentionSent } from '@superone/chat-view/presenters/McpMentionCard'
import { useSessionScope } from '@/stores/chat'
import { useMcpAppFileRoute } from '@/components/mcp-apps/file-apps'
import { previewMcpMention } from '@/components/mcp-apps/mention-content'
import { ChipHoverCard } from '@superone/ui/components/ui/ChipHoverCard'

/** A chip in a sent message: exactly what went to the agent. */
export function McpMentionSentHover({ value, children }: { value: string; children: ReactNode }) {
  const sent = useMcpMentionSent()
  if (!sent) return <>{children}</>
  return <ChipHoverCard card={<McpMentionCard value={value} phase="sent" state={{ status: 'read', resource: sent.get(value) }} />}>{children}</ChipHoverCard>
}

/** A chip in the composer: read on hover, so the user sees what sending will inline. */
export function McpMentionPreviewHover({ value, children }: { value: string; children: ReactNode }) {
  const route = useMcpAppFileRoute(useSessionScope())
  const [state, setState] = useState<McpMentionCardState>({ status: 'loading' })
  const load = () => {
    if (!route) { setState({ status: 'failed' }); return }
    void previewMcpMention(route, value).then((resource) => setState(mcpMentionPreviewState(resource)), () => setState({ status: 'failed' }))
  }
  return <ChipHoverCard onOpen={load} card={<McpMentionCard value={value} phase="preview" state={state} />}>{children}</ChipHoverCard>
}
