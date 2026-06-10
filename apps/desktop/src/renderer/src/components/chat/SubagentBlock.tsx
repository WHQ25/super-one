import { useState, useEffect, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Bot, ChevronRight, Check, Wrench, ArrowUp, ArrowDown, Maximize, TriangleAlert, CircleSlash } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import { ToolBlock } from './ToolBlock'
import { useActiveSession, useChatStore } from '@/stores/chat'
import { getSubagentColorClasses } from './subagent-colors'
import { NestedToolContext } from './nested-tool-context'
import { useSubagentNavigation } from './subagent-navigation-context'
import { Streamdown } from 'streamdown'
import type { ContentBlock } from '@superone/shared/agent-types'
import { streamdownPlugins, streamdownRehypePlugins, streamdownControls, streamdownComponents, streamdownLinkSafety, formatTokens } from './chat-shared'
import { parseTaskInput, buildToolResultMap, buildToolErrorMaps, computeSubagentElapsed, type ToolErrorMaps } from './subagent-utils'
import { useSubagentJsonl } from './use-subagent-jsonl'
import { AgentActivity, SubagentScrollArea } from './subagent-activity'

const ZERO_TOKENS = { input: 0, output: 0 }

interface SubagentBlockProps {
  taskBlock: ContentBlock & { type: 'tool_use' }
  childBlocks: ContentBlock[]
  resultBlock?: ContentBlock
  isStreaming: boolean
  defaultExpanded?: boolean
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

export function SubagentBlock({ taskBlock, childBlocks, resultBlock, isStreaming, defaultExpanded }: SubagentBlockProps) {
  const { t } = useTranslation()
  const tokens = useActiveSession((s) => s.subagentTokens[taskBlock.toolUseId] ?? ZERO_TOKENS)
  const progress = useActiveSession((s) => s.taskProgress[taskBlock.toolUseId])
  const colorIdx = useActiveSession((s) => s.subagentColors[taskBlock.toolUseId])
  const colors = useMemo(() => getSubagentColorClasses(colorIdx), [colorIdx])
  const taskInput = useMemo(() => parseTaskInput(taskBlock.input), [taskBlock.input])
  const showSpawningPlaceholder = !taskInput.subagentType && !taskInput.description
  const isAsync = taskInput.runInBackground
  const isComplete = isAsync
    ? !!progress?.completed || (!progress && !!taskBlock.taskResultText)
    : !!resultBlock
  const isRunning = isAsync
    ? !progress?.completed && !taskBlock.taskResultText
    : !resultBlock && isStreaming
  const taskStatus = isAsync
    ? progress?.status
    : (resultBlock?.type === 'tool_result' && resultBlock.isError ? 'failed' as const : undefined)
  const isFailed = isComplete && taskStatus === 'failed'
  const isStopped = isComplete && !!taskStatus && taskStatus !== 'completed' && !isFailed
  const hasTokens = tokens.input > 0 || tokens.output > 0
  const [expanded, setExpanded] = useState(defaultExpanded ?? false)
  const nav = useSubagentNavigation()

  useEffect(() => {
    useChatStore.getState().assignSubagentColor(taskBlock.toolUseId)
  }, [taskBlock.toolUseId])

  const baselineElapsed = computeSubagentElapsed(taskBlock, progress, isRunning)
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
  const toolErrorMaps = useMemo(() => buildToolErrorMaps(childBlocks), [childBlocks])
  const rawResultText = resultBlock?.type === 'tool_result' ? resultBlock.summary : undefined
  const asyncOutputPath = useMemo(() => rawResultText?.match(/output_file:\s*(\S+)/)?.[1], [rawResultText])
  const outputFile = asyncOutputPath ?? progress?.outputFile

  const { entries: jsonlEntries, resultText: jsonlResultText } = useSubagentJsonl({
    toolUseId: taskBlock.toolUseId,
    taskResultText: taskBlock.taskResultText,
    outputFile,
    enabled: expanded,
    isRunning,
  })

  const resultText = isAsync
    ? (jsonlResultText ?? taskBlock.taskResultText)
    : (jsonlResultText ?? (asyncOutputPath ? undefined : rawResultText) ?? taskBlock.taskResultText)
  const toolCallCount = useMemo(() => {
    let count = 0
    for (const b of childBlocks) { if (b.type === 'tool_use') count++ }
    return count
  }, [childBlocks])

  const isExpandable = !showSpawningPlaceholder
  const isExpanded = expanded && isExpandable

  const statsContent = isAsync && progress ? (
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
  )

  return (
    <div className="subagent-container my-1 overflow-hidden rounded border border-border/50 bg-muted/20">
      {/* Header: Bot icon + subagent_type + description */}
      <button
        type="button"
        aria-disabled={!isExpandable}
        onClick={() => { if (isExpandable) setExpanded((e) => !e) }}
        className={cn(
          'flex w-full items-center gap-2 px-2.5 py-2 text-xs transition-colors',
          isExpandable ? 'hover:bg-muted/40' : 'cursor-default',
        )}
      >
        <Bot className={cn('size-3.5 shrink-0', isFailed ? 'text-amber-600 dark:text-amber-400' : isStopped ? 'text-muted-foreground' : colors.text, isRunning && !isExpanded && 'animate-pulse')} />
        {taskInput.name && taskInput.teamName ? (
          <span className={cn('shrink-0 rounded px-1 py-px text-[10px] font-medium', colors.tagBg, colors.tagText)}>
            {taskInput.name}@{taskInput.teamName}
          </span>
        ) : taskInput.name ? (
          <>
            <span className={cn('shrink-0 rounded px-1 py-px text-[10px] font-medium', colors.tagBg, colors.tagText)}>
              {taskInput.name}
            </span>
            {taskInput.subagentType && taskInput.subagentType !== taskInput.name && (
              <span className="shrink-0 text-[10px] text-muted-foreground">{taskInput.subagentType}</span>
            )}
          </>
        ) : taskInput.subagentType ? (
          <span className={cn('shrink-0 rounded px-1 py-px text-[10px]', colors.tagBg, colors.tagText)}>
            {taskInput.subagentType}
          </span>
        ) : null}
        {taskInput.description && (
          <span className="min-w-0 truncate text-left text-muted-foreground">{taskInput.description}</span>
        )}
        {showSpawningPlaceholder && (
          <span className="min-w-0 text-left text-muted-foreground">{t('chat.subagent.spawning')}</span>
        )}
        {isExpandable && (
          <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
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
            {isExpanded && (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => { e.stopPropagation(); nav.open({ toolUseId: taskBlock.toolUseId }) }}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); nav.open({ toolUseId: taskBlock.toolUseId }) } }}
                className="inline-flex items-center rounded p-0.5 hover:bg-muted hover:text-foreground"
                title={t('chat.subagent.openFullView', 'Open full view')}
              >
                <Maximize className="size-3" />
              </span>
            )}
            <ChevronRight
              className={cn('size-3 shrink-0 transition-transform duration-200', isExpanded && 'rotate-90')}
            />
          </span>
        )}
      </button>

      {isExpanded && (
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

          {/* Sub tool calls — no grouping, scrollable with auto-scroll, tools default collapsed */}
          {childBlocks.length > 0 && (
            <NestedToolContext.Provider value={{ defaultAutoExpand: false }}>
              <SubagentScrollArea borderClass={colors.borderL}>
                {childBlocks.map((block, i) =>
                  renderChildBlock(block, i, isStreaming, toolResultMap, toolErrorMaps)
                )}
              </SubagentScrollArea>
            </NestedToolContext.Provider>
          )}

          {/* Output — collapsible with line limit */}
          {resultText && !(isAsync && isRunning) && <OutputPreview text={resultText} />}
        </div>
      )}

      {isExpanded && (isRunning || isComplete) && <div className="flex items-center gap-1.5 border-t border-border/30 px-2.5 py-1.5 text-[11px] text-muted-foreground">
        {isRunning ? (
          <>
            <span>{isAsync ? t('chat.subagent.runningInBackground') : t('chat.subagent.running')}</span>
            {elapsed > 0 && <span className="tabular-nums">{formatElapsed(elapsed)}</span>}
          </>
        ) : isFailed ? (
          <>
            <TriangleAlert className="size-3 shrink-0 text-amber-600 dark:text-amber-400" />
            <span className="text-amber-600 dark:text-amber-400">{t('chat.subagent.failed')}{elapsed > 0 ? ` ${formatElapsed(elapsed)}` : ''}</span>
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
      </div>}
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
  errorMaps: ToolErrorMaps,
) {
  switch (block.type) {
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
          isError={errorMaps.errorIds.has(block.toolUseId)}
          isTimedOut={errorMaps.timedOutIds.has(block.toolUseId)}
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
