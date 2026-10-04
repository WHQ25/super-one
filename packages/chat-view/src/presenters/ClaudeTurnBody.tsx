import { Fragment, useMemo, type ComponentType, type ReactNode } from 'react'
import { ImageIcon } from 'lucide-react'
import type { BashEditDiff, ContentBlock } from '@superone/shared/agent-types'
import type { ToolAppAttachment } from '@superone/shared/mcp-apps'
import {
  collapsibleItems,
  countVisibleClaudeProcessSegments,
  MIN_PROCESS_SEGMENTS_TO_COLLAPSE,
  partitionTurnForCompactMode,
  type ClaudeSegmentVisibilityOpts,
} from './compact-chat-mode'
import type { GroupContentResult, RenderSegment } from './groupContent'
import type { RunContinuation } from './run-display'
import { ModSite, useModMessageId } from '../mod-ui/react'
import { assistantMessageProps, stringProp, toolGroupProps, toolUseProps, type ToolCallFacts } from '../mod-ui/site-props'
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
  remoteDetail?: string
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
  /** Bash only: the working-tree diff the command produced, drawn as file rows under it. */
  bashEditDiff?: BashEditDiff
  autoExpand?: boolean
  /** Precomputed edit metadata; only remote surfaces receive these. */
  toolDiff?: string
  toolDiffTokens?: { added?: [string, string | null][][]; removed?: [string, string | null][][] }
  toolLineDelta?: { added: number; removed: number }
  /** `*_run` only: the resume calls folded into this block (groupContent `runContinuations`). */
  runContinuations?: RunContinuation[]
  /** The MCP App View this call rendered, when its server attached one. */
  app?: ToolAppAttachment
}

export interface ClaudeInsightPresenterProps {
  title: string
  content: string
  isStreaming: boolean
}

export interface ClaudeReasoningPresenterProps {
  remoteDetails?: string[]
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
  /**
   * Callout card for a pre-split `insight` block. Only remote surfaces receive one:
   * desktop keeps the `★ … ───` markers inside `text` and splits at render time.
   */
  Insight: ComponentType<ClaudeInsightPresenterProps>
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
    options: ClaudeSegmentVisibilityOpts & {
      isErrorTool?: (toolUseId: string) => boolean
      bashEditDiffAt?: (toolUseId: string) => BashEditDiff | undefined
    },
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
  bashEditDiffMap?: Map<string, BashEditDiff>
  toolAppMap?: Map<string, ToolAppAttachment>
  runContinuations?: GroupContentResult['runContinuations']
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
  bashEditDiffMap,
  toolAppMap,
  runContinuations,
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
  bashEditDiffMap?: Map<string, BashEditDiff>
  toolAppMap?: Map<string, ToolAppAttachment>
  runContinuations?: GroupContentResult['runContinuations']
  nextBlockType?: string
  prevBlockType?: string
  projectPath?: string | null
  parts: ClaudeTurnBodyPresenterParts
  runtime: ClaudeTurnBodyPresenterRuntime
}) {
  const { Text, Insight, Document, Tool, Reasoning } = parts
  switch (block.type) {
    case 'text':
      return (
        <AssistantTextSite index={index} text={block.text} isFirstOfReply={prevBlockType === undefined}>
          {(text) => (
            <Text
              text={text}
              isStreaming={isStreaming}
              projectPath={projectPath}
              afterThinking={prevBlockType === 'thinking'}
            />
          )}
        </AssistantTextSite>
      )
    case 'insight':
      return <Insight title={block.title} content={block.content} isStreaming={isStreaming} />
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
        <ToolUseSite call={toolCallFacts(block, toolResultMap, errorToolIds, isStreaming)} rawInput={block.input}>
          {(input) => (
        <Tool
          remoteDetail={block.remoteDetail}
          toolName={block.toolName}
          toolUseId={block.toolUseId}
          input={input}
          toolSummary={block.toolSummary}
          filePath={block.toolFilePath}
          status={!isStreaming && block.status === 'streaming' ? undefined : block.status}
          elapsedSeconds={block.elapsedSeconds}
          result={toolResultMap?.get(block.toolUseId)}
          isTimedOut={timedOutToolIds?.has(block.toolUseId)}
          isError={errorToolIds?.has(block.toolUseId)}
          resultOutputPath={outputPathMap?.get(block.toolUseId)}
          bashEditDiff={bashEditDiffMap?.get(block.toolUseId)}
          app={toolAppMap?.get(block.toolUseId) ?? block.app}
          autoExpand={runtime.isBackgroundTool(block) ? false : undefined}
          toolDiff={block.toolDiff}
          toolDiffTokens={block.toolDiffTokens}
          toolLineDelta={block.toolLineDelta}
          runContinuations={runContinuations?.get(block.toolUseId)?.map((later) => ({
            input: later.input,
            status: !isStreaming && later.status === 'streaming' ? undefined : later.status,
            elapsedSeconds: later.elapsedSeconds,
            result: toolResultMap?.get(later.toolUseId),
            isError: errorToolIds?.has(later.toolUseId),
          }))}
        />
          )}
        </ToolUseSite>
      )
    case 'thinking':
      return (
        <Reasoning
          remoteDetails={block.remoteDetail ? [block.remoteDetail] : undefined}
          text={block.thinking}
          startedAt={block.startedAt}
          endedAt={block.endedAt}
          blockDone={!isStreaming || !!nextBlockType}
          showContent={Boolean(block.remoteDetail) || block.thinking.trim().length > 0}
          isFirst={prevBlockType === undefined}
        />
      )
    // The phone's projection splits Bash and Todo results out of `tool_result`;
    // all three fold into the row above rather than printing a block of their own.
    case 'tool_result':
    case 'bash_result':
    case 'todo_result':
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
      return renderBlocks(segment.blocks, segment.startIndex, options)
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
          remoteDetails={segment.blocks.some(block => block.remoteDetail) ? segment.blocks.flatMap(block => block.remoteDetail ? [block.remoteDetail] : []) : undefined}
          text={text}
          startedAt={first.type === 'thinking' ? first.startedAt : undefined}
          endedAt={last.type === 'thinking' ? last.endedAt : undefined}
          blockDone={sealed}
          showContent={segment.blocks.some(block => block.remoteDetail) || text.trim().length > 0}
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
          bashEditDiffMap={options.bashEditDiffMap}
          toolAppMap={options.toolAppMap}
          runContinuations={options.runContinuations}
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
        <ToolGroupSite
          key={`tg-${segment.startIndex}`}
          calls={segment.blocks.flatMap((b) => b.type === 'tool_use' ? [toolCallFacts(b, options.toolResultMap, options.errorToolIds, options.isStreaming)] : [])}
          isActive={!sealed}
          expanded={() => renderBlocks(segment.blocks, segment.startIndex, options)}
        >
          <parts.ToolGroup blocks={segment.blocks} sealed={sealed} />
        </ToolGroupSite>
      )
    }
    return renderBlocks(segment.blocks, segment.startIndex, options)
  })
}

