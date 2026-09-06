import { Fragment, type ComponentType, type ReactNode } from 'react'
import { ImageIcon } from 'lucide-react'
import type { ContentBlock } from '@superone/shared/agent-types'
import {
  collapsibleItems,
  countVisibleClaudeProcessSegments,
  MIN_PROCESS_SEGMENTS_TO_COLLAPSE,
  partitionTurnForCompactMode,
  type ClaudeSegmentVisibilityOpts,
} from './compact-chat-mode'
import type { GroupContentResult, RenderSegment } from './groupContent'
import type {
  CodexTurnDetailPresenterProps,
  CodexTurnProcessStats,
} from './CodexTurnView'

export interface ClaudeTextPresenterProps {
  text: string
  isStreaming: boolean
  projectPath?: string | null
  afterThinking?: boolean
}

export interface ClaudeDocumentPresenterProps {
  name: string
}

export interface ClaudeToolPresenterProps {
  toolName: string
  toolUseId?: string
  input: string
  toolSummary?: string
  filePath?: string
  status?: 'streaming' | 'complete'
  elapsedSeconds?: number
  result?: string
  isTimedOut?: boolean
  isError?: boolean
  resultOutputPath?: string
  autoExpand?: boolean
  /** Precomputed edit metadata; only remote surfaces receive these. */
  toolDiff?: string
  toolDiffTokens?: { added?: [string, string | null][][]; removed?: [string, string | null][][] }
  toolLineDelta?: { added: number; removed: number }
}

export interface ClaudeReasoningPresenterProps {
  text: string
  startedAt?: number
  endedAt?: number
  blockDone: boolean
  showContent?: boolean
  isFirst?: boolean
}

export interface ClaudeSubagentPresenterProps {
  taskBlock: ContentBlock & { type: 'tool_use' }
  childBlocks: ContentBlock[]
  resultBlock?: ContentBlock
  isStreaming: boolean
}

export interface ClaudeWorkflowPresenterProps {
  toolBlock: ContentBlock & { type: 'tool_use' }
  resultBlock?: ContentBlock
  isStreaming: boolean
}

export interface ClaudeToolGroupPresenterProps {
  blocks: ContentBlock[]
  sealed: boolean
}

export interface ClaudeAppToolGroupPresenterProps extends ClaudeToolGroupPresenterProps {
  appId: string
}

export interface ClaudeTurnBodyPresenterParts {
  Text: ComponentType<ClaudeTextPresenterProps>
  Document: ComponentType<ClaudeDocumentPresenterProps>
  Tool: ComponentType<ClaudeToolPresenterProps>
  Reasoning: ComponentType<ClaudeReasoningPresenterProps>
  Subagent: ComponentType<ClaudeSubagentPresenterProps>
  Workflow: ComponentType<ClaudeWorkflowPresenterProps>
  ToolGroup: ComponentType<ClaudeToolGroupPresenterProps>
  AppToolGroup: ComponentType<ClaudeAppToolGroupPresenterProps>
  TurnDetail: ComponentType<CodexTurnDetailPresenterProps>
}

export interface ClaudeTurnBodyPresenterRuntime {
  isBackgroundTool: (block: ContentBlock & { type: 'tool_use' }) => boolean
  isPinnedSegment: (segment: RenderSegment) => boolean
  isHiddenTool: (toolName: string, result?: string) => boolean
  summarizeProcess: (
    segments: ReadonlyArray<RenderSegment>,
    options: ClaudeSegmentVisibilityOpts & { isErrorTool?: (toolUseId: string) => boolean },
  ) => CodexTurnProcessStats
}

export interface ClaudeTurnBodyPresenterProps {
  grouped: GroupContentResult
  isStreaming: boolean
  detailChatMode: boolean
  projectPath: string | null
  parts: ClaudeTurnBodyPresenterParts
  runtime: ClaudeTurnBodyPresenterRuntime
}

interface RenderOptions {
  isStreaming: boolean
  forceSealed: boolean
  toolResultMap: Map<string, string>
  timedOutToolIds: Set<string>
  errorToolIds: Set<string>
  outputPathMap: Map<string, string>
  projectPath: string | null
  parts: ClaudeTurnBodyPresenterParts
  runtime: ClaudeTurnBodyPresenterRuntime
}

const runRange = (run: { start: number; items: unknown[] }) => ({
  start: run.start,
  end: run.start + run.items.length,
})

