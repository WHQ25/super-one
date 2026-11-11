import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Wrench } from 'lucide-react'
import { humanizePageToolName } from '@superone/shared/page-tool-name'
import type { McpAppToolAnnotations } from '@superone/shared/mcp-app-tools'
import { cn } from '@superone/ui/lib/utils'
import { ToolName, ToolRow, ToolSummary, type ToolRowTone } from './ToolRow'
import { pageToolInputSummary } from './page-tools-display'

export const MCP_APP_MCP_TOOL_NAMES: ReadonlySet<string> = new Set(['mcp_app_tools_list', 'mcp_app_tools_call'])

export interface McpAppToolsBlockProps {
  mcpToolName: string
  params: Record<string, unknown>
  result?: string | null
  toolSummary?: string
  isStreaming: boolean
  isError?: boolean
  isDenied?: boolean
  elapsedSeconds?: number
  allowExpand?: boolean
  renderJson?: (text: string) => ReactNode
}

interface ListedToolItem {
  name: string
  title?: string
  description?: string
  annotations?: McpAppToolAnnotations
  viewTitle?: string
  server?: string
}

interface ParsedListResult {
  subject: string
  tools: ListedToolItem[]
}

function defaultJson(text: string): ReactNode {
  let display = text
  try { display = JSON.stringify(JSON.parse(text), null, 2) } catch {}
  return <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all text-foreground/85">{display}</pre>
}

