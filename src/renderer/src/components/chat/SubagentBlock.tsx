import { useState, useEffect, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Bot, ChevronRight, Check, Wrench, ArrowUp, ArrowDown, MessageSquare, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ToolBlock } from './ToolBlock'
import { getToolDisplay, getToolVerb, parseToolInput } from './tool-display'
import { ToolIcon } from './ToolIcon'
import { useActiveSession, useBashOutput, useChatStore, SUBAGENT_COLOR_POOL } from '@/stores/chat'
import { Streamdown } from 'streamdown'
import type { ContentBlock } from '../../../../shared/agent-types'
import { streamdownPlugins, streamdownRehypePlugins, streamdownControls, streamdownComponents, streamdownLinkSafety, formatTokens } from './chat-shared'
import { parseJsonlOutput, type JsonlEntry } from './subagent-utils'

const ZERO_TOKENS = { input: 0, output: 0 }
const SUBAGENT_OUTPUT_TAIL_LINES = 400

interface SubagentColorClasses {
  text: string
  tagBg: string
  tagText: string
  activityBg: string
  borderL: string
}

const SUBAGENT_COLOR_CLASSES: Record<string, SubagentColorClasses> = {
  purple: {
    text: 'text-purple-600 dark:text-purple-400',
    tagBg: 'bg-purple-500/15 dark:bg-purple-900/40',
    tagText: 'text-purple-700 dark:text-purple-300',
    activityBg: 'bg-purple-500/10 dark:bg-purple-900/20',
    borderL: 'border-purple-500/30',
  },
  blue: {
    text: 'text-blue-600 dark:text-blue-400',
    tagBg: 'bg-blue-500/15 dark:bg-blue-900/40',
    tagText: 'text-blue-700 dark:text-blue-300',
    activityBg: 'bg-blue-500/10 dark:bg-blue-900/20',
    borderL: 'border-blue-500/30',
  },
  cyan: {
    text: 'text-cyan-600 dark:text-cyan-400',
    tagBg: 'bg-cyan-500/15 dark:bg-cyan-900/40',
    tagText: 'text-cyan-700 dark:text-cyan-300',
    activityBg: 'bg-cyan-500/10 dark:bg-cyan-900/20',
    borderL: 'border-cyan-500/30',
  },
  teal: {
    text: 'text-teal-600 dark:text-teal-400',
    tagBg: 'bg-teal-500/15 dark:bg-teal-900/40',
    tagText: 'text-teal-700 dark:text-teal-300',
    activityBg: 'bg-teal-500/10 dark:bg-teal-900/20',
    borderL: 'border-teal-500/30',
  },
  green: {
    text: 'text-green-600 dark:text-green-400',
    tagBg: 'bg-green-500/15 dark:bg-green-900/40',
    tagText: 'text-green-700 dark:text-green-300',
    activityBg: 'bg-green-500/10 dark:bg-green-900/20',
    borderL: 'border-green-500/30',
  },
  amber: {
    text: 'text-amber-600 dark:text-amber-400',
    tagBg: 'bg-amber-500/15 dark:bg-amber-900/40',
    tagText: 'text-amber-700 dark:text-amber-300',
    activityBg: 'bg-amber-500/10 dark:bg-amber-900/20',
    borderL: 'border-amber-500/30',
  },
  orange: {
    text: 'text-orange-600 dark:text-orange-400',
    tagBg: 'bg-orange-500/15 dark:bg-orange-900/40',
    tagText: 'text-orange-700 dark:text-orange-300',
    activityBg: 'bg-orange-500/10 dark:bg-orange-900/20',
    borderL: 'border-orange-500/30',
  },
  rose: {
    text: 'text-rose-600 dark:text-rose-400',
    tagBg: 'bg-rose-500/15 dark:bg-rose-900/40',
    tagText: 'text-rose-700 dark:text-rose-300',
    activityBg: 'bg-rose-500/10 dark:bg-rose-900/20',
    borderL: 'border-rose-500/30',
  },
}

