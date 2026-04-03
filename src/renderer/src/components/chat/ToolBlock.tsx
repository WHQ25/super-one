import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback, memo } from 'react'
import { ChevronRight, PenLine, Check, X, Ban } from 'lucide-react'
import { diffLines } from 'diff'
import { cn } from '@/lib/utils'
import { inferLanguage, useHighlightedTokens, type DiffLine, DiffView, splitContentLines, buildUnifiedFileChangeDiffLines } from '@/lib/diff-utils'
import { useChatStore, useActiveSession, useBashOutput } from '@/stores/chat'
import { openFileTab } from '@/components/activity/activity-panel-api'
import { useSettingsStore } from '@/stores/settings'
import { useSourceControlStore } from '@/stores/source-control'
import { ToolIcon } from './ToolIcon'
import { FileIcon } from '@/components/ui/FileIcon'
import { HighlightedCodeBlock } from './CodeBlock'
import { getToolDisplay, getToolVerb, parseToolInput, parseMcpToolName, formatReadMeta } from './tool-display'
import { codePlugin } from './chat-shared'
import { useStallLevel, getStallColor, type StallLevel } from '@/lib/stall-utils'
import { AnsiText } from '@/lib/ansi'
import { countUnifiedDiffDelta, countPrefixedDiffDelta, computeLineDelta, tryPrettifyJson, parseQAPairs } from './tool-block-utils'
import { WidgetBlock } from './WidgetBlock'
import { parseWidgetResult, parsePartialWidgetInput } from '../../../../shared/generative-ui/types'

function isCompleteJson(s: string): boolean {
  try { JSON.parse(s); return true } catch { return false }
}

/** Dev-only: comma-separated tool names to show raw debug UI. e.g. RENDERER_VITE_DEBUG_TOOL_NAMES=TodoWrite,TaskCreate */
const DEBUG_TOOL_NAMES: string[] = import.meta.env.DEV
  ? (import.meta.env.RENDERER_VITE_DEBUG_TOOL_NAMES ?? '').split(',').map((s: string) => s.trim().toLowerCase()).filter(Boolean)
  : []

interface ToolBlockProps {
  toolName: string
  toolUseId?: string
  input: string
  status?: 'streaming' | 'complete'
  elapsedSeconds?: number
  result?: string
  isTimedOut?: boolean
  resultOutputPath?: string
  autoExpand?: boolean
  backgroundActivity?: boolean
}

const DIFF_TOOLS = new Set(['Edit', 'Write', 'FileChange'])
const FILE_PATH_TOOLS = new Set(['Read', 'Edit', 'Write', 'NotebookEdit', 'FileChange'])



