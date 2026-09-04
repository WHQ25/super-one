import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowDown,
  ArrowUp,
  Bot,
  Check,
  ChevronRight,
  CircleSlash,
  Maximize,
  TriangleAlert,
  Wrench,
} from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'

export interface SubagentColorClasses {
  text: string
  tagBg: string
  tagText: string
  activityBg: string
  borderL: string
}

export interface SubagentDisplayInput {
  name: string
  teamName: string
  description: string
  subagentType: string
  prompt: string
  model?: string
}

export interface SubagentStats {
  toolCalls: number
  totalTokens?: number
  inputTokens?: number
  outputTokens?: number
}

export interface SubagentMarkdownProps {
  text: string
}

export interface SubagentBlockPresenterProps {
  toolUseId: string
  taskInput: SubagentDisplayInput
  colors: SubagentColorClasses
  isAsync: boolean
  isRunning: boolean
  isComplete: boolean
  isFailed: boolean
  isStopped: boolean
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
  canOpenFullView?: boolean
  onOpenFullView: () => void
  initialElapsed: number
  completionElapsed?: number
  stats: SubagentStats
  retryBadge?: ReactNode
  activityContent?: ReactNode
  childContent?: ReactNode
  diagnostic?: string
  resultText?: string
  trailingAction?: ReactNode
  formatTokens: (tokens: number) => string
  Markdown: ComponentType<SubagentMarkdownProps>
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  const mins = Math.floor(seconds / 60)
  const secs = Math.round(seconds % 60)
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`
}

function SubagentTokens({
  input,
  output,
  formatTokens,
}: {
  input: number
  output: number
  formatTokens: (tokens: number) => string
}) {
  if (input <= 0 && output <= 0) return null
  return (
    <>
      {input > 0 && (
        <span className="inline-flex items-center gap-0.5 tabular-nums">
          <ArrowUp className="size-2.5" />
          {formatTokens(input)}
        </span>
      )}
      {output > 0 && (
        <span className="inline-flex items-center gap-0.5 tabular-nums">
          <ArrowDown className="size-2.5" />
          {formatTokens(output)}
        </span>
      )}
    </>
  )
}

function OutputPreview({
  text,
  Markdown,
}: {
  text: string
  Markdown: ComponentType<SubagentMarkdownProps>
}) {
  const { t } = useTranslation()
  const [showOutput, setShowOutput] = useState(false)
  return (
    <div className="border-t border-border/30 px-3 py-1.5">
      <button
        onClick={(event) => {
          event.stopPropagation()
          setShowOutput((shown) => !shown)
        }}
        className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronRight className={cn('size-2.5 shrink-0 transition-transform duration-200', showOutput && 'rotate-90')} />
        <span className="font-medium">{t('chat.subagent.output')}</span>
      </button>
      {showOutput && (
        <div className="mt-1 max-h-50 overflow-y-auto text-xs">
          <Markdown text={text} />
        </div>
      )}
    </div>
  )
}

function PromptPreview({ prompt, model }: { prompt: string; model?: string }) {
  const { t } = useTranslation()
  const [showPrompt, setShowPrompt] = useState(false)
  return (
    <div className="px-3 py-1.5 text-xs">
      <button
        onClick={(event) => {
          event.stopPropagation()
          setShowPrompt((shown) => !shown)
        }}
        className="flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronRight className={cn('size-2.5 shrink-0 transition-transform duration-200', showPrompt && 'rotate-90')} />
        <span>{t('chat.subagent.prompt')}</span>
        {model && <span className="ml-1 rounded bg-muted px-1 py-px text-xs">{model}</span>}
      </button>
      {showPrompt && (
        <div className="mt-1 max-h-25 overflow-y-auto whitespace-pre-wrap rounded bg-background/50 px-2 py-1.5 leading-relaxed text-muted-foreground">
          {prompt}
        </div>
      )}
    </div>
  )
}

export function SubagentBlockPresenter({
  toolUseId,
  taskInput,
  colors,
  isAsync,
  isRunning,
  isComplete,
  isFailed,
  isStopped,
  expanded,
  onExpandedChange,
  canOpenFullView = true,
  onOpenFullView,
  initialElapsed,
  completionElapsed,
  stats,
  retryBadge,
  activityContent,
  childContent,
  diagnostic,
  resultText,
  trailingAction,
  formatTokens,
  Markdown,
}: SubagentBlockPresenterProps) {
  const { t } = useTranslation()
  const showSpawningPlaceholder = !taskInput.subagentType && !taskInput.description
  const isExpandable = !showSpawningPlaceholder
  const isExpanded = expanded && isExpandable
  const startTimeRef = useRef(Date.now() - initialElapsed * 1000)
  const [elapsed, setElapsed] = useState(initialElapsed)

  useEffect(() => {
    if (!isRunning) return
    startTimeRef.current = Date.now() - elapsed * 1000
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000))
    }, 1000)
    return () => clearInterval(timer)
  }, [isRunning])

  useEffect(() => {
    if (isComplete && elapsed === 0 && completionElapsed && completionElapsed > 0) {
      setElapsed(Math.round(completionElapsed))
    }
  }, [completionElapsed, elapsed, isComplete])

  const statsContent = (
    <>
      {stats.toolCalls > 0 && (
        <span className="inline-flex items-center gap-0.5">
          <Wrench className="size-3" />
          {stats.toolCalls}
        </span>
      )}
      {stats.totalTokens != null && stats.totalTokens > 0 ? (
        <>
          {stats.toolCalls > 0 && <span>·</span>}
          <span className="tabular-nums">{formatTokens(stats.totalTokens)}</span>
        </>
      ) : (
        <>
          {(stats.inputTokens ?? 0) > 0 || (stats.outputTokens ?? 0) > 0
            ? stats.toolCalls > 0 && <span>·</span>
            : null}
          <SubagentTokens
            input={stats.inputTokens ?? 0}
            output={stats.outputTokens ?? 0}
            formatTokens={formatTokens}
          />
        </>
      )}
    </>
  )

  return (
    <div className="subagent-container my-1 overflow-hidden rounded border border-border/50 bg-muted/20">
      <button
        type="button"
        aria-disabled={!isExpandable}
        onClick={() => {
          if (isExpandable) onExpandedChange(!expanded)
        }}
        className={cn(
          'flex w-full items-center gap-2 px-2.5 py-2 text-xs transition-colors',
          isExpandable ? 'hover:bg-muted/40' : 'cursor-default',
        )}
      >
        <Bot className={cn(
          'size-3.5 shrink-0',
          isFailed
            ? 'text-amber-600 dark:text-amber-400'
            : isStopped
              ? 'text-muted-foreground'
              : colors.text,
          isRunning && !isExpanded && 'animate-pulse',
        )} />
        {taskInput.name && taskInput.teamName ? (
          <span className={cn('shrink-0 rounded px-1 py-px text-xs font-medium', colors.tagBg, colors.tagText)}>
            {taskInput.name}@{taskInput.teamName}
          </span>
        ) : taskInput.name ? (
          <>
            <span className={cn('shrink-0 rounded px-1 py-px text-xs font-medium', colors.tagBg, colors.tagText)}>
              {taskInput.name}
            </span>
            {taskInput.subagentType && taskInput.subagentType !== taskInput.name && (
              <span className="shrink-0 text-xs text-muted-foreground">{taskInput.subagentType}</span>
            )}
          </>
        ) : taskInput.subagentType ? (
          <span className={cn('shrink-0 rounded px-1 py-px text-xs', colors.tagBg, colors.tagText)}>
            {taskInput.subagentType}
          </span>
        ) : null}
        {taskInput.description && (
          <span className="min-w-0 truncate text-left text-muted-foreground">{taskInput.description}</span>
        )}
        {showSpawningPlaceholder && (
          <span className="min-w-0 text-left text-muted-foreground">{t('chat.subagent.spawning')}</span>
        )}
        {isRunning && retryBadge}
        {isExpandable && (
          <span className="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
            {!isExpanded && isFailed && (
              <span className="inline-flex items-center gap-0.5 text-amber-600 dark:text-amber-400">
                <TriangleAlert className="size-3" />{t('chat.subagent.failed')}
              </span>
            )}
            {!isExpanded && isStopped && (
              <span className="inline-flex items-center gap-0.5">
                <CircleSlash className="size-3" />{t('chat.subagent.stopped')}
              </span>
            )}
            {!isExpanded && statsContent}
            {isExpanded && canOpenFullView && (
              <span
                role="button"
                tabIndex={0}
                onClick={(event) => {
                  event.stopPropagation()
                  onOpenFullView()
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.stopPropagation()
                    onOpenFullView()
                  }
                }}
                className="inline-flex items-center rounded p-0.5 hover:bg-muted hover:text-foreground"
                title={t('chat.subagent.openFullView', 'Open full view')}
                data-tool-use-id={toolUseId}
              >
                <Maximize className="size-3" />
              </span>
            )}
            {trailingAction}
            <ChevronRight className={cn('size-3 shrink-0 transition-transform duration-200', isExpanded && 'rotate-90')} />
          </span>
        )}
      </button>

      {isExpanded && (
        <div className="border-t border-border/30">
          {taskInput.prompt && <PromptPreview prompt={taskInput.prompt} model={taskInput.model} />}
          {activityContent}
          {childContent}
          {isFailed && diagnostic && (
            <div className="border-t border-border/30 px-2.5 py-1.5">
              <div className="mb-0.5 flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                <TriangleAlert className="size-3 shrink-0" />
                <span>{t('chat.subagent.diagnostic')}</span>
              </div>
              <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">{diagnostic}</p>
            </div>
          )}
          {resultText && !(isAsync && isRunning) && <OutputPreview text={resultText} Markdown={Markdown} />}
        </div>
      )}

      {isExpanded && (isRunning || isComplete) && (
        <div className="flex items-center gap-1.5 border-t border-border/30 px-2.5 py-1.5 text-xs text-muted-foreground">
          {isRunning ? (
            <>
              <span>{isAsync ? t('chat.subagent.runningInBackground') : t('chat.subagent.running')}</span>
              {elapsed > 0 && <span className="tabular-nums">{formatElapsed(elapsed)}</span>}
            </>
          ) : isFailed ? (
            <>
              <TriangleAlert className="size-3 shrink-0 text-amber-600 dark:text-amber-400" />
              <span className="text-amber-600 dark:text-amber-400">
                {t('chat.subagent.failed')}{elapsed > 0 ? ` ${formatElapsed(elapsed)}` : ''}
              </span>
            </>
          ) : isStopped ? (
            <>
              <CircleSlash className="size-3 shrink-0 text-muted-foreground" />
              <span>{t('chat.subagent.stopped')}{elapsed > 0 ? ` ${formatElapsed(elapsed)}` : ''}</span>
            </>
          ) : (
            <>
              <Check className="size-3 shrink-0 text-success" />
              <span>{t('chat.subagent.done')}{elapsed > 0 ? ` ${formatElapsed(elapsed)}` : ''}</span>
            </>
          )}
          <span className="ml-auto flex items-center gap-1.5">{statsContent}</span>
        </div>
      )}
    </div>
  )
}
