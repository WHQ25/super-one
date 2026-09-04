import { useMemo, useState } from 'react'
import { ChevronRight, Loader2, ShieldQuestion, Wrench } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import { requestNative } from './bridge'
import { PortableNativeGallery } from './PortableNativeGallery'
import { parsePortableNativeWidgetResult } from './portable-native-widget'
import {
  ToolName,
  ToolStatusBadge,
  ToolStatusIcon,
  ToolSummary,
  toolRowSurfaceClass,
  type ToolRowTone,
} from './presenters/ToolRow'

function prettyValue(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2)
  } catch {
    return value
  }
}

function nativeActionForTool(
  toolName: string,
  input: string,
  filePath?: string,
  summary?: string,
): { action: string; payload: unknown } | null {
  let parsed: Record<string, unknown> = {}
  try { parsed = JSON.parse(input) as Record<string, unknown> } catch { /* keep empty */ }
  const parsedUrl = typeof parsed.url === 'string' ? parsed.url : undefined
  const summaryUrl = /^https?:\/\//i.test(summary ?? '') ? summary : undefined
  if (/^(?:WebFetch|WebSearch)$/i.test(toolName) && (parsedUrl || summaryUrl)) {
    return { action: 'openLink', payload: { url: parsedUrl ?? summaryUrl } }
  }
  if (/^(?:Read|Edit|Write|FileChange)$/i.test(toolName)) {
    const path = parsed.file_path ?? parsed.path ?? filePath
    if (typeof path === 'string') return { action: 'openFile', payload: { path } }
  }
  return null
}

export interface PortableToolProps {
  toolName: string
  toolUseId?: string
  input: string
  summary?: string
  filePath?: string
  result?: string
  status?: 'streaming' | 'complete'
  isError?: boolean
  pendingPermission?: boolean
  grouped?: boolean
}

export function PortableTool({
  toolName,
  toolUseId,
  input,
  summary,
  filePath,
  result,
  status,
  isError = false,
  pendingPermission = false,
  grouped = false,
}: PortableToolProps) {
  const [expanded, setExpanded] = useState(pendingPermission || isError)
  const nativeAction = useMemo(
    () => nativeActionForTool(toolName, input, filePath, summary),
    [toolName, input, filePath, summary],
  )
  const active = status === 'streaming'
  const isDenied = Boolean(result?.startsWith('[denied] '))
  const cleanResult = isDenied ? result?.slice('[denied] '.length) : result
  const tone: ToolRowTone = isDenied ? 'denied' : isError ? 'error' : 'default'
  const nativeWidget = useMemo(
    () => toolName === 'mcp__superone__widget_show'
      ? parsePortableNativeWidgetResult(result)
      : null,
    [toolName, result],
  )
  if (nativeWidget && !active && !isError && !pendingPermission) {
    return <PortableNativeGallery payload={nativeWidget} toolUseId={toolUseId} />
  }
  const hasDetails = Boolean(input || summary || filePath || cleanResult || nativeAction)
  const stateLabel = pendingPermission
    ? 'Awaiting approval'
    : isDenied
      ? 'Denied'
    : isError
      ? 'Failed'
      : active
        ? 'Running'
        : 'Complete'

  return (
    <div
      className={cn(
        toolRowSurfaceClass(tone, hasDetails),
        'overflow-hidden text-xs',
        grouped && 'my-0.5',
        pendingPermission && 'bg-primary/5 ring-1 ring-inset ring-primary/30',
      )}
      data-tool-name={toolName}
      data-tool-use-id={toolUseId}
      data-permission-pending={pendingPermission ? 'true' : undefined}
    >
      <button
        type="button"
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left"
        onClick={() => hasDetails && setExpanded((value) => !value)}
      >
        <ToolStatusIcon
          tone={tone}
          fallback={pendingPermission
            ? <ShieldQuestion className="size-3.5 text-primary" />
            : active
              ? <Loader2 className="size-3.5 animate-spin text-primary" />
              : <Wrench className="size-3 shrink-0 text-muted-foreground" />}
        />
        <ToolName streaming={active} tone={tone}>{toolName}</ToolName>
        {summary && <ToolSummary>{summary}</ToolSummary>}
        <ToolStatusBadge tone={tone} />
        <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{stateLabel}</span>
        {hasDetails && (
          <ChevronRight className={cn('size-3 shrink-0 transition-transform', expanded && 'rotate-90')} />
        )}
      </button>
      {expanded && hasDetails && (
        <div className="space-y-2 border-t border-border/50 px-2 py-2">
          {filePath && <div className="break-all text-foreground/85">{filePath}</div>}
          {summary && summary !== filePath && <div className="text-muted-foreground">{summary}</div>}
          {input && (
            <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-all text-muted-foreground">
              {prettyValue(input)}
            </pre>
          )}
          {cleanResult && (
            <pre className={cn(
              'max-h-56 overflow-auto whitespace-pre-wrap break-all border-t border-border/40 pt-2',
              isError ? 'text-destructive' : 'text-foreground/85',
            )}>
              {cleanResult}
            </pre>
          )}
          {nativeAction && (
            <button
              type="button"
              className="rounded bg-primary/10 px-2 py-1 text-primary"
              onClick={() => requestNative(nativeAction.action, nativeAction.payload)}
            >
              Open in host
            </button>
          )}
        </div>
      )}
    </div>
  )
}
