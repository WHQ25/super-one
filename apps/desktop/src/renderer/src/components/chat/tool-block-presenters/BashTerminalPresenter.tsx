import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import { Ban, ChevronRight, TriangleAlert } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import { TerminalCommandOutput } from '../presenters/TerminalCommandOutput'
import { extractToolError } from '../presenters/tool-block-utils'
import { ToolIcon } from '../ToolIcon'
import { ToolName } from '../tool-row'

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
  readOutputFile: (path: string, lines: number) => Promise<string>
  readOutputMore: (toolUseId: string, lines: number) => Promise<string>
  renderAnsiText: (text: string) => ReactNode
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
  readOutputFile,
  readOutputMore,
  renderAnsiText,
}: BashTerminalPresenterProps) {
  const { t } = useTranslation()
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
  const autoExpanded = allowExpand && holdOpenForBackgroundTask
  const [expanded, setExpanded] = useState(allowExpand && autoExpand ? autoExpanded : false)
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

  useEffect(() => {
    if (!expanded) setOutputFull(false)
  }, [expanded])

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
    if (isLive || !expanded || !hasMore || !outputPath) return
    const element = scrollRef.current
    const sentinel = sentinelRef.current
    if (!element || !sentinel) return
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) void loadMore() },
      { root: outputFull ? null : element, threshold: 0.1 },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [expanded, hasMore, isLive, loadMore, outputFull, outputPath])

  return (
    <div className={cn(
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
          : (!expanded || fileExpired) && <span className="min-w-0 truncate text-muted-foreground">{command}</span>}
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
      {allowExpand && expanded && (fileExpired ? (
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
          ) : null}
        </TerminalCommandOutput>
      ))}
    </div>
  )
}
