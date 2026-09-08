import { Globe, MousePointer2, Smartphone } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ToolName, ToolRow, ToolSummary } from './ToolRow'

export interface InteractionMemoryToolBlockProps {
  family?: 'browser' | 'computer' | 'device'
  op: 'memory_read' | 'memory_write' | 'action_read' | 'action_archive'
  params: Record<string, unknown>
  result?: string
  toolSummary?: string
  isStreaming: boolean
  isDenied?: boolean
  isError?: boolean
  allowExpand?: boolean
  icon?: ReactNode
}

export function InteractionMemoryToolBlock(props: InteractionMemoryToolBlockProps) {
  const { t } = useTranslation()
  const { op, params, result, isStreaming, isDenied, isError, allowExpand = true, family = 'browser' } = props
  let data: Record<string, unknown> | undefined
  try {
    const parsed = JSON.parse(result ?? '')
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed
  } catch { /* Errors, partial and truncated results remain readable as plain text. */ }
  const failed = isError || data?.status === 'error' || result?.startsWith('[Error]')
  const tone = isDenied ? 'denied' : failed ? 'error' : 'default'
  const kind = op === 'memory_read' ? 'read' : op === 'action_read' ? 'actionRead'
    : op === 'action_archive' ? (params.archived === false ? 'actionRestore' : 'actionArchive')
      : params.archived === true ? 'archive' : params.archived === false ? 'restore' : 'write'
  const state = tone !== 'default' ? 'action' : isStreaming ? 'streaming' : 'done'
  const domain = typeof params.domain === 'string' ? params.domain : typeof data?.domain === 'string' ? data.domain : ''
  const topic = typeof params.topic === 'string' ? params.topic : typeof params.name === 'string' ? params.name : typeof data?.topic === 'string' ? data.topic : ''
  const count = typeof data?.count === 'number' && tone === 'default' && !isStreaming
    ? data.count === 0 ? t(`chat.toolBlock.${family}.memory.empty`) : t(`chat.toolBlock.${family}.memory.topics`, { count: data.count }) : ''
  const appId = typeof params.appId === 'string' ? params.appId : typeof data?.appId === 'string' ? data.appId : ''
  const platform = typeof params.platform === 'string' ? params.platform : typeof data?.platform === 'string' ? data.platform : ''
  const target = family === 'browser' ? domain : [platform, appId].filter(Boolean).join('/')
  const Icon = family === 'computer' ? MousePointer2 : family === 'device' ? Smartphone : Globe
  const summary = [[target, topic].filter(Boolean).join('/'), count].filter(Boolean).join(' · ') || props.toolSummary
  const detail = typeof data?.content === 'string' ? data.content : data ? JSON.stringify(data, null, 2) : result
  return (
    <ToolRow
      icon={props.icon ?? <Icon className="size-3 shrink-0 text-muted-foreground" />}
      tone={tone}
      expandable={allowExpand && !isStreaming && !!detail}
      mountDetails="expanded"
      details={detail ? <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words text-foreground/85">{detail}</pre> : undefined}
    >
      <ToolName streaming={isStreaming} tone={tone}>{t(`chat.toolBlock.${family}.memory.${kind}.${state}`)}</ToolName>
      {summary ? <ToolSummary>{summary}</ToolSummary> : null}
    </ToolRow>
  )
}