export const ToolBlock = memo(function ToolBlock({ toolName, toolUseId, input, status, elapsedSeconds, result, isTimedOut, resultOutputPath, autoExpand = true, backgroundActivity = false }: ToolBlockProps) {
  const cwd = useActiveSession((s) => s.cwd)
  const homedir = useActiveSession((s) => s.homedir)
  const params = useMemo(() => parseToolInput(input, toolName), [input, toolName])
  const display = useMemo(() => getToolDisplay(toolName, params, cwd, homedir), [toolName, params, cwd, homedir])
  const mcpInfo = parseMcpToolName(toolName)
  const isMcp = mcpInfo !== null
  const mcpMeta = useSettingsStore((s) => s.mcpMeta)
  const mcpLibrary = useSettingsStore((s) => s.mcpLibrary)
  const mcpIconSrc = isMcp
    ? (mcpMeta[mcpInfo.serverName]?.icons?.[0]?.src
      ?? mcpLibrary.find((e) => e.name === mcpInfo.serverName)?.icons?.[0]?.src)
    : undefined
  const isStreaming = status === 'streaming'
  const stallLevel = useStallLevel(isStreaming)
  const fileToolPath = FILE_PATH_TOOLS.has(toolName) ? String(params.file_path ?? params.notebook_path ?? '') : ''
  const fileToolName = fileToolPath ? fileToolPath.split('/').pop() || '' : ''

  // Debug mode (dev only): highest priority — show raw input/output for matching tools
  // Set RENDERER_VITE_DEBUG_TOOL_NAMES=TodoWrite,TaskCreate to enable
  const isDebug = DEBUG_TOOL_NAMES.length > 0 &&
    DEBUG_TOOL_NAMES.some((n) => toolName.toLowerCase().includes(n))
  if (isDebug) {
    return <DebugToolBlock toolName={toolName} input={input} result={result} status={status} elapsedSeconds={elapsedSeconds} />
  }

  if (toolName === 'TodoWrite') return null

  const isDenied = !!result && result.startsWith('[denied] ')
  const isQuestionDismissed = toolName === 'AskUserQuestion' && !!result && (isDenied || result.includes('dismissed'))

  if (toolName === 'Bash') {
    const timeout = typeof params.timeout === 'number' ? params.timeout : undefined
    const runInBackground = params.run_in_background === true || params.background === true
    const description = typeof params.description === 'string' ? params.description : undefined
    return (
      <BashTerminalView
        toolUseId={toolUseId ?? ''}
        command={display.summary}
        description={description}
        fallbackResult={isDenied ? undefined : (result ?? undefined)}
        isStreaming={isStreaming}
        isDenied={isDenied}
        elapsedSeconds={elapsedSeconds}
        stallLevel={stallLevel}
        timeoutMs={timeout}
        isTimedOut={isTimedOut}
        resultOutputPath={resultOutputPath}
        runInBackground={runInBackground}
        autoExpand={autoExpand}
        backgroundActivity={backgroundActivity}
      />
    )
  }

  if (toolName === 'EnterPlanMode') {
    return (
      <div className="my-4 flex items-center gap-1.5 rounded bg-blue-500/10 px-2 py-1.5 text-sm">
        <PenLine className="size-3 shrink-0 text-blue-400" />
        <span className="font-medium text-blue-400">Entered plan mode</span>
      </div>
    )
  }
  if (toolName === 'ExitPlanMode') {
    return <ExitPlanModeBlock result={result} />
  }
  const cleanResult = isDenied ? result.slice('[denied] '.length) : result
  const deniedFeedback = isDenied && cleanResult !== 'User denied permission' ? cleanResult! : ''
  const feedbackRef = useRef<HTMLSpanElement>(null)
  const [feedbackIsBlock, setFeedbackIsBlock] = useState(false)

  useLayoutEffect(() => {
    if (!deniedFeedback) { setFeedbackIsBlock(false); return }
    const el = feedbackRef.current
    if (!el) return
    setFeedbackIsBlock(el.scrollWidth > el.clientWidth)
  }, [deniedFeedback])

  const lineDelta = useMemo(() => (!isStreaming && !isDenied) ? computeLineDelta(toolName, params) : null, [toolName, params, isStreaming, isDenied])
  const hasDiff = DIFF_TOOLS.has(toolName) && !isStreaming && !isDenied && (
    toolName === 'FileChange'
      ? String(params.diff ?? '').length > 0
      : Object.keys(params).length > 0
  )
  const hasResult = !!cleanResult && !isStreaming && !isDenied && toolName !== 'Read' && toolName !== 'Skill' && toolName !== 'AskUserQuestion'
  const hasQA = toolName === 'AskUserQuestion' && !!cleanResult && !isStreaming && !isQuestionDismissed
  const expandable = hasDiff || hasResult || hasQA
  const [expanded, setExpanded] = useState(false)
  const gridRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (DIFF_TOOLS.has(toolName) && hasDiff && !isStreaming) {
      setExpanded(true)
      const grid = gridRef.current
      if (grid) {
        grid.style.transition = 'none'
        requestAnimationFrame(() => { grid.style.transition = '' })
      }
    }
  }, [isStreaming, hasDiff, toolName])

  // For unknown tools, show truncated raw input as fallback
  const summary = display.summary || (!isMcp && display.icon === 'wrench' && input.length > 0
    ? (input.length > 80 ? input.slice(0, 80) + '\u2026' : input)
    : '')

  const displayName = mcpInfo
    ? <>{mcpInfo.serverName}<span className="text-muted-foreground"> · </span>{mcpInfo.mcpToolName}</>
    : toolName

  if (mcpInfo?.mcpToolName === 'read_guidelines') {
    return (
      <div className="tool-node my-0.5 rounded bg-muted/50">
        <div className="flex items-center gap-1.5 px-2 py-1.5 text-xs">
          <ToolIcon icon="book-open" className="size-3 shrink-0 text-muted-foreground" />
          <span className="font-medium text-foreground">
            {isStreaming ? <>Reading widget guidelines…</> : 'Read widget guidelines'}
          </span>
        </div>
      </div>
    )
  }

  if (mcpInfo?.mcpToolName === 'show_widget') {
    const widgetData = result ? parseWidgetResult(result) : parsePartialWidgetInput(input)
    const jsonComplete = isCompleteJson(input)
    const inputComplete = !isStreaming || jsonComplete
    if (isStreaming && jsonComplete && widgetData) {
      window.app.trace?.('widget.ui', 'input_complete_early', { title: widgetData.title, inputLen: input.length })
    }
    if (widgetData) return <WidgetBlock data={widgetData} streaming={!inputComplete} />
    return (
      <div className="tool-node my-0.5 rounded bg-muted/50">
        <div className="flex items-center gap-1.5 px-2 py-1.5 text-xs">
          <ToolIcon icon="canvas" className="size-3 shrink-0 text-muted-foreground" />
          <span className="font-medium text-foreground">
            {isStreaming ? <>Generating widget…</> : 'Generate widget'}
          </span>
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'tool-node my-0.5 rounded transition-colors',
        isDenied ? 'denied bg-red-500/10' : 'bg-muted/50',
        expandable && 'cursor-pointer hover:bg-muted/70'
      )}
    >
      <div
        className="flex items-center gap-1.5 px-2 py-1.5 text-xs"
        onClick={expandable ? () => setExpanded((e) => !e) : undefined}
      >
        {isDenied ? (
          <Ban className="size-3 shrink-0 text-red-400" />
        ) : isMcp && mcpIconSrc ? (
          <img src={mcpIconSrc} alt={mcpInfo.serverName} className="size-3.5 shrink-0 rounded-sm object-cover" />
        ) : (
          <ToolIcon icon={display.icon} className="size-3 shrink-0 text-muted-foreground" />
        )}
        <span className={cn('font-medium', isDenied && toolName !== 'AskUserQuestion' ? 'text-red-400' : 'text-foreground')}>
          {isStreaming ? <>{getToolVerb(toolName)}…</> : toolName === 'AskUserQuestion' ? `Asked${display.summary ? ` ${display.summary}` : ''}` : displayName}
        </span>
        {isQuestionDismissed ? (
          <span className="shrink-0 rounded bg-muted px-1 py-px text-[10px] text-muted-foreground">Dismissed</span>
        ) : isDenied ? (
          <>
            {fileToolName ? (
              <FileChip name={fileToolName} title={display.summary} filePath={fileToolPath} />
            ) : summary ? (
              <span className="min-w-0 truncate text-muted-foreground">{summary}</span>
            ) : null}
            <span className="shrink-0 rounded bg-red-500/20 px-1 py-px text-[10px] text-red-400">Denied</span>
            {deniedFeedback && !feedbackIsBlock && (
              <span ref={feedbackRef} className="min-w-0 truncate text-red-400/70">{deniedFeedback}</span>
            )}
          </>
        ) : fileToolName ? (
          <>
            <FileChip name={fileToolName} title={display.summary} filePath={fileToolPath} />
            {toolName === 'FileChange' && params.kind && (
              <span className="text-muted-foreground">{String(params.kind)}</span>
            )}
            {toolName === 'Read' && formatReadMeta(params) && (
              <span className="text-muted-foreground">{formatReadMeta(params)}</span>
            )}
          </>
        ) : summary ? (
          <span className="min-w-0 truncate text-muted-foreground">{summary}</span>
        ) : null}
        {lineDelta && (
          <span className="shrink-0 font-mono text-[11px]">
            {lineDelta.added > 0 && <span className="text-green-400">+{lineDelta.added}</span>}
            {lineDelta.added > 0 && lineDelta.removed > 0 && <span className="text-muted-foreground/50"> </span>}
            {lineDelta.removed > 0 && <span className="text-red-400">-{lineDelta.removed}</span>}
          </span>
        )}
        {isStreaming && elapsedSeconds != null && elapsedSeconds >= 1 && (
          <span className={cn('ml-auto shrink-0 transition-colors duration-500', getStallColor(stallLevel))}>{Math.round(elapsedSeconds)}s</span>
        )}
        {expandable && (
          <ChevronRight
            className={cn('ml-auto size-3 shrink-0 text-muted-foreground transition-transform duration-200', expanded && 'rotate-90')}
          />
        )}
      </div>

      {deniedFeedback && feedbackIsBlock && (
        <div className="px-2 pb-1.5 text-xs text-red-400/70">{deniedFeedback}</div>
      )}

      {expandable && (
        <div
          ref={gridRef}
          className="grid transition-[grid-template-rows] duration-200 ease-out"
          style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
        >
          <div className="overflow-hidden">
            <div className="px-2 pb-1.5">
              {toolName === 'Edit' && <EditDiff params={params} />}
              {toolName === 'Write' && <WriteDiff params={params} />}
              {toolName === 'FileChange' && <FileChangeDiff params={params} />}
              {hasResult && (!hasDiff || toolName === 'FileChange') && (
                <div>
                  {isMcp ? <PrettyJSONCodeBlock text={cleanResult!} /> : <ToolResult text={cleanResult!} />}
                </div>
              )}
              {hasQA && <QAResult text={cleanResult!} />}
            </div>
          </div>
        </div>
      )}
    </div>
  )
})

