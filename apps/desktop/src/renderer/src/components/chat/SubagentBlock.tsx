import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Streamdown } from 'streamdown'
import type { ContentBlock } from '@superone/shared/agent-types'
import { ToolBlock } from './ToolBlock'
import { useActiveSession, useChatStore } from '@/stores/chat'
import { getSubagentColorClasses } from './subagent-colors'
import { NestedToolContext } from './nested-tool-context'
import { useSubagentNavigation } from './subagent-navigation-context'
import {
  formatTokens,
  streamdownComponents,
  streamdownControls,
  streamdownLinkSafety,
  streamdownPlugins,
  streamdownRehypePlugins,
} from './chat-shared'
import {
  buildToolErrorMaps,
  buildToolResultMap,
  computeSubagentElapsed,
  groupSubagentChildren,
  looksLikeBackgroundSubagentAck,
  parseSubagentIdFromText,
  parseTaskInput,
  resolveTaskProgressEntry,
  type ToolErrorMaps,
} from './subagent-utils'
import { useSubagentJsonl } from './use-subagent-jsonl'
import { AgentActivity, SubagentScrollArea } from './subagent-activity'
import { SubagentRetryBadge } from './SubagentRetryBadge'
import {
  SubagentBlockPresenter,
  type SubagentMarkdownProps,
} from './presenters/SubagentBlock'

const ZERO_TOKENS = { input: 0, output: 0 }

function useStableArray<T>(items: T[]): T[] {
  const ref = useRef(items)
  const previous = ref.current
  if (
    previous !== items
    && (previous.length !== items.length || previous.some((item, index) => item !== items[index]))
  ) {
    ref.current = items
  }
  return ref.current
}

export interface SubagentBlockProps {
  taskBlock: ContentBlock & { type: 'tool_use' }
  childBlocks: ContentBlock[]
  resultBlock?: ContentBlock
  isStreaming: boolean
  defaultExpanded?: boolean
  trailingAction?: ReactNode
}

function DesktopSubagentMarkdown({ text }: SubagentMarkdownProps) {
  return (
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
  )
}

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
      if (toolResultMap.has(block.toolUseId) || !block.summary) return null
      return (
        <div
          key={index}
          className="my-0.5 overflow-x-auto whitespace-pre-wrap rounded bg-muted/50 px-2 py-1.5 font-mono text-xs leading-relaxed text-muted-foreground"
        >
          {block.summary}
        </div>
      )
    default:
      return null
  }
}

