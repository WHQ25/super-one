/**
 * What the agent gets for an MCP mention chip. The host reads a mentioned resource
 * at send and stores that copy with the message: a sent chip's hover shows it. A
 * composer chip's hover reads the resource now to preview what will be inlined.
 */
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@superone/ui/components/ui/hover-card'
import type { ContentBlock } from '@superone/shared/agent-types'
import { MCP_MENTION_INLINE_MAX_CHARS, parseMcpMentionValue, parseMcpResourceReminder, type McpMentionReadResource } from '@superone/shared/mcp-app-mentions'
import { useSessionScope } from '@/stores/chat'
import { useMcpAppFileRoute } from '@/components/mcp-apps/file-apps'
import { previewMcpMention } from '@/components/mcp-apps/mention-content'

const McpMentionSentContext = createContext<Map<string, McpMentionReadResource> | null>(null)

/** Provided per user message; chips outside one (the composer) preview instead. */
export function McpMentionSentProvider({ content, children }: { content: ContentBlock[]; children: ReactNode }) {
  const sent = useMemo(() => parseMcpResourceReminder(content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n')), [content])
  return <McpMentionSentContext.Provider value={sent}>{children}</McpMentionSentContext.Provider>
}

type CardState = { status: 'loading' } | { status: 'failed' } | { status: 'read'; resource?: McpMentionReadResource }

function McpMentionCard({ value, phase, state }: { value: string; phase: 'sent' | 'preview'; state: CardState }) {
  const { t } = useTranslation()
  const target = parseMcpMentionValue(value)
  if (!target) return null
  const text = state.status === 'read' ? state.resource?.text : undefined
  const key = (sent: string, preview: string) => t(`chat.mentionPopup.${phase === 'sent' ? sent : preview}`, { count: state.status === 'read' && state.resource?.truncated ? MCP_MENTION_INLINE_MAX_CHARS : text?.length ?? 0 })
  const status = state.status === 'loading' ? t('chat.mentionPopup.mcpPreviewLoading')
    : state.status === 'failed' ? t('chat.mentionPopup.mcpPreviewFailed')
      : text === undefined ? key('mcpSentLinkOnly', 'mcpPreviewLinkOnly')
        : state.resource?.truncated ? key('mcpSentTruncated', 'mcpPreviewTruncated') : key('mcpSentContent', 'mcpPreviewContent')
  return (
    <>
      <div className="min-w-0 space-y-0.5">
        <div className="truncate font-medium text-foreground">{target.server}</div>
        <div className="truncate font-mono text-2xs text-muted-foreground" title={target.uri}>{target.uri}</div>
      </div>
      <div className="text-muted-foreground">{status}</div>
      {text !== undefined ? (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/60 p-2 font-mono text-2xs leading-relaxed text-foreground">
          {text}
        </pre>
      ) : null}
    </>
  )
}

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
  const sent = useContext(McpMentionSentContext)
  if (!sent) return <>{children}</>
  return <Hover card={<McpMentionCard value={value} phase="sent" state={{ status: 'read', resource: sent.get(value) }} />}>{children}</Hover>
}

/** A chip in the composer: read on hover, so the user sees what sending will inline. */
export function McpMentionPreviewHover({ value, children }: { value: string; children: ReactNode }) {
  const route = useMcpAppFileRoute(useSessionScope())
  const [state, setState] = useState<CardState>({ status: 'loading' })
  const load = () => {
    if (!route) { setState({ status: 'failed' }); return }
    void previewMcpMention(route, value).then(
      (resource) => setState(resource && resource.skipped !== 'failed' ? { status: 'read', resource } : { status: 'failed' }),
      () => setState({ status: 'failed' }),
    )
  }
  return <Hover onOpen={load} card={<McpMentionCard value={value} phase="preview" state={state} />}>{children}</Hover>
}
