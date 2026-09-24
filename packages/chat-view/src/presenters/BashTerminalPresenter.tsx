import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import { Ban, ChevronRight, FileDiff, TriangleAlert } from 'lucide-react'
import type { BashEditDiff } from '@superone/shared/agent-types'
import { bashEditToolUses, summarizeBashEditDiff, type BashEditToolUse } from '@superone/shared/bash-edit-diff'
import { cn } from '@superone/ui/lib/utils'
import { TerminalCommandOutput } from './TerminalCommandOutput'
import { extractToolError } from './tool-block-utils'
import { ToolIcon } from './ToolIcon'
import { ToolName } from './ToolRow'

const BASH_LOAD_CHUNK = 50

export interface BashOutputSnapshot {
  content: string
  finished: boolean
  outputPath?: string
}

export interface BashTaskSnapshot {
  completed?: boolean
  status?: 'completed' | 'failed' | 'stopped'
}

export interface BashTerminalPresenterProps {
  toolUseId: string
  command: string
  description?: string
  fallbackResult?: string
  isStreaming: boolean
  isDenied?: boolean
  isError?: boolean
  timeoutMs?: number
  isTimedOut?: boolean
  resultOutputPath?: string
  runInBackground?: boolean
  autoExpand?: boolean
  allowExpand?: boolean
  backgroundActivity?: boolean
  trailingAction?: ReactNode
  bashOutput?: BashOutputSnapshot
  taskProgress?: BashTaskSnapshot
  isPendingPermission?: boolean
  onExpandedChange?: (expanded: boolean) => void
  detailStatus?: string
  onDetailRetry?: () => void
  readOutputFile: (path: string, lines: number) => Promise<string>
  readOutputMore: (toolUseId: string, lines: number) => Promise<string>
  renderAnsiText: (text: string) => ReactNode
  /**
   * Working-tree diff the command produced. Collapsed, the header carries the
   * file / line totals; expanded, the output folds behind its own toggle and each
   * file draws as the Edit / Write / Delete row `renderFileTool` returns.
   */
  bashEditDiff?: BashEditDiff
  renderFileTool?: (row: BashEditToolUse) => ReactNode
}

/** Footnote for what the diff could not show; null when every file is on screen. */
function bashEditDiffNote(
  diff: BashEditDiff,
  rowCount: number,
  t: (key: string, options?: Record<string, unknown>) => string,
): string | null {
  const hidden = Math.max(0, diff.files.length + diff.moreFiles - rowCount)
  const parts: string[] = []
  if (hidden > 0) parts.push(t('chat.toolBlock.moreFilesChanged', { count: hidden }))
  if (diff.unavailable) parts.push(t('chat.toolBlock.editDiffUnavailable'))
  return parts.length > 0 ? parts.join(' · ') : null
}

