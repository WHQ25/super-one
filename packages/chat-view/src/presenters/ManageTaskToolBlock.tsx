import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { CircleStop, ClipboardList, SquareTerminal, Terminal } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import {
  parseManageTask,
  type ListedBackgroundTask,
  type ManageTaskAction,
  type ManageTaskInfo,
  type ManageTaskStatus,
} from './manage-task-display'
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

export interface ManageTaskToolBlockPresenterProps {
  params: Record<string, unknown>
  result?: string | null
  isStreaming: boolean
  isError?: boolean
  isDenied?: boolean
  allowExpand?: boolean
}

const STATUS_DOT: Record<ManageTaskStatus, string> = {
  running: 'bg-success',
  done: 'border border-muted-foreground/60',
  error: 'bg-warning',
  cancelled: 'bg-muted-foreground/35',
  unknown: 'bg-muted-foreground/40',
}

function ActionIcon({ action }: { action: ManageTaskAction }) {
  if (action === 'status') return <SquareTerminal className="size-3 shrink-0 text-muted-foreground" />
  if (action === 'kill') return <CircleStop className="size-3 shrink-0 text-muted-foreground" />
  if (action === 'send_input') return <Terminal className="size-3 shrink-0 text-muted-foreground" />
  return <ClipboardList className="size-3 shrink-0 text-muted-foreground" />
}

function TaskStatusDot({ status, label }: { status: ManageTaskStatus; label: string }) {
  return (
    <span
      className={cn('size-1.5 shrink-0 rounded-full', STATUS_DOT[status])}
      title={label}
    />
  )
}

function ListedTaskRow({ task }: { task: ListedBackgroundTask }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5 rounded px-1.5 py-1 transition-colors hover:bg-muted/40">
      <span className="size-1.5 shrink-0 rounded-full bg-success" />
      <span className="max-w-[35%] shrink-0 truncate font-mono text-foreground" title={task.taskId}>
        {task.shortTaskId}
      </span>
      {task.tool ? (
        <span className="shrink-0 rounded bg-muted/60 px-1 font-mono text-2xs text-muted-foreground">
          {task.tool}
        </span>
      ) : null}
      {task.description ? (
        <span className="min-w-0 truncate text-muted-foreground" title={task.description}>
          {task.description}
        </span>
      ) : null}
      {task.displayStartTime ? (
        <span
          className="ml-auto shrink-0 pl-1.5 text-2xs tabular-nums text-muted-foreground/70"
          title={task.startTime}
        >
          {task.displayStartTime}
        </span>
      ) : null}
    </div>
  )
}

function useActionLabels(action: ManageTaskAction): {
  streamingLabel: string
  actionLabel: string
  doneLabel: string
} {
  const { t } = useTranslation()
  if (action === 'list') {
    return {
      streamingLabel: t('chat.toolBlock.manageTask.listing'),
      actionLabel: t('chat.toolBlock.manageTask.listTasks'),
      doneLabel: t('chat.toolBlock.manageTask.tasksListed'),
    }
  }
  if (action === 'status') {
    return {
      streamingLabel: t('chat.toolBlock.manageTask.checkingStatus'),
      actionLabel: t('chat.toolBlock.manageTask.checkStatus'),
      doneLabel: t('chat.toolBlock.manageTask.statusChecked'),
    }
  }
  if (action === 'kill') {
    return {
      streamingLabel: t('chat.toolBlock.manageTask.stopping'),
      actionLabel: t('chat.toolBlock.manageTask.stopTask'),
      doneLabel: t('chat.toolBlock.manageTask.taskStopped'),
    }
  }
  if (action === 'send_input') {
    return {
      streamingLabel: t('chat.toolBlock.manageTask.sendingInput'),
      actionLabel: t('chat.toolBlock.manageTask.sendInput'),
      doneLabel: t('chat.toolBlock.manageTask.inputSent'),
    }
  }
  return {
    streamingLabel: t('chat.toolBlock.manageTask.managing'),
    actionLabel: t('chat.toolBlock.manageTask.manageTask'),
    doneLabel: t('chat.toolBlock.manageTask.taskManaged'),
  }
}

