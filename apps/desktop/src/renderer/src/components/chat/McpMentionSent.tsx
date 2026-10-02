/**
 * What the agent gets for an MCP mention chip. The host reads a mentioned resource
 * at send and stores that copy with the message: a sent chip's hover shows it. A
 * composer chip's hover reads the resource now to preview what will be inlined.
 */
import { useState, type ReactNode } from 'react'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@superone/ui/components/ui/hover-card'
import { mcpMentionPreviewState, type McpMentionCardState } from '@superone/shared/mcp-app-mentions'
import { McpMentionCard, useMcpMentionSent } from '@superone/chat-view/presenters/McpMentionCard'
import { useSessionScope } from '@/stores/chat'
import { useMcpAppFileRoute } from '@/components/mcp-apps/file-apps'
import { previewMcpMention } from '@/components/mcp-apps/mention-content'

function Hover({ children, onOpen, card }: { children: ReactNode; onOpen?: () => void; card: ReactNode }) {
  return (
    <HoverCard openDelay={250} closeDelay={80} onOpenChange={(open) => { if (open) onOpen?.() }}>
      <HoverCardTrigger asChild>
        <span className="cursor-default">{children}</span>
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-[min(28rem,80vw)] space-y-2 p-3 text-xs">
        {card}
      </HoverCardContent>
    </HoverCard>
  )
}

/** A chip in a sent message: exactly what went to the agent. */
export function McpMentionSentHover({ value, children }: { value: string; children: ReactNode }) {
  const sent = useMcpMentionSent()
  if (!sent) return <>{children}</>
  return <Hover card={<McpMentionCard value={value} phase="sent" state={{ status: 'read', resource: sent.get(value) }} />}>{children}</Hover>
}

/** A chip in the composer: read on hover, so the user sees what sending will inline. */
export function McpMentionPreviewHover({ value, children }: { value: string; children: ReactNode }) {
  const route = useMcpAppFileRoute(useSessionScope())
  const [state, setState] = useState<McpMentionCardState>({ status: 'loading' })
  const load = () => {
    if (!route) { setState({ status: 'failed' }); return }
    void previewMcpMention(route, value).then((resource) => setState(mcpMentionPreviewState(resource)), () => setState({ status: 'failed' }))
  }
  return <Hover onOpen={load} card={<McpMentionCard value={value} phase="preview" state={state} />}>{children}</Hover>
}