export function ClaudeBlockPresenter({
  block,
  index,
  isStreaming,
  toolResultMap,
  timedOutToolIds,
  errorToolIds,
  outputPathMap,
  nextBlockType,
  prevBlockType,
  projectPath,
  parts,
  runtime,
}: {
  block: ContentBlock
  index: number
  isStreaming: boolean
  toolResultMap?: Map<string, string>
  timedOutToolIds?: Set<string>
  errorToolIds?: Set<string>
  outputPathMap?: Map<string, string>
  nextBlockType?: string
  prevBlockType?: string
  projectPath?: string | null
  parts: ClaudeTurnBodyPresenterParts
  runtime: ClaudeTurnBodyPresenterRuntime
}) {
  const { Text, Document, Tool, Reasoning } = parts
  switch (block.type) {
    case 'text':
      return (
        <Text
          text={block.text}
          isStreaming={isStreaming}
          projectPath={projectPath}
          afterThinking={prevBlockType === 'thinking'}
        />
      )
    case 'image':
      return (
        <div className="my-1 flex items-center gap-1.5 rounded bg-muted/50 px-2 py-1 text-xs text-foreground">
          <ImageIcon className="size-3 shrink-0" />
          <span className="truncate">{block.name}</span>
        </div>
      )
    case 'document':
      return (
        <div className="my-1 flex items-center gap-1.5 rounded bg-muted/50 px-2 py-1 text-xs text-foreground">
          <Document name={block.name} />
          <span className="truncate">{block.name}</span>
        </div>
      )
    case 'tool_use':
      return (
        <Tool
          toolName={block.toolName}
          toolUseId={block.toolUseId}
          input={block.input}
          toolSummary={block.toolSummary}
          filePath={block.toolFilePath}
          status={!isStreaming && block.status === 'streaming' ? undefined : block.status}
          elapsedSeconds={block.elapsedSeconds}
          result={toolResultMap?.get(block.toolUseId)}
          isTimedOut={timedOutToolIds?.has(block.toolUseId)}
          isError={errorToolIds?.has(block.toolUseId)}
          resultOutputPath={outputPathMap?.get(block.toolUseId)}
          autoExpand={runtime.isBackgroundTool(block) ? false : undefined}
          toolDiff={block.toolDiff}
          toolDiffTokens={block.toolDiffTokens}
          toolLineDelta={block.toolLineDelta}
        />
      )
    case 'thinking':
      return (
        <Reasoning
          text={block.thinking}
          startedAt={block.startedAt}
          endedAt={block.endedAt}
          blockDone={!isStreaming || !!nextBlockType}
          showContent={block.thinking.trim().length > 0}
          isFirst={prevBlockType === undefined}
        />
      )
    case 'tool_result':
      if (toolResultMap?.has(block.toolUseId) || !block.summary) return null
      return (
        <div className="my-0.5 overflow-x-auto whitespace-pre-wrap rounded bg-muted/50 px-2 py-1.5 font-mono text-xs leading-relaxed text-muted-foreground">
          {block.summary}
        </div>
      )
  }
}