export function BashTerminalPresenter({
  toolUseId,
  command,
  description,
  fallbackResult,
  isStreaming,
  isDenied,
  isError,
  timeoutMs,
  isTimedOut,
  resultOutputPath,
  runInBackground,
  autoExpand,
  allowExpand = true,
  backgroundActivity,
  trailingAction,
  bashOutput,
  taskProgress,
  isPendingPermission,
  onExpandedChange,
  detailStatus,
  onDetailRetry,
  readOutputFile,
  readOutputMore,
  renderAnsiText,
  bashEditDiff,
  renderFileTool,
}: BashTerminalPresenterProps) {
  const { t } = useTranslation()
  const editRows = useMemo(
    () => (bashEditDiff ? bashEditToolUses(toolUseId, bashEditDiff) : []),
    [bashEditDiff, toolUseId],
  )
  const editSummary = useMemo(() => (bashEditDiff ? summarizeBashEditDiff(bashEditDiff) : null), [bashEditDiff])
  const editNote = bashEditDiff ? bashEditDiffNote(bashEditDiff, editRows.length, t) : null
  // A git state command's deliberate skip has no files to list: plain Bash layout.
  const hasEdits = !!bashEditDiff && !!renderFileTool && !!editSummary && editSummary.files > 0
  const outputExpired = !!resultOutputPath && !bashOutput && !isStreaming
  const scrollRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const isLiveRunning = !!bashOutput && !bashOutput.finished
  const hasResult = !!fallbackResult || isDenied
  const isRunning = (isStreaming && !hasResult && !isPendingPermission) || isLiveRunning
  const hasTaskState = !!taskProgress
  const backgroundFailed = taskProgress?.status === 'failed'
  const backgroundStopped = !!taskProgress?.status
    && taskProgress.status !== 'completed'
    && !backgroundFailed
  const showError = (isError || backgroundFailed) && !isDenied
  const treatAsBackground = backgroundActivity || runInBackground
  const holdOpenForBackgroundTask = treatAsBackground
    ? (hasTaskState ? taskProgress.completed !== true : isRunning)
    : false
  // An edit block opens on the file-diff setting (`autoExpand` carries it); a
  // plain command only holds itself open while a background task runs.
  const autoExpanded = allowExpand && (holdOpenForBackgroundTask || (autoExpand === true && hasEdits))
  const [expanded, setExpanded] = useState(allowExpand && autoExpand ? autoExpanded : false)
  // Behind the file rows the output is a second toggle, shut unless the command
  // itself went wrong — a half-applied sed is what the user needs to see first.
  const outputWentWrong = isError || isDenied || isTimedOut === true
  const [outputOpen, setOutputOpen] = useState(outputWentWrong)
  useEffect(() => { if (outputWentWrong) setOutputOpen(true) }, [outputWentWrong])
  const outputVisible = expanded && (!hasEdits || outputOpen)
  const [outputFull, setOutputFull] = useState(false)
  const [extraContent, setExtraContent] = useState('')
  const [loadedLines, setLoadedLines] = useState(BASH_LOAD_CHUNK)
  const [hasMore, setHasMore] = useState(true)
  const loadingRef = useRef(false)
  const prevExtraRef = useRef('')
  const prevScrollHeightRef = useRef(0)
  const [restoredContent, setRestoredContent] = useState<string | null>(outputExpired ? null : '')
  const restoredRef = useRef(false)

  useEffect(() => {
    if (!allowExpand) {
      setExpanded(false)
      return
    }
    setExpanded(autoExpand ? autoExpanded : false)
  }, [allowExpand, autoExpand, autoExpanded])

  useEffect(() => { onExpandedChange?.(expanded) }, [expanded, onExpandedChange])

  useEffect(() => {
    if (!outputVisible) setOutputFull(false)
  }, [outputVisible])

  useEffect(() => {
    if (!outputExpired || !resultOutputPath || restoredRef.current) return
    restoredRef.current = true
    void readOutputFile(resultOutputPath, BASH_LOAD_CHUNK).then((content) => {
      setRestoredContent(content || '')
    })
  }, [outputExpired, readOutputFile, resultOutputPath])

  const liveContent = outputExpired
    ? (restoredContent || '')
    : (bashOutput?.content || fallbackResult || '')
  const liveContentRef = useRef(liveContent)
  liveContentRef.current = liveContent
  const outputPath = bashOutput?.outputPath || (restoredContent ? resultOutputPath : undefined)
  const isLive = isLiveRunning
  const timerActive = isRunning
  const content = extraContent ? `${extraContent}\n${liveContent}` : liveContent
  const fileExpired = outputExpired && restoredContent === ''

  const [localElapsed, setLocalElapsed] = useState(0)
  const startTimeRef = useRef(0)
  useEffect(() => {
    if (!timerActive) {
      startTimeRef.current = 0
      setLocalElapsed(0)
      return
    }
    if (!startTimeRef.current) startTimeRef.current = Date.now()
    const tick = (): void => setLocalElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000))
    tick()
    const intervalId = setInterval(tick, 1000)
    return () => clearInterval(intervalId)
  }, [timerActive])

  useEffect(() => {
    if (isLive && !outputFull && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [liveContent, isLive, outputFull])

  useLayoutEffect(() => {
    if (extraContent && extraContent !== prevExtraRef.current) {
      const element = scrollRef.current
      if (element && !outputFull) element.scrollTop = element.scrollHeight - prevScrollHeightRef.current
      prevExtraRef.current = extraContent
    }
  }, [extraContent, outputFull])

  const loadMore = useCallback(async () => {
    if (!outputPath || isLive || loadingRef.current || !hasMore) return
    loadingRef.current = true
    prevScrollHeightRef.current = scrollRef.current?.scrollHeight ?? 0
    const nextLines = loadedLines + BASH_LOAD_CHUNK
    const loaded = outputExpired
      ? await readOutputFile(outputPath, nextLines)
      : await readOutputMore(toolUseId, nextLines)
    const resultLineCount = loaded.split('\n').length
    if (resultLineCount <= loadedLines) {
      setHasMore(false)
    } else {
      const currentTail = liveContentRef.current
      const prefix = loaded.split('\n').slice(0, -currentTail.split('\n').length)
      setExtraContent(prefix.join('\n'))
      setLoadedLines(nextLines)
    }
    loadingRef.current = false
  }, [hasMore, isLive, loadedLines, outputExpired, outputPath, readOutputFile, readOutputMore, toolUseId])

  useEffect(() => {
    if (isLive || !outputVisible || !hasMore || !outputPath) return
    const element = scrollRef.current
    const sentinel = sentinelRef.current
    if (!element || !sentinel) return
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) void loadMore() },
      { root: outputFull ? null : element, threshold: 0.1 },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [outputVisible, hasMore, isLive, loadMore, outputFull, outputPath])

  const outputPanel = fileExpired ? (
    <div className="px-3 py-1.5 text-xs text-muted-foreground/50 italic">
      {t('chat.toolBlock.outputFileExpired', { path: resultOutputPath!.split('/').pop() })}
    </div>
  ) : (
    <TerminalCommandOutput
      command={command}
      hasOutput={!!content}
      outputRef={scrollRef}
      outputVersion={content}
      outputFull={outputFull}
      onOutputFullChange={setOutputFull}
      outputPrefix={!isLive && hasMore && outputPath ? <div ref={sentinelRef} className="h-px" /> : undefined}
    >
      {outputExpired && restoredContent === null ? (
        <div className="animate-shimmer text-terminal-dim">{t('common.loading')}</div>
      ) : detailStatus && !content ? (
        <div className="text-terminal-dim" role="status">
          {detailStatus}
          {onDetailRetry && (
            <button
              type="button"
              className="ml-2 underline"
              onClick={(event) => { event.stopPropagation(); onDetailRetry() }}
            >
              {t('common.retry')}
            </button>
          )}
        </div>
      ) : content ? (
        <div className={showError ? 'text-amber-300' : 'text-terminal-muted'}>
          {renderAnsiText(showError ? extractToolError(content) : content)}
        </div>
      ) : isStreaming ? (
        <div className="text-terminal-muted">
          <span className="animate-shimmer">{t('chat.toolBlock.runningInline')}</span>
          {localElapsed >= 1 && (
            <span className="text-terminal-dim">
              {' '}{localElapsed}s{timeoutMs && !isLive ? ` · timeout ${Math.round(timeoutMs / 1000)}s` : ''}
            </span>
          )}
        </div>
      ) : hasEdits ? (
        <div className="text-terminal-dim">{t('chat.toolBlock.noOutput')}</div>
      ) : null}
    </TerminalCommandOutput>
  )

  return (
    <div data-tool-use-id={toolUseId || undefined} className={cn(
      'tool-node my-0.5 rounded transition-colors',
      allowExpand && 'cursor-pointer',
      isDenied
        ? `denied bg-error/10${allowExpand ? ' hover:bg-error/20' : ''}`
        : showError
          ? `errored bg-warning/10${allowExpand ? ' hover:bg-warning/20' : ''}`
          : `bg-muted/20${allowExpand ? ' hover:bg-muted/40' : ''}`,
      expanded && 'overflow-hidden',
    )}>
      <div
        className="flex items-center gap-1.5 px-2 py-1.5 text-xs"
        onClick={allowExpand ? () => setExpanded((value) => !value) : undefined}
      >
        {isDenied ? (
          <Ban className="size-3 shrink-0 text-error" />
        ) : showError ? (
          <TriangleAlert className="size-3 shrink-0 text-warning" />
        ) : (
          <ToolIcon icon="terminal" className="size-3 shrink-0 text-muted-foreground" />
        )}
        <ToolName streaming={isRunning && !isDenied} tone={isDenied ? 'denied' : showError ? 'error' : 'default'}>
          {isRunning && !isDenied ? t('chat.toolBlock.running') : 'Bash'}
        </ToolName>
        {isRunning && localElapsed >= 1 && (
          <span className="text-muted-foreground tabular-nums">{localElapsed}s</span>
        )}
        {description
          ? <span className="min-w-0 truncate text-muted-foreground">{description}</span>
          : (!expanded || fileExpired || hasEdits) && <span className="min-w-0 truncate text-muted-foreground">{command}</span>}
        {hasEdits && editSummary && !expanded && (
          <span className="flex shrink-0 items-center gap-1.5 text-xs tabular-nums">
            {editSummary.files > 1 && (
              <span
                className="inline-flex items-center gap-0.5 text-muted-foreground"
                title={t('chat.compactMode.filesChanged', { count: editSummary.files })}
              >
                <FileDiff className="size-3" />
                {editSummary.files}
              </span>
            )}
            {(editSummary.added > 0 || editSummary.removed > 0) && (
              <span>
                {editSummary.approximate && <span className="text-muted-foreground">≈</span>}
                {editSummary.added > 0 && <span className="text-success">+{editSummary.added}</span>}
                {editSummary.added > 0 && editSummary.removed > 0 && ' '}
                {editSummary.removed > 0 && <span className="text-error">-{editSummary.removed}</span>}
              </span>
            )}
          </span>
        )}
        {timeoutMs && (
          <span className="rounded bg-muted px-1 py-px text-xs text-muted-foreground">
            {Math.round(timeoutMs / 1000)}s
          </span>
        )}
        {isDenied && <span className="rounded bg-error/20 px-1 py-px text-xs text-error">Denied</span>}
        {showError && (
          <span className="rounded bg-warning/20 px-1 py-px text-xs text-warning">
            {t('chat.toolBlock.error')}
          </span>
        )}
        {backgroundStopped && !showError && (
          <span className="rounded bg-muted px-1 py-px text-xs text-muted-foreground">
            {t('chat.subagent.stopped')}
          </span>
        )}
        {isTimedOut && (
          <span className="rounded bg-error/20 px-1 py-px text-xs text-error">
            {t('chat.toolBlock.timedOut')}
          </span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {trailingAction}
          {allowExpand && (
            <ChevronRight className={cn(
              'size-3 shrink-0 text-muted-foreground transition-transform duration-200',
              expanded && 'rotate-90',
            )} />
          )}
        </div>
      </div>
      {allowExpand && expanded && (hasEdits ? (
        <div className="cursor-default space-y-0.5 border-t border-border/30 px-1.5 py-1">
          <div
            className="flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted/40"
            onClick={() => setOutputOpen((value) => !value)}
          >
            <ChevronRight className={cn('size-3 shrink-0 transition-transform duration-200', outputOpen && 'rotate-90')} />
            <span>{t('chat.toolBlock.terminalPanel')}</span>
          </div>
          {outputOpen && outputPanel}
          {editRows.map((row) => <div key={row.toolUseId}>{renderFileTool!(row)}</div>)}
          {editNote && <div className="px-2 py-0.5 text-xs text-muted-foreground/70">{editNote}</div>}
        </div>
      ) : outputPanel)}
    </div>
  )
}
