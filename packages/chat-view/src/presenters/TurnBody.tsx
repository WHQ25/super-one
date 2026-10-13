import { TranscriptStateScope } from '@superone/ui/lib/transcript-state'
import { Fragment, useMemo, type ComponentType, type ReactNode } from 'react'
import { ImageIcon } from 'lucide-react'
import type { BashEditDiff, CodexPlanApprovalState, ContentBlock } from '@superone/shared/agent-types'
import type { ToolAppAttachment } from '@superone/shared/mcp-apps'
import type { SuggestedTaskState } from '@superone/shared/suggested-task'
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
import { renderTurnSegments, type TurnSegmentProps } from './turn-segments'
import { ReviewMarkerPresenter, TurnNoticePresenter } from './TurnMarkers'
import { assistantMessageProps, stringProp, toolGroupProps, toolUseProps, type ToolCallFacts } from '../mod-ui/site-props'
import type { TurnProcessStats } from './turn-process-stats'

/** One rendered run of a turn — see `partitionTurnForCompactMode`. */
export interface TurnDetailRun {
  key: string
  /** Collapsible runs hide behind the shared Detail toggle; pinned runs always render. */
  collapsible: boolean
  content: ReactNode
}

export interface TurnDetailPresenterProps {
  runs: TurnDetailRun[]
  stats?: TurnProcessStats
  workingSince?: string | number
  turnId?: string
  showIndicator?: boolean
}

export interface TurnTextPresenterProps {
  text: string
  isStreaming: boolean
  projectPath?: string | null
  afterThinking?: boolean
  /** The transcript segment this text opens, as the host's navigation target. */
  anchorId?: string
}

export interface TurnDocumentPresenterProps {
  name: string
}

export interface TurnToolPresenterProps {
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
  /** `session_suggest_task` only: the card's outcome. */
  suggestedTask?: SuggestedTaskState
  /** A running command's output so far; the result replaces it. */
  liveOutput?: string
  /** A command's process exit code (non-zero is an outcome, not a tool error). */
  exitCode?: number
  /** An MCP call that needs the user to sign in to its server. */
  authRequired?: boolean
}

/** How the user answers the turn's latest plan, when the host offers it. */
export interface TurnPlanApproval {
  state?: CodexPlanApprovalState
  canRespond: boolean
  onApprove?: () => void
  onReject?: (feedback?: string) => void
}

export interface TurnPlanPresenterProps {
  id: string
  text: string
  isStreaming: boolean
  hasFollowingBlock: boolean
  /** Set on the turn's latest plan only. */
  approval?: TurnPlanApproval
}

export interface TurnInsightPresenterProps {
  title: string
  content: string
  isStreaming: boolean
}

export interface TurnReasoningPresenterProps {
  remoteDetails?: string[]
  text: string
  startedAt?: number
  endedAt?: number
  blockDone: boolean
  showContent?: boolean
  isFirst?: boolean
}

export interface TurnSubagentPresenterProps {
  taskBlock: ContentBlock & { type: 'tool_use' }
  childBlocks: ContentBlock[]
  resultBlock?: ContentBlock
  isStreaming: boolean
}

export interface TurnWorkflowPresenterProps {
  toolBlock: ContentBlock & { type: 'tool_use' }
  resultBlock?: ContentBlock
  isStreaming: boolean
}

export interface TurnToolGroupPresenterProps {
  blocks: ContentBlock[]
  sealed: boolean
}

export interface TurnAppToolGroupPresenterProps extends TurnToolGroupPresenterProps {
  appId: string
}

export interface TurnBodyPresenterParts {
  /** Hosts with a transcript viewport can evict offscreen activity chunks. */
  Segment?: ComponentType<TurnSegmentProps>
  Text: ComponentType<TurnTextPresenterProps>
  /**
   * Callout card for a pre-split `insight` block. Only remote surfaces receive one:
   * desktop keeps the `★ … ───` markers inside `text` and splits at render time.
   */
  Insight: ComponentType<TurnInsightPresenterProps>
  Document: ComponentType<TurnDocumentPresenterProps>
  Tool: ComponentType<TurnToolPresenterProps>
  Reasoning: ComponentType<TurnReasoningPresenterProps>
  Subagent: ComponentType<TurnSubagentPresenterProps>
  Workflow: ComponentType<TurnWorkflowPresenterProps>
  Plan: ComponentType<TurnPlanPresenterProps>
  ToolGroup: ComponentType<TurnToolGroupPresenterProps>
  AppToolGroup: ComponentType<TurnAppToolGroupPresenterProps>
  TurnDetail: ComponentType<TurnDetailPresenterProps>
}

