import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarClock, Clock, Timer } from 'lucide-react'
import {
  formatScheduleTriggerText,
  parseScheduleBlock,
  type ScheduleBlockInfo,
  type ScheduleMode,
} from './schedule-block-display'
import { shortenConversationId } from './manage-subagents-display'
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

export interface ScheduleToolBlockPresenterProps {
  params: Record<string, unknown>
  result?: string | null
  isStreaming: boolean
  isError?: boolean
  isDenied?: boolean
  allowExpand?: boolean
}

function ModeIcon({ mode }: { mode: ScheduleMode }) {
  if (mode === 'timer') return <Timer className="size-3 shrink-0 text-muted-foreground" />
  if (mode === 'cron') return <CalendarClock className="size-3 shrink-0 text-muted-foreground" />
  return <Clock className="size-3 shrink-0 text-muted-foreground" />
}

function useScheduleLabels(mode: ScheduleMode): {
  streamingLabel: string
  actionLabel: string
  doneLabel: string
} {
  const { t } = useTranslation()
  if (mode === 'timer') {
    return {
      streamingLabel: t('chat.toolBlock.schedule.settingTimer'),
      actionLabel: t('chat.toolBlock.schedule.setTimer'),
      doneLabel: t('chat.toolBlock.schedule.timerSet'),
    }
  }
  if (mode === 'cron') {
    return {
      streamingLabel: t('chat.toolBlock.schedule.schedulingCron'),
      actionLabel: t('chat.toolBlock.schedule.scheduleCron'),
      doneLabel: t('chat.toolBlock.schedule.cronScheduled'),
    }
  }
  return {
    streamingLabel: t('chat.toolBlock.schedule.scheduling'),
    actionLabel: t('chat.toolBlock.schedule.schedule'),
    doneLabel: t('chat.toolBlock.schedule.scheduled'),
  }
}

function buildHeaderSummary(
  info: ScheduleBlockInfo,
  locale: string,
): { node?: ReactNode; title?: string } {
  const trigger = formatScheduleTriggerText(info, locale)
  const parts = [trigger, info.promptPreview].filter(Boolean)
  if (parts.length === 0 && !info.shortTaskId) return {}

  const fullTitle = [...parts, info.shortTaskId].filter(Boolean).join(' · ')
  return {
    title: fullTitle,
    node: (
      <span className="inline-flex min-w-0 items-center gap-1.5">
        {trigger ? (
          <span className={info.cronExpression ? 'shrink-0 font-mono' : 'shrink-0'}>
            {trigger}
          </span>
        ) : null}
        {trigger && info.promptPreview ? <span className="text-muted-foreground/50">·</span> : null}
        {info.promptPreview ? <span className="truncate">{info.promptPreview}</span> : null}
        {info.shortTaskId ? (
          <span
            className="shrink-0 rounded bg-muted/60 px-1 font-mono text-2xs text-muted-foreground"
            title={info.taskId}
          >
            {info.shortTaskId}
          </span>
        ) : null}
      </span>
    ),
  }
}

export function ScheduleToolBlockPresenter({
  params,
  result,
  isStreaming,
  isError,
  isDenied,
  allowExpand = true,
}: ScheduleToolBlockPresenterProps) {
  const { t, i18n } = useTranslation()
  const info = useMemo(() => parseScheduleBlock(params, result, isError), [params, result, isError])
  const labels = useScheduleLabels(info.mode)

  const tone = toolRowTone(isDenied, isError)
  const interrupted = Boolean(isDenied) || Boolean(isError)
  const label = withStreamingEllipsis(
    toolOutcomeLabel({
      streaming: isStreaming,
      interrupted,
      ...labels,
    }),
    isStreaming,
  )
  const icon = <ModeIcon mode={info.mode} />
  const summary = buildHeaderSummary(info, i18n.language)

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

  const badges: Array<{ key: string; text: string; title?: string; mono?: boolean }> = []
  if (info.shortTaskId) {
    badges.push({
      key: 'task',
      text: `${t('chat.toolBlock.schedule.taskLabel')}: ${info.shortTaskId}`,
      title: info.taskId,
      mono: true,
    })
  }
  if (info.isDaemon) {
    badges.push({ key: 'daemon', text: t('chat.toolBlock.schedule.daemonBadge') })
  }
  if (info.exactTiming) {
    badges.push({ key: 'exact', text: t('chat.toolBlock.schedule.exactBadge') })
  }
  if (info.maxIterations !== undefined && info.maxIterations > 0) {
    badges.push({
      key: 'max',
      text: t('chat.toolBlock.schedule.maxIterations', { count: info.maxIterations }),
    })
  }
  if (info.timerCondition) {
    const condValue =
      info.timerCondition.toLowerCase() === 'any'
        ? t('chat.toolBlock.schedule.conditionAny')
        : shortenConversationId(info.timerCondition) ?? info.timerCondition
    badges.push({
      key: 'cond',
      text: `${t('chat.toolBlock.schedule.conditionLabel')}: ${condValue}`,
      title: info.timerCondition,
    })
  }

  let details: ReactNode = null
  if (!isStreaming) {
    if (errorBody) {
      details = <ToolErrorText className="px-1.5 py-1">{errorBody}</ToolErrorText>
    } else if (info.prompt || badges.length > 0 || info.extraText) {
      details = (
        <div className="flex flex-col gap-1.5 px-1.5 py-1">
          {badges.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {badges.map((badge) => (
                <span
                  key={badge.key}
                  title={badge.title}
                  className={
                    badge.mono
                      ? 'rounded bg-muted/60 px-1.5 py-0.5 font-mono text-2xs text-muted-foreground'
                      : 'rounded bg-muted/60 px-1.5 py-0.5 text-2xs text-muted-foreground'
                  }
                >
                  {badge.text}
                </span>
              ))}
            </div>
          ) : null}
          {info.prompt ? (
            <div className="flex flex-col gap-0.5">
              <span className="text-2xs text-muted-foreground">
                {t('chat.toolBlock.schedule.promptLabel')}
              </span>
              <pre className="whitespace-pre-wrap break-words rounded bg-muted/30 px-2 py-1.5 font-sans text-xs text-foreground">
                {info.prompt}
              </pre>
            </div>
          ) : null}
          {!info.prompt && info.extraText ? (
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
