import { useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import { CompactToolRow, ToolName, ToolSummary, withStreamingEllipsis } from './ToolRow'

/** Shared app-tool identity line: app name · tool name · summary. */
export function AppToolHeader({ appName, toolText, isStreaming, summary }: {
  appName?: string
  toolText: string
  isStreaming: boolean
  summary: string
}) {
  return (
    <>
      {appName && <><span className="shrink-0 font-medium text-foreground">{appName}</span><span className="shrink-0 text-muted-foreground">·</span></>}
      <ToolName streaming={isStreaming} className="font-normal">{isStreaming ? withStreamingEllipsis(toolText, true) : toolText}</ToolName>
      {summary ? <ToolSummary>{summary}</ToolSummary> : null}
    </>
  )
}

export interface AppToolBlockPresenterProps {
  icon: ReactNode
  appName?: string
  toolText: string
  summary: string
  isStreaming: boolean
  expandable: boolean
  result?: string
  /** Host-rendered JSON body — highlighted on the desktop, plain in the WebView. */
  renderJson: (text: string) => ReactNode
}

/**
 * The header card for a mini-app tool call. It carries only the app's identity, the tool's
 * readable name and the result, so it renders anywhere — including the phone, which has no
 * mini-app runtime and therefore never reaches the app's own WebView renderers.
 */
export function AppToolBlockPresenter({
  icon,
  appName,
  toolText,
  summary,
  isStreaming,
  expandable,
  result,
  renderJson,
}: AppToolBlockPresenterProps) {
  const [expanded, setExpanded] = useState(false)
  if (!expandable) {
    return (
      <CompactToolRow icon={icon}>
        <AppToolHeader appName={appName} toolText={toolText} isStreaming={isStreaming} summary={summary} />
      </CompactToolRow>
    )
  }
  return (
    <div className={cn('tool-node my-0.5 rounded bg-muted/20', 'cursor-pointer hover:bg-muted/40')}>
      <div
        className="flex items-center gap-1.5 px-2 py-1.5 text-xs"
        onClick={() => setExpanded((e) => !e)}
      >
        {icon}
        <AppToolHeader appName={appName} toolText={toolText} isStreaming={isStreaming} summary={summary} />
        <ChevronRight className={cn('ml-auto size-3 shrink-0 text-muted-foreground transition-transform duration-200', expanded && 'rotate-90')} />
      </div>
      <div
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div className="px-2 pb-1.5">
            {renderJson(result!)}
          </div>
        </div>
      </div>
    </div>
  )
}