export interface TurnBodyPresenterRuntime {
  isBackgroundTool: (block: ContentBlock & { type: 'tool_use' }) => boolean
  isPinnedSegment: (segment: RenderSegment) => boolean
  isHiddenTool: (toolName: string, result?: string) => boolean
  summarizeProcess: (
    segments: ReadonlyArray<RenderSegment>,
    options: ClaudeSegmentVisibilityOpts & {
      isErrorTool?: (toolUseId: string) => boolean
      bashEditDiffAt?: (toolUseId: string) => BashEditDiff | undefined
    },
  ) => TurnProcessStats
}

export interface TurnBodyPresenterProps {
  grouped: GroupContentResult
  isStreaming: boolean
  detailChatMode: boolean
  projectPath: string | null
  parts: TurnBodyPresenterParts
  runtime: TurnBodyPresenterRuntime
  /** Approval for the turn's latest plan block. */
  planApproval?: TurnPlanApproval
  /** Transcript segments opening inside this turn, by their first block (see `transcriptView`). */
  anchors?: ReadonlyMap<ContentBlock, string>
  /** Whole-turn process statistics and disclosure identity for a sliced transcript row. */
  compactTurn?: { grouped: GroupContentResult; following?: GroupContentResult; id: string; showIndicator: boolean }
}

interface RenderOptions {
  isStreaming: boolean
  forceSealed: boolean
  toolResultMap: Map<string, string>
  timedOutToolIds: Set<string>
  errorToolIds: Set<string>
  outputPathMap: Map<string, string>
  bashEditDiffMap?: Map<string, BashEditDiff>
  exitCodeMap?: Map<string, number>
  toolAppMap?: Map<string, ToolAppAttachment>
  runContinuations?: GroupContentResult['runContinuations']
  latestPlan?: LatestPlan
  anchors?: ReadonlyMap<ContentBlock, string>
  projectPath: string | null
  parts: TurnBodyPresenterParts
  runtime: TurnBodyPresenterRuntime
}

interface LatestPlan {
  id: string
  approval?: TurnPlanApproval
}

const runRange = (run: { start: number; items: unknown[] }) => ({
  start: run.start,
  end: run.start + run.items.length,
})