function buildHeaderSummary(
  info: ManageTaskInfo,
  isStreaming: boolean,
  interrupted: boolean,
  t: ReturnType<typeof useTranslation>['t'],
): { node?: ReactNode; title?: string } {
  if (info.action === 'list') {
    if (isStreaming) return {}
    if (info.tasks.length > 0) {
      const text = t('chat.toolBlock.manageTask.runningCount', { count: info.tasks.length })
      return { node: text, title: text }
    }
    if (info.emptyList) {
      const text = t('chat.toolBlock.manageTask.none')
      return { node: text, title: text }
    }
    if (!interrupted && info.extraText) {
      const firstLine = info.extraText.split(/\r?\n/, 1)[0] ?? ''
      return { node: firstLine, title: firstLine }
    }
    return {}
  }

  if (info.action === 'status') {
    const statusKey = info.statusInfo?.status
    const statusText = statusKey ? t(`chat.toolBlock.manageTask.status.${statusKey}`) : undefined
    const age = info.statusInfo?.lastProgress
    const parts = [info.shortTaskId, !isStreaming ? statusText : undefined, !isStreaming ? age : undefined].filter(Boolean)
    if (parts.length === 0) return {}
    const fullTitle = [info.taskId ?? info.shortTaskId, !isStreaming ? statusText : undefined, !isStreaming ? age : undefined]
      .filter(Boolean)
      .join(' · ')
    return {
      title: fullTitle,
      node: (
        <span className="inline-flex min-w-0 items-center gap-1.5">
          {info.shortTaskId ? <span className="truncate font-mono">{info.shortTaskId}</span> : null}
          {!isStreaming && statusKey && statusText ? (
            <span className="inline-flex shrink-0 items-center gap-1">
              {info.shortTaskId ? <span className="text-muted-foreground/50">·</span> : null}
              <TaskStatusDot status={statusKey} label={statusText} />
              <span>{statusText}</span>
            </span>
          ) : null}
          {!isStreaming && age ? (
            <span className="shrink-0 text-muted-foreground/75">· {age}</span>
          ) : null}
        </span>
      ),
    }
  }

  if (info.action === 'send_input') {
    const parts = [info.shortTaskId, info.sentInputPreview].filter(Boolean)
    if (parts.length === 0) return {}
    return {
      title: [info.taskId ?? info.shortTaskId, info.sentInputPreview].filter(Boolean).join(' · '),
      node: (
        <span className="inline-flex min-w-0 items-center gap-1.5">
          {info.shortTaskId ? <span className="shrink-0 font-mono">{info.shortTaskId}</span> : null}
          {info.shortTaskId && info.sentInputPreview ? <span className="text-muted-foreground/50">·</span> : null}
          {info.sentInputPreview ? <span className="truncate font-mono">{info.sentInputPreview}</span> : null}
        </span>
      ),
    }
  }

  if (info.shortTaskId) {
    return {
      title: info.taskId ?? info.shortTaskId,
      node: <span className="font-mono">{info.shortTaskId}</span>,
    }
  }

  return {}
}

export function ManageTaskToolBlockPresenter({
  params,
  result,
  isStreaming,
  isError,
  isDenied,
  allowExpand = true,
}: ManageTaskToolBlockPresenterProps) {
  const { t } = useTranslation()
  const info = useMemo(() => parseManageTask(params, result, isError), [params, result, isError])
  const labels = useActionLabels(info.action)

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
  const icon = <ActionIcon action={info.action} />
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
    } else if (info.action === 'list' && info.tasks.length > 0) {
      details = (
        <div className="flex flex-col gap-0.5">
          {info.tasks.map((task, idx) => (
            <ListedTaskRow key={`${task.taskId}:${idx}`} task={task} />
          ))}
        </div>
      )
    } else if (info.action === 'status' && info.statusInfo) {
      const statusText = t(`chat.toolBlock.manageTask.status.${info.statusInfo.status}`)
      const showFullId = info.taskId && info.taskId !== info.shortTaskId
      const hasLog = info.statusInfo.logOutput.length > 0
      details = (
        <div className="flex flex-col gap-1.5 px-1 py-0.5">
          {(showFullId || info.statusInfo.truncatedLines != null) ? (
            <div className="flex flex-wrap items-center gap-2 text-2xs text-muted-foreground">
              {showFullId ? (
                <span className="truncate font-mono" title={info.taskId}>
                  {info.taskId}
                </span>
              ) : null}
              {info.statusInfo.truncatedLines != null ? (
                <span className="ml-auto shrink-0 text-muted-foreground/70">
                  {t('chat.toolBlock.manageTask.truncatedLines', { count: info.statusInfo.truncatedLines })}
                </span>
              ) : null}
            </div>
          ) : null}
          {hasLog ? (
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/40 px-2 py-1.5 font-mono text-2xs leading-relaxed text-foreground/90">
              {info.statusInfo.logOutput}
            </pre>
          ) : (
            <span className="text-2xs text-muted-foreground" title={statusText}>
              {t('chat.toolBlock.manageTask.noLogOutput')}
            </span>
          )}
        </div>
      )
    } else if (info.action === 'send_input' && info.sentInput !== undefined && info.sentInput.length > 0) {
      details = (
        <div className="flex flex-col gap-1 px-1 py-0.5">
          <span className="text-2xs text-muted-foreground">{t('chat.toolBlock.manageTask.inputLabel')}</span>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/40 px-2 py-1.5 font-mono text-2xs text-foreground/90">
            {info.sentInput}
          </pre>
        </div>
      )
    } else if (info.extraText) {
      details = (
        <pre className="whitespace-pre-wrap break-words px-1.5 py-1 font-mono text-2xs text-muted-foreground">
          {info.extraText}
        </pre>
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