function cleanFailure(text: string): string {
  return text
    .replace(/^\[Error\]\s*/, '')
    .replace(/<\/?tool_use_error>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseJsonRecord(text: string | null | undefined): Record<string, unknown> | null {
  if (!text) return null
  const trimmed = text.trim()
  if (!trimmed.startsWith('{')) return null
  try {
    const parsed: unknown = JSON.parse(trimmed)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function parseListedTools(raw: unknown, viewTitle?: string, server?: string): ListedToolItem[] {
  if (!Array.isArray(raw)) return []
  const items: ListedToolItem[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const tool = entry as Record<string, unknown>
    if (typeof tool.name !== 'string' || !tool.name) continue
    items.push({
      name: tool.name,
      ...(typeof tool.title === 'string' && tool.title ? { title: tool.title } : {}),
      ...(typeof tool.description === 'string' && tool.description ? { description: tool.description } : {}),
      ...(tool.annotations && typeof tool.annotations === 'object' ? { annotations: tool.annotations as McpAppToolAnnotations } : {}),
      ...(viewTitle ? { viewTitle } : {}),
      ...(server ? { server } : {}),
    })
  }
  return items
}

function parseListResult(result: string | null | undefined): ParsedListResult | null {
  const obj = parseJsonRecord(result)
  if (!obj) return null
  if (Array.isArray(obj.tools)) {
    const viewTitle = typeof obj.viewTitle === 'string' ? obj.viewTitle : undefined
    const server = typeof obj.server === 'string' ? obj.server : undefined
    return {
      subject: viewTitle || server || '',
      tools: parseListedTools(obj.tools, viewTitle, server),
    }
  }
  if (Array.isArray(obj.views)) {
    const tools: ListedToolItem[] = []
    const titles: string[] = []
    for (const entry of obj.views) {
      if (!entry || typeof entry !== 'object') continue
      const view = entry as Record<string, unknown>
      const viewTitle = typeof view.viewTitle === 'string' ? view.viewTitle : undefined
      const server = typeof view.server === 'string' ? view.server : undefined
      const label = viewTitle || server
      if (label && !titles.includes(label)) titles.push(label)
      tools.push(...parseListedTools(view.tools, viewTitle, server))
    }
    return { subject: titles.join(', '), tools }
  }
  return null
}

function AnnotationBadges({ annotations }: { annotations?: McpAppToolAnnotations }) {
  const { t } = useTranslation()
  if (!annotations) return null
  const badges: Array<{ key: string; label: string; destructive?: boolean }> = []
  if (annotations.readOnlyHint) badges.push({ key: 'ro', label: t('mcpApp.readOnlyBadge') })
  if (annotations.destructiveHint) badges.push({ key: 'dest', label: t('mcpApp.destructiveBadge'), destructive: true })
  if (annotations.openWorldHint) badges.push({ key: 'ow', label: t('mcpApp.openWorldBadge') })
  if (annotations.idempotentHint) badges.push({ key: 'idem', label: t('mcpApp.idempotentBadge') })
  if (!badges.length) return null
  return (
    <span className="inline-flex flex-wrap gap-1">
      {badges.map((badge) => (
        <span
          key={badge.key}
          className={cn(
            'rounded px-1 py-0.5 text-[10px] font-medium leading-none',
            badge.destructive ? 'bg-error/10 text-error' : 'bg-muted text-muted-foreground',
          )}
        >
          {badge.label}
        </span>
      ))}
    </span>
  )
}

function classifyOutcome(result: string | null | undefined, isError?: boolean, isDenied?: boolean): {
  tone: ToolRowTone
  denied: boolean
  errored: boolean
  message: string
} {
  const raw = result?.trim() ?? ''
  if (isDenied) return { tone: 'denied', denied: true, errored: false, message: cleanFailure(raw) }
  const obj = parseJsonRecord(raw)
  if (obj && (obj.status === 'denied' || obj.status === 'cancelled')) {
    const hint = typeof obj.hint === 'string' ? obj.hint : ''
    return { tone: 'denied', denied: true, errored: false, message: hint }
  }
  if (isError || raw.startsWith('[Error]')) {
    return { tone: 'error', denied: false, errored: true, message: cleanFailure(raw) }
  }
  return { tone: 'default', denied: false, errored: false, message: '' }
}

export function McpAppToolsBlock({
  mcpToolName,
  params,
  result,
  toolSummary,
  isStreaming,
  isError,
  isDenied,
  elapsedSeconds,
  allowExpand = true,
  renderJson = defaultJson,
}: McpAppToolsBlockProps) {
  const { t } = useTranslation()
  const outcome = useMemo(() => classifyOutcome(result, isError, isDenied), [result, isError, isDenied])
  const trailing = isStreaming && elapsedSeconds != null && elapsedSeconds >= 1 ? (
    <span className="ml-auto shrink-0 text-muted-foreground">{Math.round(elapsedSeconds)}s</span>
  ) : null

  if (mcpToolName === 'mcp_app_tools_list') {
    const parsed = outcome.denied || outcome.errored ? null : parseListResult(result)
    const tools = parsed?.tools ?? []
    const label = isStreaming
      ? `${t('chat.toolBlock.mcpAppTools.listingTools')}…`
      : outcome.denied || outcome.errored
        ? t('chat.toolBlock.mcpAppTools.toolsList')
        : tools.length > 0
          ? t('chat.toolBlock.mcpAppTools.toolsListed', { count: tools.length })
          : t('chat.toolBlock.mcpAppTools.toolsEmpty')
    const summary = outcome.denied || outcome.errored
      ? outcome.message
      : parsed?.subject || toolSummary || ''
    return (
      <ToolRow
        icon={<Wrench className="size-3 shrink-0 text-muted-foreground" />}
        tone={outcome.tone}
        expandable={allowExpand && !isStreaming && tools.length > 0}
        details={tools.length > 0 ? (
          <ul className="space-y-2">
            {tools.map((tool) => (
              <li key={`${tool.server ?? ''}:${tool.name}`} className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate font-medium text-foreground" title={tool.name}>
                    {tool.title || humanizePageToolName(tool.name)}
                  </span>
                  <AnnotationBadges annotations={tool.annotations} />
                </div>
                {tool.description ? (
                  <p className="mt-0.5 line-clamp-2 whitespace-pre-wrap break-words text-xs leading-snug text-muted-foreground">
                    {tool.description}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        detailsClassName="px-2 pb-1.5 text-xs"
        trailing={trailing}
      >
        <ToolName streaming={isStreaming && !outcome.denied} tone={outcome.tone}>{label}</ToolName>
        {summary ? <ToolSummary>{summary}</ToolSummary> : null}
      </ToolRow>
    )
  }

  const rawTool = typeof params.tool === 'string' ? params.tool.trim() : ''
  const title = rawTool ? humanizePageToolName(rawTool) : t('chat.toolBlock.mcpAppTools.toolsCall')
  const description = typeof params.description === 'string' ? params.description.trim() : ''
  const inputSummary = pageToolInputSummary(params.input)
  const summary = outcome.denied
    ? outcome.message || description || inputSummary || toolSummary || ''
    : description || inputSummary || toolSummary || outcome.message
  const argsJson = params.input && typeof params.input === 'object' && !Array.isArray(params.input) && Object.keys(params.input).length > 0
    ? JSON.stringify(params.input, null, 2)
    : ''
  const outputText = outcome.denied || outcome.errored ? '' : (result?.trim() ?? '')
  const failureBody = outcome.errored && outcome.message && outcome.message !== summary ? outcome.message : ''
  const hasBody = Boolean(failureBody || argsJson || outputText)

  return (
    <ToolRow
      icon={<Wrench className="size-3 shrink-0 text-muted-foreground" />}
      tone={outcome.tone}
      expandable={allowExpand && !isStreaming && hasBody}
      details={hasBody ? (
        <div className="space-y-2">
          {failureBody ? <div className="whitespace-pre-wrap break-words text-xs text-warning/90">{failureBody}</div> : null}
          {argsJson ? (
            <div>
              <div className="mb-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground/70">
                {t('chat.toolBlock.mcpAppTools.arguments')}
              </div>
              {renderJson(argsJson)}
            </div>
          ) : null}
          {outputText ? (
            <div>
              {argsJson ? (
                <div className="mb-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground/70">
                  {t('chat.toolBlock.mcpAppTools.result')}
                </div>
              ) : null}
              {renderJson(outputText)}
            </div>
          ) : null}
        </div>
      ) : null}
      detailsClassName="px-2 pb-1.5 text-xs"
      trailing={trailing}
    >
      <ToolName streaming={isStreaming && !outcome.denied} tone={outcome.tone}>
        <span title={rawTool || undefined}>{isStreaming ? `${title}…` : title}</span>
      </ToolName>
      {summary ? <ToolSummary>{summary}</ToolSummary> : null}
    </ToolRow>
  )
}
