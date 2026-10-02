import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Popover, PopoverContent, PopoverTrigger } from '@superone/ui/components/ui/popover'
import type { ContentBlock } from '@superone/shared/agent-types'
import {
  mcpMentionCardStatus, parseMcpMentionValue, parseMcpResourceReminder, type McpMentionCardState, type McpMentionReadResource,
} from '@superone/shared/mcp-app-mentions'

const LINES = {
  sent: { content: 'mcpSentContent', truncated: 'mcpSentTruncated', linkOnly: 'mcpSentLinkOnly' },
  preview: { content: 'mcpPreviewContent', truncated: 'mcpPreviewTruncated', linkOnly: 'mcpPreviewLinkOnly' },
} as const

/**
 * What the agent gets for an MCP mention chip: the server, the URI and the text inlined.
 * `sent` shows the copy stored with a message; `preview` what sending will read. The
 * desktop opens it on hover, the phone transcript on tap.
 */
export function McpMentionCard({ value, phase, state }: { value: string; phase: 'sent' | 'preview'; state: McpMentionCardState }) {
  const { t } = useTranslation()
  const target = parseMcpMentionValue(value)
  if (!target) return null
  const { line, count } = mcpMentionCardStatus(state)
  const key = line === 'loading' ? 'mcpPreviewLoading' : line === 'failed' ? 'mcpPreviewFailed' : LINES[phase][line]
  const text = state.status === 'read' ? state.resource?.text : undefined
  return (
    <>
      <div className="min-w-0 space-y-0.5">
        <div className="truncate font-medium text-foreground">{target.server}</div>
        <div className="truncate font-mono text-2xs text-muted-foreground" title={target.uri}>{target.uri}</div>
      </div>
      <div className="text-muted-foreground">{t(`chat.mentionPopup.${key}`, { count })}</div>
      {text !== undefined ? (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/60 p-2 font-mono text-2xs leading-relaxed text-foreground">
          {text}
        </pre>
      ) : null}
    </>
  )
}

const McpMentionSentContext = createContext<Map<string, McpMentionReadResource> | null>(null)

/** Provided per user message: the copy of each mentioned resource the message carried. */
export function McpMentionSentProvider({ content, children }: { content: ContentBlock[]; children: ReactNode }) {
  const sent = useMemo(() => parseMcpResourceReminder(content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n')), [content])
  return <McpMentionSentContext.Provider value={sent}>{children}</McpMentionSentContext.Provider>
}

/** What a sent message carried for chips inside it; `null` outside a message (the composer). */
export function useMcpMentionSent(): Map<string, McpMentionReadResource> | null {
  return useContext(McpMentionSentContext)
}

/**
 * A sent chip on a touch screen: tapping opens the card a desktop hover shows, the way
 * a context chip opens its content.
 */
export function McpMentionSentTap({ value, children }: { value: string; children: ReactNode }) {
  const sent = useMcpMentionSent()
  if (!sent) return <>{children}</>
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" data-mcp-mention-trigger className="inline cursor-pointer text-left">{children}</button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(28rem,var(--radix-popover-content-available-width))] space-y-2 p-3 text-xs"
        onOpenAutoFocus={(event) => event.preventDefault()}>
        <McpMentionCard value={value} phase="sent" state={{ status: 'read', resource: sent.get(value) }} />
      </PopoverContent>
    </Popover>
  )
}
