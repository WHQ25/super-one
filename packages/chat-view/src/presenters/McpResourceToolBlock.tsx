import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Database } from 'lucide-react'
import {
  parseMcpResourceBlock,
  type ListedMcpResource,
  type McpResourceInfo,
} from './mcp-resource-display'
import {
  CompactLabeledToolRow,
  ToolErrorText,
  ToolName,
  ToolRow,
  ToolSummary,
  toolOutcomeLabel,
  toolRowTone,
  withStreamingEllipsis,
} from './ToolRow'

export interface McpResourceToolBlockPresenterProps {
  toolName: string
  params: Record<string, unknown>
  result?: string | null
  isStreaming: boolean
  isError?: boolean
  isDenied?: boolean
  allowExpand?: boolean
}

function ResourceItemRow({ resource }: { resource: ListedMcpResource }) {
  const showSeparateUri = resource.uri && resource.uri !== resource.name
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded px-1.5 py-1 transition-colors hover:bg-muted/40">
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="shrink-0 truncate font-medium text-foreground" title={resource.name}>
          {resource.name}
        </span>
        {showSeparateUri ? (
          <span className="min-w-0 truncate font-mono text-2xs text-muted-foreground" title={resource.uri}>
            {resource.uri}
          </span>
        ) : null}
        {resource.mimeType ? (
          <span className="ml-auto shrink-0 rounded bg-muted/60 px-1 font-mono text-2xs text-muted-foreground">
            {resource.mimeType}
          </span>
        ) : null}
      </div>
      {resource.description ? (
        <span className="truncate text-2xs text-muted-foreground" title={resource.description}>
          {resource.description}
        </span>
      ) : null}
    </div>
  )
}

function buildHeaderSummary(
  info: McpResourceInfo,
  isStreaming: boolean,
  interrupted: boolean,
  t: ReturnType<typeof useTranslation>['t'],
): { node?: ReactNode; title?: string } {
  if (info.action === 'read') {
    const parts = [info.server, info.uri].filter(Boolean)
    if (parts.length === 0) return {}
    return {
      title: parts.join(' · '),
      node: (
        <span className="inline-flex min-w-0 items-center gap-1.5">
          {info.server ? <span className="shrink-0">{info.server}</span> : null}
          {info.server && info.uri ? <span className="text-muted-foreground/50">·</span> : null}
          {info.uri ? <span className="truncate font-mono">{info.uri}</span> : null}
        </span>
      ),
    }
  }

  let statusPart = ''
  if (!isStreaming && !interrupted) {
    if (info.resources.length > 0) {
      statusPart = t('chat.toolBlock.mcpResource.resourceCount', { count: info.resources.length })
    } else if (info.emptyList) {
      statusPart = t('chat.toolBlock.mcpResource.none')
    }
  }
  const parts = [info.server, statusPart].filter(Boolean)
  if (parts.length === 0) return {}
  return {
    title: parts.join(' · '),
    node: (
      <span className="inline-flex min-w-0 items-center gap-1.5">
        {info.server ? <span className="shrink-0">{info.server}</span> : null}
        {info.server && statusPart ? <span className="text-muted-foreground/50">·</span> : null}
        {statusPart ? <span className="truncate">{statusPart}</span> : null}
      </span>
    ),
  }
}

export function McpResourceToolBlockPresenter({
  toolName,
  params,
  result,
  isStreaming,
  isError,
  isDenied,
  allowExpand = true,
}: McpResourceToolBlockPresenterProps) {
  const { t } = useTranslation()
  const info = useMemo(
    () => parseMcpResourceBlock(toolName, params, result, isError),
    [toolName, params, result, isError],
  )

  const tone = toolRowTone(isDenied, isError)
  const interrupted = Boolean(isDenied) || Boolean(isError)
  const labels =
    info.action === 'read'
      ? {
          streamingLabel: t('chat.toolBlock.mcpResource.reading'),
          actionLabel: t('chat.toolBlock.mcpResource.readResource'),
          doneLabel: t('chat.toolBlock.mcpResource.resourceRead'),
        }
      : {
          streamingLabel: t('chat.toolBlock.mcpResource.listing'),
          actionLabel: t('chat.toolBlock.mcpResource.listResources'),
          doneLabel: t('chat.toolBlock.mcpResource.resourcesListed'),
        }

  const label = withStreamingEllipsis(
    toolOutcomeLabel({
      streaming: isStreaming,
      interrupted,
      ...labels,
    }),
    isStreaming,
  )
  const icon = <Database className="size-3 shrink-0 text-muted-foreground" />
  const summary = buildHeaderSummary(info, isStreaming, interrupted, t)

  if (!allowExpand) {
    return (
      <CompactLabeledToolRow
        icon={icon}
        label={label}
        summary={summary.node}
        streaming={isStreaming}
        tone={tone}
      />
    )
  }

  const deniedText = isDenied && typeof result === 'string' && result.trim() ? result.trim() : undefined
  const errorBody = deniedText ?? info.errorMessage

  let details: ReactNode = null
  if (!isStreaming) {
    if (errorBody) {
      details = <ToolErrorText className="px-1.5 py-1">{errorBody}</ToolErrorText>
    } else if (info.action === 'list') {
      if (info.resources.length > 0) {
        details = (
          <div className="flex flex-col gap-0.5">
            {info.resources.map((resource, idx) => (
              <ResourceItemRow key={`${resource.uri}:${idx}`} resource={resource} />
            ))}
          </div>
        )
      } else if (info.extraText) {
        details = (
          <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap break-words px-1.5 py-1 font-mono text-2xs text-muted-foreground">
            {info.extraText}
          </pre>
        )
      }
    } else {
      const readBadges: string[] = []
      if (info.mimeType) readBadges.push(info.mimeType)
      if (info.offloadedPath) {
        readBadges.push(t('chat.toolBlock.mcpResource.offloadedTo', { path: info.offloadedPath }))
      }
      if (info.mediaSummary) {
        readBadges.push(t('chat.toolBlock.mcpResource.mediaContent', { media: info.mediaSummary }))
      }
      if (info.skippedBinary) {
        readBadges.push(t('chat.toolBlock.mcpResource.binarySkipped'))
      }
      if (readBadges.length > 0 || info.contentText) {
        details = (
          <div className="flex flex-col gap-1.5 px-1.5 py-1">
            {readBadges.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {readBadges.map((badge) => (
                  <span
                    key={badge}
                    className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-2xs text-muted-foreground"
                  >
                    {badge}
                  </span>
                ))}
              </div>
            ) : null}
            {info.contentText ? (
              <pre className="max-h-60 overflow-y-auto whitespace-pre-wrap break-words rounded bg-muted/30 px-2 py-1.5 font-mono text-2xs text-foreground">
                {info.contentText}
              </pre>
            ) : null}
          </div>
        )
      }
    }
  }

  const hasBody = details !== null

  return (
    <ToolRow
      icon={icon}
      tone={tone}
      expandable={hasBody}
      detailsClassName="border-t border-border/40 px-1 py-1 text-xs"
      details={hasBody ? details : undefined}
    >
      <ToolName streaming={isStreaming} tone={tone}>
        {label}
      </ToolName>
      {summary.node ? <ToolSummary title={summary.title}>{summary.node}</ToolSummary> : null}
    </ToolRow>
  )
}