export function FileChip({ name, title, filePath, lineNumber, className }: { name: string; title: string; filePath?: string; lineNumber?: number; className?: string }) {
  const handleClick = (e: React.MouseEvent): void => {
    e.stopPropagation()
    if (!filePath) return
    const projectPath = useChatStore.getState().activeProject
    if (!projectPath) return
    const relative = filePath.startsWith(projectPath + '/') ? filePath.slice(projectPath.length + 1) : filePath
    useSourceControlStore.getState().selectFile(projectPath, relative, lineNumber)
    openFileTab(relative)
  }
  return (
    <span
      role="button"
      onClick={handleClick}
      title={title}
      className="inline-flex min-w-0 cursor-pointer items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-foreground hover:bg-muted/80 transition-colors"
    >
      <FileIcon name={name} size={12} className="shrink-0" />
      <span className={cn('truncate', className)}>{name}</span>
      {lineNumber != null && <span className="text-muted-foreground text-[10px]">#L{lineNumber}</span>}
    </span>
  )
}

const BASH_LOAD_CHUNK = 50

function BashTerminalView({
  toolUseId,
  command,
  description,
  fallbackResult,
  isStreaming,
  isDenied,
  elapsedSeconds,
  stallLevel,
  timeoutMs,
  isTimedOut,
  resultOutputPath,
  runInBackground,
  autoExpand,
  backgroundActivity,
}: {
  toolUseId: string
  command: string
  description?: string
  fallbackResult?: string
  isStreaming: boolean
  isDenied?: boolean
  elapsedSeconds?: number
  stallLevel?: StallLevel
  timeoutMs?: number
  isTimedOut?: boolean
  resultOutputPath?: string
  runInBackground?: boolean
  autoExpand?: boolean
  backgroundActivity?: boolean
}) {
  const bashOutput = useBashOutput(toolUseId)
  const outputExpired = !!resultOutputPath && !bashOutput && !isStreaming
  const scrollRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const isLiveRunning = !!bashOutput && !bashOutput.finished
  const taskProgress = useActiveSession((s) => s.taskProgress[toolUseId])
  const isPendingPermission = useActiveSession((s) => s.pendingPermissions.some((p) => p.toolUseId === toolUseId))
  const hasResult = !!fallbackResult || isDenied
  const isRunning = (isStreaming && !hasResult && !isPendingPermission) || isLiveRunning
  const hasTaskState = !!taskProgress
  const treatAsBackground = backgroundActivity || runInBackground
  const holdOpenForBackgroundTask = treatAsBackground
    ? (hasTaskState ? taskProgress.completed !== true : isRunning)
    : false
  const autoExpanded = holdOpenForBackgroundTask || isRunning
  const [expanded, setExpanded] = useState(autoExpand ? autoExpanded : false)
  const [extraContent, setExtraContent] = useState('')
  const [loadedLines, setLoadedLines] = useState(BASH_LOAD_CHUNK)
  const [hasMore, setHasMore] = useState(true)
  const loadingRef = useRef(false)
  const prevExtraRef = useRef('')
  const prevScrollHeightRef = useRef(0)
  const [restoredContent, setRestoredContent] = useState<string | null>(outputExpired ? null : '')
  const restoredRef = useRef(false)

  useEffect(() => {
    if (autoExpand) setExpanded(autoExpanded)
    else setExpanded(false)
  }, [autoExpand, autoExpanded])

  useEffect(() => {
    if (!outputExpired || !resultOutputPath || restoredRef.current) return
    restoredRef.current = true
    window.app.readBashOutputFile(resultOutputPath, 50).then((result) => {
      setRestoredContent(result || '')
    })
  }, [outputExpired, resultOutputPath])

  const liveContent = outputExpired
    ? (restoredContent || '')
    : (bashOutput?.content || fallbackResult || '')
  const liveContentRef = useRef(liveContent)
  liveContentRef.current = liveContent
  const outputPath = bashOutput?.outputPath || (restoredContent ? resultOutputPath : undefined)
  const isLive = isLiveRunning
  const timerActive = isRunning
  const content = extraContent ? extraContent + '\n' + liveContent : liveContent
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
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [timerActive])

  useEffect(() => {
    if (isLive && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [liveContent, isLive])

  useLayoutEffect(() => {
    if (extraContent && extraContent !== prevExtraRef.current) {
      const el = scrollRef.current
      if (el) el.scrollTop = el.scrollHeight - prevScrollHeightRef.current
      prevExtraRef.current = extraContent
    }
  }, [extraContent])

  const loadMore = useCallback(async () => {
    if (!outputPath || isLive || loadingRef.current || !hasMore) return
    loadingRef.current = true
    prevScrollHeightRef.current = scrollRef.current?.scrollHeight ?? 0
    const nextLines = loadedLines + BASH_LOAD_CHUNK
    const result = outputExpired
      ? await window.app.readBashOutputFile(outputPath, nextLines)
      : await window.app.readBashOutputMore(toolUseId, nextLines)
    const resultLineCount = result.split('\n').length
    if (resultLineCount <= loadedLines) {
      setHasMore(false)
    } else {
      const lc = liveContentRef.current
      const tail = result.split('\n').slice(0, -lc.split('\n').length)
      setExtraContent(tail.join('\n'))
      setLoadedLines(nextLines)
    }
    loadingRef.current = false
  }, [toolUseId, outputPath, outputExpired, isLive, hasMore, loadedLines])

  useEffect(() => {
    if (isLive || !expanded || !hasMore || !outputPath) return
    const el = scrollRef.current
    const sentinel = sentinelRef.current
    if (!el || !sentinel) return
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) loadMore() },
      { root: el, threshold: 0.1 }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [isLive, expanded, hasMore, outputPath, loadMore])

  return (
    <div className={cn(
      'tool-node my-0.5 rounded transition-colors cursor-pointer hover:bg-muted/70',
      isDenied ? 'denied bg-red-500/10' : 'bg-muted/50',
      expanded && 'overflow-hidden',
    )}>
      <div
        className="flex items-center gap-1.5 px-2 py-1.5 text-xs"
        onClick={() => setExpanded((e) => !e)}
      >
        {isDenied ? (
          <Ban className="size-3 shrink-0 text-red-400" />
        ) : (
          <ToolIcon icon="terminal" className="size-3 shrink-0 text-muted-foreground" />
        )}
        <span className={cn('font-medium', isDenied ? 'text-red-400' : 'text-foreground')}>
          {isStreaming && !expanded ? <>Running…</> : 'Bash'}
        </span>
        {description
          ? <span className="min-w-0 truncate text-muted-foreground">{description}</span>
          : (!expanded || fileExpired) && <span className="min-w-0 truncate text-muted-foreground">{command}</span>
        }
        {isDenied && <span className="rounded bg-red-500/20 px-1 py-px text-[10px] text-red-400">Denied</span>}
        {isTimedOut && <span className="rounded bg-red-500/20 px-1 py-px text-[10px] text-red-400">Timed out</span>}
        <ChevronRight className={cn('ml-auto size-3 shrink-0 text-muted-foreground transition-transform duration-200', expanded && 'rotate-90')} />
      </div>
      {expanded && (fileExpired ? (
        <div className="px-3 py-1.5 text-xs text-muted-foreground/50 italic">
          Output file: {resultOutputPath!.split('/').pop()} expired
        </div>
      ) : (
        <div className="bg-[#0d1117] font-mono text-[12px] leading-relaxed whitespace-pre-wrap">
          {command && (
            <div className="px-3 pt-2 text-[#e6edf3]">
              <span className="text-[#7ee787]">$ </span>{command}
            </div>
          )}
          <div
            ref={scrollRef}
            className="max-h-24 overflow-y-auto overflow-x-auto px-3 py-1.5"
          >
            {!isLive && hasMore && outputPath && <div ref={sentinelRef} className="h-px" />}
            {outputExpired && restoredContent === null ? (
              <div className="animate-shimmer text-[#6e7681]">Loading…</div>
            ) : content ? (
              <div className="text-[#8b949e]"><AnsiText text={content} /></div>
            ) : isStreaming ? (
              <div className="text-[#8b949e]">
                <span className="animate-shimmer">Running…</span>{localElapsed >= 1 && <span className="text-[#6e7681]"> {localElapsed}s{timeoutMs && !isLive ? ` · timeout ${Math.round(timeoutMs / 1000)}s` : ''}</span>}
              </div>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  )
}

const RESULT_PREVIEW_LINES = 10

/** Truncated tool output with secondary expand for long results. */
function ToolResult({ text }: { text: string }) {
  const lines = text.split('\n')
  const isLong = lines.length > RESULT_PREVIEW_LINES
  const [showAll, setShowAll] = useState(false)
  const hiddenCount = lines.length - RESULT_PREVIEW_LINES

  const visibleText = showAll || !isLong ? text : lines.slice(0, RESULT_PREVIEW_LINES).join('\n')

  return (
    <div>
      <div className="overflow-x-auto rounded bg-background/70 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap">
        {visibleText}
      </div>
      {isLong && (
        <button
          onClick={(e) => { e.stopPropagation(); setShowAll((s) => !s) }}
          className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronRight className={cn('size-3 shrink-0 transition-transform duration-200', showAll && 'rotate-90')} />
          {showAll ? 'Collapse' : `${hiddenCount} more line${hiddenCount > 1 ? 's' : ''}`}
        </button>
      )}
    </div>
  )
}

/** Prettified JSON code block with syntax highlighting and truncation. */
function PrettyJSONCodeBlock({ text }: { text: string }) {
  const jsonResult = useMemo(() => tryPrettifyJson(text), [text])
  const prettified = jsonResult ?? text
  const language = jsonResult ? 'json' : 'text'
  const lines = prettified.split('\n')
  const previewLines = 20
  const isLong = lines.length > previewLines
  const [showAll, setShowAll] = useState(false)
  const hiddenCount = lines.length - previewLines
  const visibleText = showAll || !isLong ? prettified : lines.slice(0, previewLines).join('\n')

  return (
    <div className="-mx-2">
      <HighlightedCodeBlock code={visibleText} language={language} codePlugin={codePlugin} />
      {isLong && (
        <button
          onClick={(e) => { e.stopPropagation(); setShowAll((s) => !s) }}
          className="mt-0.5 ml-2 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronRight className={cn('size-3 shrink-0 transition-transform duration-200', showAll && 'rotate-90')} />
          {showAll ? 'Collapse' : `${hiddenCount} more line${hiddenCount > 1 ? 's' : ''}`}
        </button>
      )}
    </div>
  )
}

/** Render AskUserQuestion result as Q&A pairs. */
function QAResult({ text }: { text: string }) {
  const pairs = parseQAPairs(text)
  if (pairs.length === 0) return null

  return (
    <div className="space-y-1">
      {pairs.map((pair, i) => (
        <div key={i} className="rounded bg-background/70 px-2 py-1.5 text-[11px] leading-relaxed">
          <div className="text-muted-foreground">{pair.question}</div>
          <div className="text-green-400">{pair.answer}</div>
        </div>
      ))}
    </div>
  )
}


/** Build unified diff lines with actual file line numbers. */
function buildDiffLines(oldStr: string, newStr: string, startLine: number): DiffLine[] {
  const changes = diffLines(oldStr, newStr)
  const result: DiffLine[] = []
  let oldLine = startLine
  let newLine = startLine
  let oldIdx = 0
  let newIdx = 0

  for (const change of changes) {
    const lines = change.value.replace(/\n$/, '').split('\n')
    if (change.removed) {
      for (const text of lines) {
        result.push({ kind: 'removed', lineNum: oldLine++, text, sourceIdx: oldIdx++ })
      }
    } else if (change.added) {
      for (const text of lines) {
        result.push({ kind: 'added', lineNum: newLine++, text, sourceIdx: newIdx++ })
      }
    } else {
      for (const text of lines) {
        result.push({ kind: 'unchanged', lineNum: newLine, text, sourceIdx: newIdx })
        oldLine++; newLine++; oldIdx++; newIdx++
      }
    }
  }
  return result
}


function buildFileChangeDiffLines(kind: string, diffText: string): DiffLine[] {
  const rows = splitContentLines(diffText)
  if (rows.length === 0) return []

  if (kind === 'add') {
    return rows.map((text, i) => ({ kind: 'added' as const, lineNum: i + 1, text, sourceIdx: i }))
  }
  if (kind === 'delete') {
    return rows.map((text, i) => ({ kind: 'removed' as const, lineNum: i + 1, text, sourceIdx: i }))
  }

  const unified = buildUnifiedFileChangeDiffLines(diffText)
  if (unified.length > 0) return unified

  const result: DiffLine[] = []
  let oldLine = 1
  let newLine = 1
  let oldIdx = 0
  let newIdx = 0

  for (const row of rows) {
    if (row.startsWith('+') && !row.startsWith('+++')) {
      result.push({ kind: 'added', lineNum: newLine++, text: row.slice(1), sourceIdx: newIdx++ })
      continue
    }
    if (row.startsWith('-') && !row.startsWith('---')) {
      result.push({ kind: 'removed', lineNum: oldLine++, text: row.slice(1), sourceIdx: oldIdx++ })
      continue
    }
    const text = row.startsWith(' ') ? row.slice(1) : row
    result.push({ kind: 'unchanged', lineNum: newLine, text, sourceIdx: newIdx })
    oldLine++
    newLine++
    oldIdx++
    newIdx++
  }

  return result
}

function buildDiffSourceText(lines: DiffLine[]): { oldText: string; newText: string } {
  const oldParts: string[] = []
  const newParts: string[] = []

  for (const line of lines) {
    if (line.kind !== 'added') oldParts.push(line.text)
    if (line.kind !== 'removed') newParts.push(line.text)
  }

  return {
    oldText: oldParts.join('\n'),
    newText: newParts.join('\n'),
  }
}


/** Unified diff for Edit tool with actual file line numbers. */
export function EditDiff({ params }: { params: Record<string, unknown> }) {
  const oldStr = String(params.old_string ?? '')
  const newStr = String(params.new_string ?? '')
  const filePath = String(params.file_path ?? '')
  const activeProject = useChatStore((s) => s.activeProject)
  const [startLine, setStartLine] = useState(1)
  const language = inferLanguage(filePath)
  const oldTokens = useHighlightedTokens(oldStr, language)
  const newTokens = useHighlightedTokens(newStr, language)

  useEffect(() => {
    if (!filePath || !activeProject) return
    let cancelled = false
    const tryFind = async (): Promise<void> => {
      // Try new_string first (file already edited)
      if (newStr) {
        const line = await window.agent.findLineNumber(activeProject, filePath, newStr)
        if (!cancelled && line != null) { setStartLine(line); return }
      }
      // Fallback to old_string (edit pending or denied)
      if (oldStr) {
        const line = await window.agent.findLineNumber(activeProject, filePath, oldStr)
        if (!cancelled && line != null) { setStartLine(line); return }
      }
    }
    tryFind()
    return () => { cancelled = true }
  }, [filePath, oldStr, newStr, activeProject])

  const lines = useMemo(
    () => buildDiffLines(oldStr, newStr, startLine),
    [oldStr, newStr, startLine],
  )

  if (!oldStr && !newStr) return null
  return <DiffView lines={lines} oldTokens={oldTokens} newTokens={newTokens} />
}

/** Content preview for Write tool (all lines are additions). */
export function WriteDiff({ params }: { params: Record<string, unknown> }) {
  const content = String(params.content ?? '')
  const filePath = String(params.file_path ?? '')
  const language = inferLanguage(filePath)
  const tokens = useHighlightedTokens(content, language)

  const lines = useMemo<DiffLine[]>(() => {
    if (!content) return []
    return content.split('\n').map((text, i) => ({ kind: 'added' as const, lineNum: i + 1, text, sourceIdx: i }))
  }, [content])

  if (lines.length === 0) return null
  return <DiffView lines={lines} newTokens={tokens} />
}

function FileChangeDiff({ params }: { params: Record<string, unknown> }) {
  const diff = String(params.diff ?? '')
  const kind = String(params.kind ?? '')
  const filePath = String(params.file_path ?? '')
  const language = inferLanguage(filePath)
  const lines = useMemo(() => buildFileChangeDiffLines(kind, diff), [kind, diff])
  const { oldText, newText } = useMemo(() => buildDiffSourceText(lines), [lines])
  const oldTokens = useHighlightedTokens(oldText, language)
  const newTokens = useHighlightedTokens(newText, language)

  if (!diff || lines.length === 0) return null
  return <DiffView lines={lines} oldTokens={oldTokens} newTokens={newTokens} />
}

/** ExitPlanMode: shows pending / approved / rejected state.
 *  Derives outcome from tool result (persisted in messages) with live store as fallback. */
function ExitPlanModeBlock({ result }: { result?: string }) {
  const liveOutcome = useActiveSession((s) => s.planApprovalOutcome)

  const isDenied = !!result && result.startsWith('[denied] ')
  const resultOutcome = result
    ? (isDenied ? { approved: false, feedback: result.slice('[denied] '.length) } : { approved: true })
    : null
  const outcome = resultOutcome ?? liveOutcome

  if (!outcome) {
    return (
      <div className="my-4 flex items-center gap-1.5 rounded bg-muted/50 px-2 py-1.5 text-sm">
        <PenLine className="size-3 shrink-0 text-muted-foreground" />
        <span className="font-medium text-muted-foreground">Review Plan</span>
      </div>
    )
  }

  if (outcome.approved) {
    return (
      <div className="my-4 flex items-center gap-1.5 rounded bg-green-500/10 px-2 py-1.5 text-sm">
        <PenLine className="size-3 shrink-0 text-green-400" />
        <span className="font-medium text-green-400">Plan Approved</span>
        <Check className="ml-auto size-3 shrink-0 text-green-400" />
      </div>
    )
  }

  return (
    <div className="my-4 rounded bg-red-500/10 px-2 py-1.5 text-sm">
      <div className="flex items-center gap-1.5">
        <PenLine className="size-3 shrink-0 text-red-400" />
        <span className="font-medium text-red-400">Plan Rejected</span>
        <X className="ml-auto size-3 shrink-0 text-red-400" />
      </div>
      {outcome.feedback && outcome.feedback !== 'User rejected the plan' && (
        <div className="mt-1 text-xs text-red-400/70">{outcome.feedback}</div>
      )}
    </div>
  )
}

/** Debug view showing raw input and output for a tool call. */
function DebugToolBlock({
  toolName,
  input,
  result,
  status,
  elapsedSeconds,
}: {
  toolName: string
  input: string
  result?: string
  status?: 'streaming' | 'complete'
  elapsedSeconds?: number
}) {
  const isStreaming = status === 'streaming'
  const prettyInput = tryPrettifyJson(input) ?? input

  return (
    <div className="my-0.5 rounded border border-amber-500/30 bg-muted/50">
      <div className="flex items-center gap-1.5 px-2 py-1.5 text-xs">
        <span className="size-3 shrink-0 text-center text-amber-400">&#9881;</span>
        <span className="font-medium text-amber-400">
          {isStreaming ? <>{getToolVerb(toolName)}…</> : toolName}
        </span>
        <span className="rounded bg-amber-500/20 px-1 py-px text-[10px] text-amber-400">debug</span>
        {isStreaming && elapsedSeconds != null && elapsedSeconds >= 1 && (
          <span className="ml-auto shrink-0 text-muted-foreground">{Math.round(elapsedSeconds)}s</span>
        )}
      </div>
      <div className="px-2 pb-1.5 space-y-1.5">
        <div>
          <div className="mb-0.5 text-[10px] font-medium uppercase text-muted-foreground">Input</div>
          <div className="max-h-48 overflow-auto rounded bg-background/70 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-foreground whitespace-pre-wrap break-all">
            {prettyInput || <span className="text-muted-foreground italic">empty</span>}
          </div>
        </div>
        {result && !isStreaming && (
          <div>
            <div className="mb-0.5 text-[10px] font-medium uppercase text-muted-foreground">Output</div>
            <div className="max-h-48 overflow-auto rounded bg-background/70 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap break-all">
              {result}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