export function TurnBlockPresenter({
  block,
  index,
  isStreaming,
  toolResultMap,
  timedOutToolIds,
  errorToolIds,
  outputPathMap,
  bashEditDiffMap,
  exitCodeMap,
  toolAppMap,
  runContinuations,
  latestPlan,
  nextBlockType,
  prevBlockType,
  anchorId,
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
  exitCodeMap?: Map<string, number>
  toolAppMap?: Map<string, ToolAppAttachment>
  latestPlan?: LatestPlan
  runContinuations?: GroupContentResult['runContinuations']
  nextBlockType?: string
  prevBlockType?: string
  anchorId?: string
  projectPath?: string | null
  parts: TurnBodyPresenterParts
  runtime: TurnBodyPresenterRuntime
}) {
  const { Text, Insight, Document, Tool, Reasoning, Plan } = parts
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
              anchorId={anchorId}
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
          suggestedTask={block.suggestedTask}
          liveOutput={block.liveOutput}
          exitCode={exitCodeMap?.get(block.toolUseId)}
          authRequired={block.authRequired}
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
    case 'plan':
      return (
        <Plan
          id={block.id}
          text={block.text}
          isStreaming={isStreaming}
          hasFollowingBlock={nextBlockType !== undefined}
          approval={latestPlan?.id === block.id ? latestPlan.approval : undefined}
        />
      )
    case 'review':
      return <ReviewMarkerPresenter block={block} />
    case 'notice':
      return <TurnNoticePresenter block={block} />
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
  const sliced = segments.slice(from, to)
  const rendered = sliced.map((segment, index) => {
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
        <TurnBlockPresenter
          key={segment.index}
          block={segment.block}
          index={segment.index}
          isStreaming={options.isStreaming}
          toolResultMap={options.toolResultMap}
          timedOutToolIds={options.timedOutToolIds}
          errorToolIds={options.errorToolIds}
          outputPathMap={options.outputPathMap}
          bashEditDiffMap={options.bashEditDiffMap}
          exitCodeMap={options.exitCodeMap}
          toolAppMap={options.toolAppMap}
          runContinuations={options.runContinuations}
          latestPlan={options.latestPlan}
          nextBlockType={nextType}
          prevBlockType={previousType}
          anchorId={options.anchors?.get(segment.block)}
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
  const contents = rendered.map((content, index) => {
    const segment = segments[from + index]
    const id = segment.kind === 'block' ? segment.index : segment.startIndex
    return <TranscriptStateScope key={id} id={`claude-${id}`}>{content}</TranscriptStateScope>
  })
  return renderTurnSegments(sliced, contents, options.parts.Segment, segment => {
    const index = segment.kind === 'block' ? segment.index : segment.startIndex
    const text = segment.kind === 'block' && segment.block.type === 'text' ? segment.block.text : ''
    return { id: `claude-${index}`, estimate: text ? Math.max(32, Math.ceil(text.length / 60) * 24 + 12) : 48 }
  })
}

function renderBlocks(blocks: ContentBlock[], startIndex: number, options: RenderOptions): ReactNode[] {
  return blocks.map((block, blockIndex) => (
    <TurnBlockPresenter
      key={startIndex + blockIndex}
      block={block}
      index={startIndex + blockIndex}
      isStreaming={options.isStreaming}
      toolResultMap={options.toolResultMap}
      timedOutToolIds={options.timedOutToolIds}
      errorToolIds={options.errorToolIds}
      outputPathMap={options.outputPathMap}
      bashEditDiffMap={options.bashEditDiffMap}
      exitCodeMap={options.exitCodeMap}
      toolAppMap={options.toolAppMap}
      runContinuations={options.runContinuations}
      latestPlan={options.latestPlan}
      nextBlockType={blocks[blockIndex + 1]?.type}
      prevBlockType={blocks[blockIndex - 1]?.type}
      projectPath={options.projectPath}
      parts={options.parts}
      runtime={options.runtime}
    />
  ))
}

export function TurnBodyPresenter({
  grouped,
  isStreaming,
  detailChatMode,
  projectPath,
  parts,
  runtime,
  planApproval,
  anchors,
  compactTurn,
}: TurnBodyPresenterProps) {
  const segments = grouped.segments
  const latestPlanId = useMemo(() => {
    for (let i = segments.length - 1; i >= 0; i--) {
      const segment = segments[i]
      if (segment.kind === 'block' && segment.block.type === 'plan') return segment.block.id
    }
    return undefined
  }, [segments])
  const options: RenderOptions = {
    isStreaming,
    forceSealed: false,
    toolResultMap: grouped.toolResultMap,
    timedOutToolIds: grouped.timedOutToolIds,
    errorToolIds: grouped.errorToolIds,
    outputPathMap: grouped.outputPathMap,
    bashEditDiffMap: grouped.bashEditDiffMap,
    exitCodeMap: grouped.exitCodeMap,
    toolAppMap: grouped.toolAppMap,
    runContinuations: grouped.runContinuations,
    ...(latestPlanId ? { latestPlan: { id: latestPlanId, approval: planApproval } } : {}),
    anchors,
    projectPath,
    parts,
    runtime,
  }
  if (!detailChatMode && !isStreaming) {
    const runs = partitionTurnForCompactMode(segments, runtime.isPinnedSegment,
      compactTurn?.following?.segments.some(runtime.isPinnedSegment),
      compactTurn?.grouped.segments.some(runtime.isPinnedSegment))
    const processGrouped = compactTurn?.grouped ?? grouped
    const processOptions = {
      toolResultAt: (id: string) => processGrouped.toolResultMap.get(id),
      isHiddenTool: runtime.isHiddenTool,
      isErrorTool: (id: string) => processGrouped.errorToolIds.has(id),
      bashEditDiffAt: (id: string) => processGrouped.bashEditDiffMap?.get(id),
    }
    const process = collapsibleItems(compactTurn
      ? partitionTurnForCompactMode(processGrouped.segments, runtime.isPinnedSegment) : runs)
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
        turnId={compactTurn?.id}
        showIndicator={compactTurn?.showIndicator}
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
