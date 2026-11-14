import { DeferredDetailStatus } from '@superone/chat-view/use-deferred-tool-detail'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
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
  type ToolErrorMaps,
} from './subagent-utils'
import { useSubagentJsonl } from './use-subagent-jsonl'
import { AgentActivity, SubagentScrollArea } from './subagent-activity'
import { SubagentRetryBadge } from './SubagentRetryBadge'
import {
  SubagentBlockPresenter,
  type SubagentMarkdownProps,
} from './presenters/SubagentBlock'
import { useSubagentCard } from './use-subagent-card'

const ZERO_TOKENS = { input: 0, output: 0 }

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

/** Render a subagent's child tool row; shared with the full view. */
export function renderChildBlock(
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
          filePath={block.toolFilePath}
          toolLineDelta={block.toolLineDelta}
          toolDiff={block.toolDiff}
          toolDiffTokens={block.toolDiffTokens}
          status={!isStreaming && block.status === 'streaming' ? undefined : block.status}
          elapsedSeconds={block.elapsedSeconds}
          remoteDetail={block.remoteDetail}
          // An App call keeps its View, as at the root (docs/features/mcp-apps.md).
          app={block.app}
          liveOutput={block.liveOutput}
          authRequired={block.authRequired}
          result={toolResultMap.get(block.toolUseId)}
          isError={errorMaps.errorIds.has(block.toolUseId)}
          isTimedOut={errorMaps.timedOutIds.has(block.toolUseId)}
          bashEditDiff={errorMaps.bashEditDiffs.get(block.toolUseId)}
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
  taskBlock: shellTaskBlock,
  childBlocks: childBlocksProp,
  resultBlock: shellResultBlock,
  isStreaming,
  defaultExpanded,
  trailingAction,
}: SubagentBlockProps) {
  const [expanded, setExpanded] = useState(defaultExpanded ?? false)
  const {
    taskBlock,
    childBlocks,
    deferred,
    rawResultText,
    progress,
    taskInput,
    isAsync,
    isRunning,
    isComplete,
    isFailed,
    isStopped,
    asyncOutputPath,
    outputFile,
  } = useSubagentCard({ taskBlock: shellTaskBlock, childBlocks: childBlocksProp, resultBlock: shellResultBlock, open: expanded, isStreaming })
  const tokens = useActiveSession(
    (state) => state.subagentTokens[taskBlock.toolUseId] ?? ZERO_TOKENS,
  )
  const colorIndex = useActiveSession((state) => state.subagentColors[taskBlock.toolUseId])
  const colors = useMemo(() => getSubagentColorClasses(colorIndex), [colorIndex])
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
  const usesProgressActivity = childItems.length === 0
  const { entries: jsonlEntries, resultText: jsonlResultText } = useSubagentJsonl({
    toolUseId: taskBlock.toolUseId,
    taskResultText: taskBlock.taskResultText,
    outputFile,
    enabled: usesProgressActivity && !!outputFile && (expanded || isRunning),
    isRunning,
    skipAuthoritativeRead: !!outputFile && (outputFile.endsWith('chat_history.jsonl') || outputFile.endsWith('transcript.jsonl')),
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

  const hasJsonlTools = useMemo(() => jsonlEntries.some((e) => e.type === 'tool'), [jsonlEntries])
  const hasJsonlActivity = useMemo(() => jsonlEntries.some((e) => e.type === 'activity'), [jsonlEntries])
  const progressSummary = !hasJsonlActivity ? (progress?.summary ?? taskBlock.taskSummary) : undefined
  const activeTool = isRunning && !hasJsonlTools && activityHistory.length === 0 && progress?.lastToolName
    ? { toolName: progress.lastToolName, description: progress.description ?? '' }
    : undefined

  const activityContent = usesProgressActivity && hasActivity ? (
    <NestedToolContext.Provider value={{ defaultAutoExpand: false, allowExpand: false }}>
      <AgentActivity
        entries={jsonlEntries}
        fallbackTools={!hasJsonlTools ? activityHistory : undefined}
        activeTool={activeTool}
        isRunning={isRunning}
        summary={progressSummary}
        colors={colors}
      />
    </NestedToolContext.Provider>
  ) : undefined

  const childContent = childItems.length > 0 || deferred.status ? (
    <NestedToolContext.Provider value={{ defaultAutoExpand: false, allowExpand: false }}>
      <DeferredDetailStatus status={deferred.status} onRetry={deferred.retry} />
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