function renderBlocks(blocks: ContentBlock[], startIndex: number, options: RenderOptions): ReactNode[] {
  return blocks.map((block, blockIndex) => (
    <ClaudeBlockPresenter
      key={startIndex + blockIndex}
      block={block}
      index={startIndex + blockIndex}
      isStreaming={options.isStreaming}
      toolResultMap={options.toolResultMap}
      timedOutToolIds={options.timedOutToolIds}
      errorToolIds={options.errorToolIds}
      outputPathMap={options.outputPathMap}
      bashEditDiffMap={options.bashEditDiffMap}
      toolAppMap={options.toolAppMap}
      runContinuations={options.runContinuations}
      nextBlockType={blocks[blockIndex + 1]?.type}
      prevBlockType={blocks[blockIndex - 1]?.type}
      projectPath={options.projectPath}
      parts={options.parts}
      runtime={options.runtime}
    />
  ))
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
    bashEditDiffMap: grouped.bashEditDiffMap,
    toolAppMap: grouped.toolAppMap,
    runContinuations: grouped.runContinuations,
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
      bashEditDiffAt: (id: string) => grouped.bashEditDiffMap?.get(id),
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

function parseToolInput(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

function toolCallFacts(
  block: ContentBlock & { type: 'tool_use' },
  toolResultMap: Map<string, string> | undefined,
  errorToolIds: Set<string> | undefined,
  isStreaming: boolean,
): ToolCallFacts {
  const output = toolResultMap?.get(block.toolUseId)
  return {
    toolUseId: block.toolUseId,
    tool: block.toolName,
    input: block.input,
    isRunning: isStreaming && block.status === 'streaming',
    isErrored: errorToolIds?.has(block.toolUseId) ?? false,
    isInterrupted: false,
    ...(output === undefined ? {} : { output }),
  }
}

/** One assistant text block as a mod site (needs the message's id from `ModMessageScope`). */
function AssistantTextSite({ index, text, isFirstOfReply, children }: { index: number; text: string; isFirstOfReply: boolean; children: (text: string) => ReactNode }) {
  const messageId = useModMessageId()
  const props = useMemo(() => assistantMessageProps(text, isFirstOfReply), [text, isFirstOfReply])
  if (!messageId) return <>{children(text)}</>
  return (
    <ModSite component="AssistantMessage" instanceId={`${messageId}:${index}`} props={props}>
      {(p) => children(stringProp(p, 'text', text))}
    </ModSite>
  )
}

/** A tool row as a mod site; its instance is the call's `tool_use_id`, as the CLI expects. */
function ToolUseSite({ call, rawInput, children }: { call: ToolCallFacts; rawInput: string; children: (input: string) => ReactNode }) {
  const { toolUseId, tool, isRunning, isErrored, output } = call
  const props = useMemo(
    () => toolUseProps({ toolUseId, tool, input: parseToolInput(rawInput), isRunning, isErrored, isInterrupted: false, output }),
    [toolUseId, tool, rawInput, isRunning, isErrored, output],
  )
  return (
    <ModSite component="ToolUse" instanceId={toolUseId} props={props}>
      {(p) => children(p === props || p.input === undefined ? rawInput : JSON.stringify(p.input))}
    </ModSite>
  )
}

/** A folded run of tool calls; a plugin that sets `isExpanded` unfolds it into rows. */
function ToolGroupSite({ calls, isActive, expanded, children }: { calls: ToolCallFacts[]; isActive: boolean; expanded: () => ReactNode; children: ReactNode }) {
  const key = calls.map((c) => `${c.toolUseId}:${c.isRunning ? 1 : 0}:${c.isErrored ? 1 : 0}:${c.output === undefined ? 0 : 1}`).join('|')
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` covers what the props carry
  const props = useMemo(() => toolGroupProps(calls.map((c) => ({ ...c, input: parseToolInput(c.input as string) })), isActive, false), [key, isActive])
  const first = calls[0]?.toolUseId
  if (!first) return <>{children}</>
  return (
    <ModSite component="ToolGroup" instanceId={first} props={props}>
      {(p) => (p.isExpanded === true ? <>{expanded()}</> : children)}
    </ModSite>
  )
}