const DEFAULT_SUBAGENT_COLOR_CLASSES = SUBAGENT_COLOR_CLASSES.purple

function getSubagentColorClasses(idx: number | undefined): SubagentColorClasses {
  if (idx === undefined) return DEFAULT_SUBAGENT_COLOR_CLASSES
  const name = SUBAGENT_COLOR_POOL[idx % SUBAGENT_COLOR_POOL.length]
  return SUBAGENT_COLOR_CLASSES[name] ?? DEFAULT_SUBAGENT_COLOR_CLASSES
}

interface SubagentBlockProps {
  taskBlock: ContentBlock & { type: 'tool_use' }
  childBlocks: ContentBlock[]
  resultBlock?: ContentBlock
  isStreaming: boolean
  defaultExpanded?: boolean
}

/** Parse Task tool input to extract display info. */
function parseTaskInput(input: string) {
  const params = parseToolInput(input, 'Task')
  return {
    name: String(params.name ?? ''),
    description: String(params.description ?? ''),
    subagentType: String(params.subagent_type ?? ''),
    prompt: String(params.prompt ?? ''),
    model: params.model ? String(params.model) : undefined,
    runInBackground: params.run_in_background === true,
  }
}

/** Format elapsed seconds to a readable string. */
function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  const mins = Math.floor(seconds / 60)
  const secs = Math.round(seconds % 60)
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`
}

function SubagentTokens({ input, output }: { input: number; output: number }) {
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

/** Build a toolUseId → summary map for correlating tool_result with tool_use. */
function buildToolResultMap(blocks: ContentBlock[]) {
  const map = new Map<string, string>()
  for (const block of blocks) {
    if (block.type === 'tool_result' && block.summary) map.set(block.toolUseId, block.summary)
  }
  return map
}

export function SubagentBlock({ taskBlock, childBlocks, resultBlock, isStreaming, defaultExpanded }: SubagentBlockProps) {
  const { t } = useTranslation()
  const tokens = useActiveSession((s) => s.subagentTokens[taskBlock.toolUseId] ?? ZERO_TOKENS)
  const progress = useActiveSession((s) => s.taskProgress[taskBlock.toolUseId])
  const colorIdx = useActiveSession((s) => s.subagentColors[taskBlock.toolUseId])
  const colors = useMemo(() => getSubagentColorClasses(colorIdx), [colorIdx])
  const bashOutput = useBashOutput(taskBlock.toolUseId)
  const taskInput = useMemo(() => parseTaskInput(taskBlock.input), [taskBlock.input])
  const showSpawningPlaceholder = !taskInput.subagentType && !taskInput.description
  const isAsync = taskInput.runInBackground
  const isComplete = isAsync
    ? !!progress?.completed || (!progress && !!taskBlock.taskResultText)
    : !!resultBlock
  const isRunning = isAsync
    ? !progress?.completed && !taskBlock.taskResultText
    : !resultBlock && isStreaming
  const hasTokens = tokens.input > 0 || tokens.output > 0
  const [expanded, setExpanded] = useState(defaultExpanded ?? (isAsync ? false : !isComplete))

  useEffect(() => {
    useChatStore.getState().assignSubagentColor(taskBlock.toolUseId)
  }, [taskBlock.toolUseId])

  useEffect(() => {
    if (isAsync && defaultExpanded === undefined) setExpanded(false)
  }, [isAsync])

  const baselineElapsed = taskBlock.elapsedSeconds
    ? Math.round(taskBlock.elapsedSeconds)
    : taskBlock.startedAt
      ? Math.floor((Date.now() - taskBlock.startedAt) / 1000)
      : 0
  const startTimeRef = useRef<number>(Date.now() - baselineElapsed * 1000)
  const [elapsed, setElapsed] = useState(baselineElapsed)

  useEffect(() => {
    if (!isRunning) return
    startTimeRef.current = Date.now() - elapsed * 1000
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000))
    }, 1000)
    return () => clearInterval(timer)
  }, [isRunning])

  // Freeze elapsed on completion
  useEffect(() => {
    if (isComplete && elapsed === 0) {
      const maxElapsed = childBlocks.reduce((max, b) => {
        if (b.type === 'tool_use' && b.elapsedSeconds) return Math.max(max, b.elapsedSeconds)
        return max
      }, 0)
      if (maxElapsed > 0) setElapsed(Math.round(maxElapsed))
    }
  }, [isComplete])

  const toolResultMap = useMemo(() => buildToolResultMap(childBlocks), [childBlocks])
  const rawResultText = resultBlock?.type === 'tool_result' ? resultBlock.summary : undefined
  const asyncOutputPath = useMemo(() => rawResultText?.match(/output_file:\s*(\S+)/)?.[1], [rawResultText])
  const outputFile = asyncOutputPath ?? progress?.outputFile
  const [jsonlEntries, setJsonlEntries] = useState<JsonlEntry[]>([])
  const [jsonlResultText, setJsonlResultText] = useState<string>()
  const watchedContent = bashOutput && bashOutput.outputPath === outputFile ? bashOutput.content : ''

  useEffect(() => {
    setJsonlEntries([])
    setJsonlResultText(undefined)
  }, [outputFile])

  useEffect(() => {
    if (!outputFile) {
      window.app.trace?.('subagent.output', 'no_output_file', { asyncOutputPath, progressFile: progress?.outputFile, resultSummary: rawResultText?.slice(0, 200) }, taskBlock.toolUseId)
      return
    }
    if (!expanded) return
    useChatStore.setState((s) => ({
      _bashOutputs: {
        ...s._bashOutputs,
        [taskBlock.toolUseId]: {
          content: s._bashOutputs[taskBlock.toolUseId]?.outputPath === outputFile ? s._bashOutputs[taskBlock.toolUseId]?.content ?? '' : '',
          finished: s._bashOutputs[taskBlock.toolUseId]?.outputPath === outputFile ? s._bashOutputs[taskBlock.toolUseId]?.finished ?? false : false,
          outputPath: outputFile,
        },
      },
    }))
    window.app.trace?.('subagent.output', 'start_watching', { outputFile, isRunning }, taskBlock.toolUseId)
    window.app.watchBashOutput(taskBlock.toolUseId, outputFile, SUBAGENT_OUTPUT_TAIL_LINES).catch((err) => {
      window.app.trace?.('subagent.output', 'watch_error', { outputFile, error: String(err) }, taskBlock.toolUseId)
    })
    return () => { window.app.unwatchBashOutput(taskBlock.toolUseId).catch(() => {}) }
  }, [expanded, isRunning, outputFile, taskBlock.toolUseId])

  useEffect(() => {
    if (!expanded || !outputFile || !watchedContent) return
    window.app.trace?.('subagent.output', 'read_result', { outputFile, rawLen: watchedContent.length, first100: watchedContent.slice(0, 100) }, taskBlock.toolUseId)
    const parsed = parseJsonlOutput(watchedContent)
    window.app.trace?.('subagent.output', 'parsed', { entries: parsed.entries.length, hasResultText: !!parsed.resultText }, taskBlock.toolUseId)
    if (parsed.entries.length > 0 || parsed.resultText) {
      setJsonlEntries(parsed.entries)
      setJsonlResultText(parsed.resultText)
      if (parsed.resultText && parsed.resultText !== taskBlock.taskResultText) {
        useChatStore.setState((s) => {
          const project = s.projectSessions[s.activeProject ?? '']
          if (!project) return s
          const sid = project._activeSessionId
          if (!sid) return s
          const session = project._sessions[sid]
          if (!session) return s
          return {
            projectSessions: {
              ...s.projectSessions,
              [s.activeProject!]: {
                ...project,
                _sessions: {
                  ...project._sessions,
                  [sid]: {
                    ...session,
                    messages: session.messages.map((msg) => ({
                      ...msg,
                      content: msg.content.map((block) =>
                        block.type === 'tool_use' && block.toolUseId === taskBlock.toolUseId
                          ? { ...block, taskResultText: parsed.resultText }
                          : block,
                      ),
                    })),
                  },
                },
              },
            },
          }
        })
      }
    }
  }, [expanded, outputFile, taskBlock.toolUseId, watchedContent])

  useEffect(() => {
    if (!expanded || isRunning || bashOutput?.outputPath !== outputFile || bashOutput?.finished !== true) return
    window.app.unwatchBashOutput(taskBlock.toolUseId).catch(() => {})
  }, [bashOutput?.finished, bashOutput?.outputPath, expanded, isRunning, outputFile, taskBlock.toolUseId])

  const resultText = isAsync
    ? (jsonlResultText ?? taskBlock.taskResultText)
    : (jsonlResultText ?? (asyncOutputPath ? undefined : rawResultText) ?? taskBlock.taskResultText)
  const toolCallCount = useMemo(() => {
    let count = 0
    for (const b of childBlocks) { if (b.type === 'tool_use') count++ }
    return count
  }, [childBlocks])

  return (
    <div className="subagent-container my-1 overflow-hidden rounded border border-border/50 bg-muted/20">
      {/* Header: Bot icon + subagent_type + description */}
      <button
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center gap-2 px-2.5 py-2 text-xs transition-colors hover:bg-muted/40"
      >
        <Bot className={cn('size-3.5 shrink-0', colors.text, isRunning && !expanded && 'animate-pulse')} />
        {taskInput.subagentType && (
          <span className={cn('shrink-0 rounded px-1 py-px text-[10px]', colors.tagBg, colors.tagText)}>
            {taskInput.subagentType}
          </span>
        )}
        {taskInput.description && (
          <span className="min-w-0 truncate text-left text-muted-foreground">{taskInput.description}</span>
        )}
        {showSpawningPlaceholder && (
          <span className="min-w-0 text-left text-muted-foreground">{t('chat.subagent.spawning')}</span>
        )}
        <ChevronRight
          className={cn('ml-auto size-3 shrink-0 text-muted-foreground transition-transform duration-200', expanded && 'rotate-90')}
        />
      </button>

      {expanded && (
        <div className="border-t border-border/30">
          {/* Input: prompt preview */}
          {taskInput.prompt && <PromptPreview prompt={taskInput.prompt} model={taskInput.model} />}

          {/* Agent activity — JSONL entries (text + tool interleaved), with live fallback */}
          {isAsync && (jsonlEntries.length > 0 || progress) && (
            <AgentActivity
              entries={jsonlEntries}
              fallbackTools={jsonlEntries.length === 0 ? progress?.toolHistory : undefined}
              activeTool={isRunning && progress?.description ? { toolName: progress.lastToolName ?? '', description: progress.description } : undefined}
              isRunning={isRunning}
              summary={undefined}
              colors={colors}
            />
          )}

          {/* Sub tool calls — no grouping, scrollable with auto-scroll */}
          {childBlocks.length > 0 && (
            <SubagentScrollArea isStreaming={isStreaming} borderClass={colors.borderL}>
              {childBlocks.map((block, i) =>
                renderChildBlock(block, i, isStreaming, toolResultMap)
              )}
            </SubagentScrollArea>
          )}

          {/* Output — collapsible with line limit */}
          {resultText && !(isAsync && isRunning) && <OutputPreview text={resultText} />}
        </div>
      )}

      {expanded && (isRunning || isComplete) && <div className="flex items-center gap-1.5 border-t border-border/30 px-2.5 py-1.5 text-[11px] text-muted-foreground">
        {isRunning ? (
          <>
            <span>{isAsync ? t('chat.subagent.runningInBackground') : t('chat.subagent.running')}</span>
            {elapsed > 0 && <span className="tabular-nums">{formatElapsed(elapsed)}</span>}
          </>
        ) : (
          <>
            <Check className="size-3 shrink-0 text-green-600 dark:text-green-400" />
            <span>{t('chat.subagent.done')}{elapsed > 0 ? ` ${formatElapsed(elapsed)}` : ''}</span>
          </>
        )}
        <span className="ml-auto flex items-center gap-1.5">
          {isAsync && progress ? (
            <>
              {progress.toolUses > 0 && (
                <span className="inline-flex items-center gap-0.5">
                  <Wrench className="size-3" />
                  {progress.toolUses}
                </span>
              )}
              {progress.totalTokens > 0 && (
                <>
                  {progress.toolUses > 0 && <span>·</span>}
                  <span className="tabular-nums">{formatTokens(progress.totalTokens)}</span>
                </>
              )}
            </>
          ) : (
            <>
              {toolCallCount > 0 && (
                <span className="inline-flex items-center gap-0.5">
                  <Wrench className="size-3" />
                  {toolCallCount}
                </span>
              )}
              {hasTokens && toolCallCount > 0 && <span>·</span>}
              <SubagentTokens input={tokens.input} output={tokens.output} />
            </>
          )}
        </span>
      </div>}
    </div>
  )
}

function AgentActivity({ entries, fallbackTools, activeTool, isRunning, summary, colors }: {
  entries: JsonlEntry[]
  fallbackTools?: Array<{ toolName: string; description: string }>
  activeTool?: { toolName: string; description: string }
  isRunning: boolean
  summary?: string
  colors: SubagentColorClasses
}) {
  const latestActivity = useMemo(
    () => entries.findLast((e) => e.type === 'activity') as { type: 'activity'; text: string } | undefined,
    [entries],
  )
  const tools = useMemo(
    () => entries.filter((e): e is JsonlEntry & { type: 'tool' } => e.type === 'tool'),
    [entries],
  )
  return (
    <div className="border-t border-border/30">
      {summary && (
        <div className="mx-2.5 mt-1.5 mb-1.5 flex items-start gap-1.5 rounded-md bg-blue-500/10 px-2.5 py-1.5 text-xs leading-relaxed text-foreground dark:bg-blue-900/20">
          <Sparkles className="mt-0.5 size-3 shrink-0 text-blue-600 dark:text-blue-400" />
          <span className="whitespace-pre-wrap">{summary}</span>
        </div>
      )}
      {isRunning && latestActivity && (
        <div className={cn('mx-2.5 mt-1.5 mb-1.5 flex items-start gap-1.5 rounded-md px-2.5 py-1.5 text-xs leading-relaxed text-foreground', colors.activityBg)}>
          <MessageSquare className={cn('mt-0.5 size-3 shrink-0 animate-pulse', colors.text)} />
          <span className="whitespace-pre-wrap">{latestActivity.text.trim()}</span>
        </div>
      )}
      <SubagentScrollArea isStreaming={isRunning} borderClass={colors.borderL}>
        {(tools.length > 0 ? tools : fallbackTools ?? []).map((entry, i) => (
          <AsyncToolRow key={i} toolName={entry.toolName} description={entry.description} isActive={false} />
        ))}
        {activeTool && (
          <AsyncToolRow toolName={activeTool.toolName} description={activeTool.description} isActive />
        )}
      </SubagentScrollArea>
    </div>
  )
}

function AsyncToolRow({ toolName, description, isActive }: { toolName: string; description: string; isActive: boolean }) {
  const icon = getToolDisplay(toolName, {}).icon
  return (
    <div className="tool-node my-0.5 flex items-center gap-1.5 rounded bg-muted/50 px-2 py-1.5 text-xs">
      <ToolIcon icon={icon} className="size-3 shrink-0 text-muted-foreground" />
      <span className="shrink-0 font-medium text-foreground">
        {isActive ? <>{getToolVerb(toolName)}&hellip;</> : toolName}
      </span>
      {description && <span className="min-w-0 truncate text-muted-foreground">{description}</span>}
    </div>
  )
}

/** Scrollable container that auto-scrolls to bottom on new content, unless user scrolled up. */
function SubagentScrollArea({ children, isStreaming, borderClass }: { children: React.ReactNode; isStreaming: boolean; borderClass: string }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const isNearBottomRef = useRef(true)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const handleScroll = (): void => {
      isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 30
    }
    el.addEventListener('scroll', handleScroll, { passive: true })
    return () => el.removeEventListener('scroll', handleScroll)
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el || !isNearBottomRef.current) return
    el.scrollTop = el.scrollHeight
  })

  return (
    <div
      ref={scrollRef}
      className={cn('max-h-[100px] overflow-y-auto border-l-2 ml-3 pl-2.5 py-1', borderClass)}
    >
      {children}
    </div>
  )
}

/** Collapsible output with scrollable content. */
function OutputPreview({ text }: { text: string }) {
  const { t } = useTranslation()
  const [showOutput, setShowOutput] = useState(false)

  return (
    <div className="border-t border-border/30 px-3 py-1.5">
      <button
        onClick={(e) => { e.stopPropagation(); setShowOutput((s) => !s) }}
        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronRight className={cn('size-2.5 shrink-0 transition-transform duration-200', showOutput && 'rotate-90')} />
        <span className="font-medium">{t('chat.subagent.output')}</span>
      </button>
      {showOutput && (
        <div className="mt-1 max-h-[200px] overflow-y-auto text-xs">
          <Streamdown
            className="chat-md"
            plugins={streamdownPlugins}
            rehypePlugins={streamdownRehypePlugins}
            components={streamdownComponents}
            controls={streamdownControls}
            linkSafety={streamdownLinkSafety}
          >
            {text}
          </Streamdown>
        </div>
      )}
    </div>
  )
}

/** Collapsible prompt preview. */
function PromptPreview({ prompt, model }: { prompt: string; model?: string }) {
  const { t } = useTranslation()
  const [showPrompt, setShowPrompt] = useState(false)

  return (
    <div className="px-3 py-1.5 text-[11px]">
      <button
        onClick={(e) => { e.stopPropagation(); setShowPrompt((s) => !s) }}
        className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronRight className={cn('size-2.5 shrink-0 transition-transform duration-200', showPrompt && 'rotate-90')} />
        <span>{t('chat.subagent.prompt')}</span>
        {model && <span className="ml-1 rounded bg-muted px-1 py-px text-[10px]">{model}</span>}
      </button>
      {showPrompt && (
        <div className="mt-1 max-h-[100px] overflow-y-auto whitespace-pre-wrap rounded bg-background/50 px-2 py-1.5 text-muted-foreground leading-relaxed">
          {prompt}
        </div>
      )}
    </div>
  )
}

/** Render a single child block inside the subagent container. */
function renderChildBlock(
  block: ContentBlock,
  index: number,
  isStreaming: boolean,
  toolResultMap: Map<string, string>,
) {
  switch (block.type) {
    case 'text':
      return (
        <Streamdown
          key={index}
          className="chat-md text-xs px-1"
          plugins={streamdownPlugins}
          rehypePlugins={streamdownRehypePlugins}
          components={streamdownComponents}
          controls={streamdownControls}
          linkSafety={streamdownLinkSafety}
          isAnimating={isStreaming}
        >
          {block.text}
        </Streamdown>
      )
    case 'tool_use':
      return (
        <ToolBlock
          key={index}
          toolName={block.toolName}
          toolUseId={block.toolUseId}
          input={block.input}
          status={!isStreaming && block.status === 'streaming' ? undefined : block.status}
          elapsedSeconds={block.elapsedSeconds}
          result={toolResultMap.get(block.toolUseId)}
        />
      )
    case 'tool_result':
      if (toolResultMap.has(block.toolUseId)) return null
      if (!block.summary) return null
      return (
        <div key={index} className="my-0.5 overflow-x-auto rounded bg-muted/50 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap">
          {block.summary}
        </div>
      )
    default:
      return null
  }
}