function renderSegments(
  segments: RenderSegment[],
  options: RenderOptions,
  range?: { start: number; end: number },
): ReactNode[] {
  const from = range?.start ?? 0
  const to = range?.end ?? segments.length
  return segments.slice(from, to).map((segment, index) => {
    const segmentIndex = from + index
    const sealed = options.forceSealed
      || !options.isStreaming
      || segmentIndex < segments.length - 1
    const { parts } = options
    if (segment.kind === 'subagent') {
      return (
        <parts.Subagent
          key={`sa-${segment.startIndex}`}
          taskBlock={segment.taskBlock}
          childBlocks={segment.childBlocks}
          resultBlock={segment.resultBlock}
          isStreaming={options.isStreaming}
        />
      )
    }
    if (segment.kind === 'workflow') {
      return (
        <parts.Workflow
          key={`wf-${segment.startIndex}`}
          toolBlock={segment.toolBlock}
          resultBlock={segment.resultBlock}
          isStreaming={options.isStreaming}
        />
      )
    }
    if (segment.kind === 'app-tools') {
      const toolUseCount = segment.blocks.filter((block) => block.type === 'tool_use').length
      if (toolUseCount > 1) {
        return (
          <parts.AppToolGroup
            key={`atg-${segment.startIndex}`}
            appId={segment.appId}
            blocks={segment.blocks}
            sealed={sealed}
          />
        )
      }
      return segment.blocks.map((block, blockIndex) => (
        <ClaudeBlockPresenter
          key={segment.startIndex + blockIndex}
          block={block}
          index={segment.startIndex + blockIndex}
          isStreaming={options.isStreaming}
          toolResultMap={options.toolResultMap}
          timedOutToolIds={options.timedOutToolIds}
          errorToolIds={options.errorToolIds}
          outputPathMap={options.outputPathMap}
          nextBlockType={segment.blocks[blockIndex + 1]?.type}
          prevBlockType={segment.blocks[blockIndex - 1]?.type}
          projectPath={options.projectPath}
          parts={parts}
          runtime={options.runtime}
        />
      ))
    }
    if (segment.kind === 'thinking') {
      const text = segment.blocks
        .map((block) => block.type === 'thinking' ? block.thinking : '')
        .join('\n\n')
      const first = segment.blocks[0]
      const last = segment.blocks[segment.blocks.length - 1]
      return (
        <parts.Reasoning
          key={`th-${segment.startIndex}`}
          text={text}
          startedAt={first.type === 'thinking' ? first.startedAt : undefined}
          endedAt={last.type === 'thinking' ? last.endedAt : undefined}
          blockDone={sealed}
          showContent={text.trim().length > 0}
          isFirst={segmentIndex === 0}
        />
      )
    }
    if (segment.kind === 'block') {
      const nextSegment = segments[segmentIndex + 1]
      const previousSegment = segments[segmentIndex - 1]
      const nextType = nextSegment?.kind === 'block'
        ? nextSegment.block.type
        : nextSegment?.kind === 'thinking'
          ? 'thinking'
          : nextSegment?.kind === 'tools'
            ? nextSegment.blocks[0]?.type
            : nextSegment?.kind === 'subagent'
              ? 'tool_use'
              : undefined
      const previousType = previousSegment?.kind === 'block'
        ? previousSegment.block.type
        : previousSegment?.kind === 'thinking'
          ? 'thinking'
          : undefined
      return (
        <ClaudeBlockPresenter
          key={segment.index}
          block={segment.block}
          index={segment.index}
          isStreaming={options.isStreaming}
          toolResultMap={options.toolResultMap}
          timedOutToolIds={options.timedOutToolIds}
          errorToolIds={options.errorToolIds}
          outputPathMap={options.outputPathMap}
          nextBlockType={nextType}
          prevBlockType={previousType}
          projectPath={options.projectPath}
          parts={parts}
          runtime={options.runtime}
        />
      )
    }
    const toolUseCount = segment.blocks.filter((block) => block.type === 'tool_use').length
    if (toolUseCount > 1) {
      return (
        <parts.ToolGroup
          key={`tg-${segment.startIndex}`}
          blocks={segment.blocks}
          sealed={sealed}
        />
      )
    }
    return segment.blocks.map((block, blockIndex) => (
      <ClaudeBlockPresenter
        key={segment.startIndex + blockIndex}
        block={block}
        index={segment.startIndex + blockIndex}
        isStreaming={options.isStreaming}
        toolResultMap={options.toolResultMap}
        timedOutToolIds={options.timedOutToolIds}
        errorToolIds={options.errorToolIds}
        outputPathMap={options.outputPathMap}
        nextBlockType={segment.blocks[blockIndex + 1]?.type}
        prevBlockType={segment.blocks[blockIndex - 1]?.type}
        projectPath={options.projectPath}
        parts={parts}
        runtime={options.runtime}
      />
    ))
  })
}

export function ClaudeTurnBodyPresenter({
  grouped,
  isStreaming,
  detailChatMode,
  projectPath,
  parts,
  runtime,
}: ClaudeTurnBodyPresenterProps) {
  const segments = grouped.segments
  const options: RenderOptions = {
    isStreaming,
    forceSealed: false,
    toolResultMap: grouped.toolResultMap,
    timedOutToolIds: grouped.timedOutToolIds,
    errorToolIds: grouped.errorToolIds,
    outputPathMap: grouped.outputPathMap,
    projectPath,
    parts,
    runtime,
  }
  if (!detailChatMode && !isStreaming) {
    const runs = partitionTurnForCompactMode(segments, runtime.isPinnedSegment)
    const processOptions = {
      toolResultAt: (id: string) => grouped.toolResultMap.get(id),
      isHiddenTool: runtime.isHiddenTool,
      isErrorTool: (id: string) => grouped.errorToolIds.has(id),
    }
    const process = collapsibleItems(runs)
    const visibleCount = countVisibleClaudeProcessSegments(process, processOptions)
    const sealedOptions = { ...options, forceSealed: true }
    if (visibleCount === 0) return <>{renderSegments(segments, sealedOptions)}</>
    if (visibleCount < MIN_PROCESS_SEGMENTS_TO_COLLAPSE) {
      return (
        <>
          {runs.map((run, index) => run.collapsible ? (
            <div key={`run-${index}`} className="turn-process">
              {renderSegments(segments, sealedOptions, runRange(run))}
            </div>
          ) : (
            <Fragment key={`run-${index}`}>
              {renderSegments(segments, sealedOptions, runRange(run))}
            </Fragment>
          ))}
        </>
      )
    }
    return (
      <parts.TurnDetail
        stats={runtime.summarizeProcess(process, processOptions)}
        runs={runs.map((run, index) => ({
          key: `run-${index}`,
          collapsible: run.collapsible,
          content: renderSegments(segments, sealedOptions, runRange(run)),
        }))}
      />
    )
  }
  return renderSegments(segments, options)
}
