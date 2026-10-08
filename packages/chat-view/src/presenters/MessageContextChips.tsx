import { useState } from 'react'
import type { ChatMessageContext } from '@superone/shared/agent-types'
import { ContextAttachments } from '@superone/ui/components/ui/context-attachments'
import { Popover, PopoverContent, PopoverTrigger } from '@superone/ui/components/ui/popover'
import { deriveColors } from '@superone/ui/lib/context-colors'
import { useUserBubblePorts } from './user-bubble-ports'

/** What a mini-app context hands the agent: its app, summary and content. */
export function ContextPreviewContent({ appName, summary, content }: { appName: string; summary: string; content: string }) {
  return (
    <>
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-foreground">
        <span>{appName}</span>
        {summary && <span className="text-muted-foreground">· {summary}</span>}
      </div>
      <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted p-2.5 font-mono text-xs leading-relaxed text-muted-foreground">
        {content}
      </pre>
    </>
  )
}

function MiniAppContextChip({ ctx }: { ctx: ChatMessageContext }) {
  const { MentionIcon, useIsDark } = useUserBubblePorts()
  const [open, setOpen] = useState(false)
  const colors = deriveColors(ctx.color, useIsDark())
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs whitespace-nowrap cursor-pointer"
          style={{ background: `${colors.bg}cc`, border: `1px solid ${colors.bg}` }}
          onClick={() => setOpen(!open)}
        >
          <span className="flex size-3 shrink-0 [&>*]:size-full"><MentionIcon kind="miniapp" value={ctx.appId} label={ctx.appName} /></span>
          <span style={{ color: colors.color }} className="font-medium">{ctx.appName}</span>
          {ctx.summary && (
            <>
              <span style={{ color: colors.labelColor, fontSize: 10 }}>·</span>
              <span style={{ color: colors.labelColor, fontSize: 11 }}>{ctx.summary}</span>
            </>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        className="w-80 max-w-[calc(100vw-2rem)] p-3"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <ContextPreviewContent appName={ctx.appName} summary={ctx.summary} content={ctx.content} />
      </PopoverContent>
    </Popover>
  )
}

/** The contexts a user message carried: MCP app contexts as attachments, mini-app contexts as coloured chips. */
export function MessageContextChips({ contexts }: { contexts: ChatMessageContext[] }) {
  return (
    <div className="mb-1.5 flex flex-wrap gap-1">
      {contexts.map((ctx) => (
        ctx.appId.startsWith('mcp:')
          ? <ContextAttachments key={ctx.appId} items={[{ id: ctx.appId, title: ctx.summary, source: ctx.appName, content: ctx.content, thumbnail: ctx.thumbnail }]} />
          : <MiniAppContextChip key={ctx.appId} ctx={ctx} />
      ))}
    </div>
  )
}
