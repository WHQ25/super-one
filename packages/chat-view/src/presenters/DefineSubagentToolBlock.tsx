import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Bot } from 'lucide-react'
import { parseDefineSubagent, type DefineSubagentInfo } from './define-subagent-display'
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

export interface DefineSubagentToolBlockPresenterProps {
  params: Record<string, unknown>
  result?: string | null
  isStreaming: boolean
  isError?: boolean
  isDenied?: boolean
  allowExpand?: boolean
}

function buildHeaderSummary(info: DefineSubagentInfo): { node?: ReactNode; title?: string } {
  const parts = [info.name, info.descriptionPreview].filter(Boolean)
  if (parts.length === 0) return {}
  return {
    title: parts.join(' · '),
    node: (
      <span className="inline-flex min-w-0 items-center gap-1.5">
        {info.name ? <span className="shrink-0 font-mono">{info.name}</span> : null}
        {info.name && info.descriptionPreview ? <span className="text-muted-foreground/50">·</span> : null}
        {info.descriptionPreview ? <span className="truncate">{info.descriptionPreview}</span> : null}
      </span>
    ),
  }
}

export function DefineSubagentToolBlockPresenter({
  params,
  result,
  isStreaming,
  isError,
  isDenied,
  allowExpand = true,
}: DefineSubagentToolBlockPresenterProps) {
  const { t } = useTranslation()
  const info = useMemo(() => parseDefineSubagent(params, result, isError), [params, result, isError])

  const tone = toolRowTone(isDenied, isError)
  const interrupted = Boolean(isDenied) || Boolean(isError)
  const label = withStreamingEllipsis(
    toolOutcomeLabel({
      streaming: isStreaming,
      interrupted,
      streamingLabel: t('chat.toolBlock.defineSubagent.defining'),
      actionLabel: t('chat.toolBlock.defineSubagent.defineSubagent'),
      doneLabel: t('chat.toolBlock.defineSubagent.subagentDefined'),
    }),
    isStreaming,
  )
  const icon = <Bot className="size-3 shrink-0 text-muted-foreground" />
  const summary = buildHeaderSummary(info)

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

  const capabilities: string[] = []
  if (info.enableWriteTools) capabilities.push(t('chat.toolBlock.defineSubagent.capWriteTools'))
  if (info.enableMcpTools) capabilities.push(t('chat.toolBlock.defineSubagent.capMcpTools'))
  if (info.enableSubagentTools) capabilities.push(t('chat.toolBlock.defineSubagent.capSubagentTools'))
  if (capabilities.length === 0 && (info.name || info.description || info.systemPrompt)) {
    capabilities.push(t('chat.toolBlock.defineSubagent.capReadOnly'))
  }

  let details: ReactNode = null
  if (!isStreaming) {
    if (errorBody) {
      details = <ToolErrorText className="px-1.5 py-1">{errorBody}</ToolErrorText>
    } else if (info.description || capabilities.length > 0 || info.systemPrompt || info.extraText) {
      details = (
        <div className="flex flex-col gap-1.5 px-1.5 py-1">
          {info.description ? (
            <p className="text-xs text-foreground">{info.description}</p>
          ) : null}
          {capabilities.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1">
              <span className="mr-0.5 text-2xs text-muted-foreground">
                {t('chat.toolBlock.defineSubagent.capabilitiesLabel')}:
              </span>
              {capabilities.map((cap) => (
                <span
                  key={cap}
                  className="rounded bg-muted/60 px-1.5 py-0.5 text-2xs text-muted-foreground"
                >
                  {cap}
                </span>
              ))}
            </div>
          ) : null}
          {info.systemPrompt ? (
            <div className="flex flex-col gap-0.5">
              <span className="text-2xs text-muted-foreground">
                {t('chat.toolBlock.defineSubagent.systemPromptLabel')}
              </span>
              <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded bg-muted/30 px-2 py-1.5 font-mono text-2xs text-muted-foreground">
                {info.systemPrompt}
              </pre>
            </div>
          ) : null}
          {!info.description && !info.systemPrompt && info.extraText ? (
            <pre className="whitespace-pre-wrap break-words font-mono text-2xs text-muted-foreground">
              {info.extraText}
            </pre>
          ) : null}
        </div>
      )
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