/** Desktop data and filesystem adapter for the portable subagent presenter. */
export function SubagentBlock({
  taskBlock,
  childBlocks: childBlocksProp,
  resultBlock,
  isStreaming,
  defaultExpanded,
  trailingAction,
}: SubagentBlockProps) {
  const childBlocks = useStableArray(childBlocksProp)
  const [expanded, setExpanded] = useState(defaultExpanded ?? false)
  const tokens = useActiveSession(
    (state) => state.subagentTokens[taskBlock.toolUseId] ?? ZERO_TOKENS,
  )
  const rawResultText = resultBlock?.type === 'tool_result' ? resultBlock.summary : undefined
  const taskIdHint = useMemo(
    () => parseSubagentIdFromText(rawResultText) ?? parseSubagentIdFromText(taskBlock.taskResultText),
    [rawResultText, taskBlock.taskResultText],
  )
  const progress = useActiveSession((state) =>
    resolveTaskProgressEntry(state.taskProgress, taskBlock.toolUseId, taskIdHint),
  )
  const colorIndex = useActiveSession((state) => state.subagentColors[taskBlock.toolUseId])
  const colors = useMemo(() => getSubagentColorClasses(colorIndex), [colorIndex])
  const taskInput = useMemo(() => parseTaskInput(taskBlock.input), [taskBlock.input])
  const isAsync = taskInput.runInBackground || looksLikeBackgroundSubagentAck(rawResultText)
  const isComplete = progress
    ? !!progress.completed
    : isAsync
      ? !!taskBlock.taskResultText
      : !!resultBlock
  const isRunning = progress
    ? !progress.completed
    : isAsync
      ? !taskBlock.taskResultText
      : !resultBlock && isStreaming
  const taskStatus = progress?.status
    ?? (resultBlock?.type === 'tool_result' && resultBlock.isError ? 'failed' : undefined)
  const isFailed = isComplete && taskStatus === 'failed'
  const isStopped = isComplete && !!taskStatus && taskStatus !== 'completed' && !isFailed
  const nav = useSubagentNavigation()

  useEffect(() => {
    useChatStore.getState().assignSubagentColor(taskBlock.toolUseId)
  }, [taskBlock.toolUseId])

  const toolResultMap = useMemo(() => buildToolResultMap(childBlocks), [childBlocks])
  const toolErrorMaps = useMemo(() => buildToolErrorMaps(childBlocks), [childBlocks])
  const childItems = useMemo(
    () => groupSubagentChildren(childBlocks, taskBlock.toolUseId),
    [childBlocks, taskBlock.toolUseId],
  )
  const asyncOutputPath = useMemo(
    () => rawResultText?.match(/output_file:\s*(\S+)/)?.[1],
    [rawResultText],
  )
  const resultOutputPath = resultBlock?.type === 'tool_result' ? resultBlock.outputPath : undefined
  const outputFile = asyncOutputPath
    ?? progress?.outputFile
    ?? taskBlock.taskOutputFile
    ?? resultOutputPath
  const usesProgressActivity = childItems.length === 0
  const { entries: jsonlEntries, resultText: jsonlResultText } = useSubagentJsonl({
    toolUseId: taskBlock.toolUseId,
    taskResultText: taskBlock.taskResultText,
    outputFile,
    enabled: usesProgressActivity && !!outputFile && expanded,
    isRunning,
    skipAuthoritativeRead: !!outputFile && outputFile.endsWith('chat_history.jsonl'),
  })
  const resultText = isAsync
    ? jsonlResultText ?? taskBlock.taskResultText
    : jsonlResultText ?? (asyncOutputPath ? undefined : rawResultText) ?? taskBlock.taskResultText
  const activityHistory = (
    progress?.toolHistory?.length ? progress.toolHistory : taskBlock.taskToolHistory
  ) ?? []
  const activityToolUses = progress?.toolUses
    ?? taskBlock.taskUsage?.toolUses
    ?? (jsonlEntries.length > 0
      ? jsonlEntries.reduce((count, entry) => count + (entry.type === 'tool' ? 1 : 0), 0)
      : activityHistory.length)
  const activityTokens = progress?.totalTokens ?? taskBlock.taskUsage?.totalTokens ?? 0
  const hasActivity = jsonlEntries.length > 0 || activityHistory.length > 0 || !!progress
  const toolCallCount = useMemo(
    () => childItems.reduce(
      (count, item) => count + (item.kind === 'subagent'
        || (item.kind === 'block' && item.block.type === 'tool_use') ? 1 : 0),
      0,
    ),
    [childItems],
  )
  const completionElapsed = useMemo(
    () => childBlocks.reduce(
      (maximum, block) => block.type === 'tool_use' && block.elapsedSeconds
        ? Math.max(maximum, block.elapsedSeconds)
        : maximum,
      0,
    ),
    [childBlocks],
  )

  const activityContent = usesProgressActivity && hasActivity ? (
    <NestedToolContext.Provider value={{ defaultAutoExpand: false, allowExpand: false }}>
      <AgentActivity
        entries={jsonlEntries}
        fallbackTools={jsonlEntries.length === 0 ? activityHistory : undefined}
        activeTool={undefined}
        isRunning={isRunning}
        summary={undefined}
        colors={colors}
      />
    </NestedToolContext.Provider>
  ) : undefined

  const childContent = childItems.length > 0 ? (
    <NestedToolContext.Provider value={{ defaultAutoExpand: false, allowExpand: false }}>
      <SubagentScrollArea borderClass={colors.borderL}>
        {childItems.map((item, index) => item.kind === 'subagent' ? (
          <SubagentBlock
            key={`sa-${item.segment.taskBlock.toolUseId}`}
            taskBlock={item.segment.taskBlock}
            childBlocks={item.segment.childBlocks}
            resultBlock={item.segment.resultBlock}
            isStreaming={isStreaming}
          />
        ) : renderChildBlock(item.block, index, isStreaming, toolResultMap, toolErrorMaps))}
      </SubagentScrollArea>
    </NestedToolContext.Provider>
  ) : undefined

  return (
    <SubagentBlockPresenter
      toolUseId={taskBlock.toolUseId}
      taskInput={taskInput}
      colors={colors}
      isAsync={isAsync}
      isRunning={isRunning}
      isComplete={isComplete}
      isFailed={isFailed}
      isStopped={isStopped}
      expanded={expanded}
      onExpandedChange={setExpanded}
      onOpenFullView={() => nav.open({ toolUseId: taskBlock.toolUseId })}
      initialElapsed={computeSubagentElapsed(taskBlock, progress, isRunning)}
      completionElapsed={completionElapsed}
      stats={usesProgressActivity && hasActivity
        ? { toolCalls: activityToolUses, totalTokens: activityTokens }
        : {
            toolCalls: toolCallCount,
            inputTokens: tokens.input,
            outputTokens: tokens.output,
          }}
      retryBadge={isRunning && progress?.retry
        ? <SubagentRetryBadge retry={progress.retry} className="ml-1" />
        : undefined}
      activityContent={activityContent}
      childContent={childContent}
      diagnostic={progress?.diagnostic}
      resultText={resultText}
      trailingAction={trailingAction}
      formatTokens={formatTokens}
      Markdown={DesktopSubagentMarkdown}
    />
  )
}

export {
  SubagentBlockPresenter,
  type SubagentBlockPresenterProps,
} from './presenters/SubagentBlock'
