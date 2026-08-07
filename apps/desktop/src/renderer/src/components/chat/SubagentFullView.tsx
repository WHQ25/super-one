import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Bot, ArrowUp, ArrowDown, Wrench, Check, Loader2, TriangleAlert, CircleSlash } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import { Streamdown } from 'streamdown'
import type { ContentBlock, ChatMessage } from '@superone/shared/agent-types'
import { useActiveSession } from '@/stores/chat'
import { useSubagentNavigation, type SubagentViewState } from './subagent-navigation-context'
import { getSubagentColorClasses, type SubagentColorClasses } from './subagent-colors'
import { ToolBlock } from './ToolBlock'
import { AsyncToolRow, renderJsonlEntry } from './subagent-activity'
import { NestedToolContext } from './nested-tool-context'
import {
  parseTaskInput,
  parseSubagentIdFromText,
  looksLikeBackgroundSubagentAck,
  resolveTaskProgressEntry,
  buildToolResultMap,
  buildToolErrorMaps,
  collectSubagentSubtree,
  groupSubagentChildren,
  type ToolErrorMaps,
  type JsonlEntry,
} from './subagent-utils'
import { SubagentBlock } from './SubagentBlock'
import { useSubagentJsonl } from './use-subagent-jsonl'
import {
  streamdownPlugins,
  streamdownRehypePlugins,
  streamdownControls,
  streamdownComponents,
  streamdownLinkSafety,
  formatTokens,
} from './chat-shared'

const ZERO_TOKENS = { input: 0, output: 0 }
const EMPTY_BLOCKS: ContentBlock[] = []

interface SubagentSegment {
  taskBlock: ContentBlock & { type: 'tool_use' }
  childBlocks: ContentBlock[]
  resultBlock?: ContentBlock & { type: 'tool_result' }
}

function findSubagentSegment(messages: ChatMessage[], toolUseId: string): SubagentSegment | null {
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue
    let taskBlock: (ContentBlock & { type: 'tool_use' }) | null = null
    for (const b of msg.content) {
      if (b.type === 'tool_use' && b.toolUseId === toolUseId) {
        taskBlock = b
        break
      }
    }
    if (!taskBlock) continue
    const childBlocks = collectSubagentSubtree(msg.content, toolUseId)
    let resultBlock: (ContentBlock & { type: 'tool_result' }) | undefined
    for (const b of msg.content) {
      if (b.type === 'tool_result' && b.toolUseId === toolUseId) { resultBlock = b; break }
    }
    return { taskBlock, childBlocks, resultBlock }
  }
  return null
}

export function SubagentFullView({ view }: { view: SubagentViewState }) {
  const { t } = useTranslation()
  const nav = useSubagentNavigation()
  const messages = useActiveSession((s) => s.messages)
  const tokens = useActiveSession((s) => s.subagentTokens[view.toolUseId] ?? ZERO_TOKENS)
  const colorIdx = useActiveSession((s) => s.subagentColors[view.toolUseId])
  const colors = useMemo(() => getSubagentColorClasses(colorIdx), [colorIdx])

  const segment = useMemo(() => findSubagentSegment(messages, view.toolUseId), [messages, view.toolUseId])
  const taskInput = useMemo(() => (segment ? parseTaskInput(segment.taskBlock.input) : null), [segment])
  const childBlocks = segment?.childBlocks ?? EMPTY_BLOCKS
  const toolResultMap = useMemo(() => buildToolResultMap(childBlocks), [childBlocks])
  const toolErrorMaps = useMemo(() => buildToolErrorMaps(childBlocks), [childBlocks])
  const childItems = useMemo(() => groupSubagentChildren(childBlocks, view.toolUseId), [childBlocks, view.toolUseId])
  const syncToolCount = useMemo(
    () => childItems.reduce((n, item) => (item.kind === 'subagent' || item.block.type === 'tool_use' ? n + 1 : n), 0),
    [childItems],
  )

  const rawResultText = segment?.resultBlock?.summary
  const taskIdHint = useMemo(
    () => parseSubagentIdFromText(rawResultText) ?? parseSubagentIdFromText(segment?.taskBlock.taskResultText),
    [rawResultText, segment?.taskBlock.taskResultText],
  )
  const progress = useActiveSession((s) =>
    resolveTaskProgressEntry(s.taskProgress, view.toolUseId, taskIdHint),
  )
  const looksLikeBgAck = looksLikeBackgroundSubagentAck(rawResultText)
  const isAsync = (taskInput?.runInBackground ?? false) || looksLikeBgAck
  // Tool activity arrives either as inline childBlocks (ordinary nested calls) or
  // via the task_progress/JSONL channel when the agent ran in its own session
  // (background agents AND workflow-spawned parallel agents, which are NOT
  // run_in_background yet have no inline blocks). Mirror SubagentBlock: with no
  // inline children, surface the progress channel — else a nested non-async agent
  // shows an empty body with its tools hidden in the full view.
  const usesProgressActivity = childItems.length === 0
  const asyncOutputPath = useMemo(() => rawResultText?.match(/output_file:\s*(\S+)/)?.[1], [rawResultText])
  const outputFile = asyncOutputPath ?? progress?.outputFile
  const isRunning = progress
    ? !progress.completed
    : (isAsync ? !segment?.taskBlock.taskResultText : !segment?.resultBlock)

  const { entries: jsonlEntries, resultText: jsonlResultText } = useSubagentJsonl({
    toolUseId: view.toolUseId,
    taskResultText: segment?.taskBlock.taskResultText,
    outputFile,
    enabled: usesProgressActivity,
    isRunning,
  })

  if (!segment || !taskInput) {
    return (
      <ViewShell colors={colors} title={t('chat.subagent.notFound', 'Subagent not found')} onClose={nav.close}>
        <div className="px-3 py-3 text-xs text-muted-foreground">
          {t('chat.subagent.notFound', 'Subagent not found')}
        </div>
      </ViewShell>
    )
  }

  // task_progress is live store state and is lost on history reload; the same
  // history/usage is persisted onto the Agent block (taskToolHistory/taskUsage).
  // Prefer live, fall back to persisted so a reloaded session still renders activity.
  const activityHistory = (progress?.toolHistory?.length ? progress.toolHistory : segment.taskBlock.taskToolHistory) ?? []
  const asyncEntries: JsonlEntry[] = jsonlEntries.length > 0
    ? jsonlEntries
    : activityHistory.map((tool) => ({ type: 'tool' as const, toolName: tool.toolName, description: tool.description }))
  const toolCount = usesProgressActivity
    ? (progress?.toolUses ?? segment.taskBlock.taskUsage?.toolUses ?? asyncEntries.reduce((n, e) => (e.type === 'tool' ? n + 1 : n), 0))
    : syncToolCount
  const hasTokens = tokens.input > 0 || tokens.output > 0
  const asyncTokens = progress?.totalTokens ?? segment.taskBlock.taskUsage?.totalTokens ?? 0
  const taskStatus = isAsync
    ? progress?.status
    : (segment.resultBlock?.isError ? 'failed' as const : undefined)
  const isFailed = !isRunning && taskStatus === 'failed'
  const isStopped = !isRunning && !!taskStatus && taskStatus !== 'completed' && !isFailed
  const headerTitle = taskInput.description || taskInput.name || taskInput.subagentType || t('chat.subagent.title', 'Subagent')
  const outputText = isAsync
    ? (jsonlResultText ?? segment.taskBlock.taskResultText)
    : segment.resultBlock?.summary

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex items-center gap-2 border-b border-border/40 bg-muted/30 px-3 py-2 text-xs">
        <button
          type="button"
          onClick={() => nav.close()}
          title={t('chat.codexCollab.backToMain', 'Back')}
          aria-label={t('chat.codexCollab.backToMain', 'Back')}
          className="inline-flex items-center justify-center rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
        </button>
        <Bot className={cn('size-3.5 shrink-0', colors.text)} />
        {taskInput.name && taskInput.teamName ? (
          <span className={cn('shrink-0 rounded px-1 py-px text-xs font-medium', colors.tagBg, colors.tagText)}>
            {taskInput.name}@{taskInput.teamName}
          </span>
        ) : taskInput.name ? (
          <>
            <span className={cn('shrink-0 rounded px-1 py-px text-xs font-medium', colors.tagBg, colors.tagText)}>
              {taskInput.name}
            </span>
            {taskInput.subagentType && taskInput.subagentType !== taskInput.name && (
              <span className="shrink-0 text-xs text-muted-foreground">{taskInput.subagentType}</span>
            )}
          </>
        ) : taskInput.subagentType ? (
          <span className={cn('shrink-0 rounded px-1 py-px text-xs', colors.tagBg, colors.tagText)}>
            {taskInput.subagentType}
          </span>
        ) : null}
        <span className="min-w-0 truncate font-medium text-foreground">{headerTitle}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
          {isRunning ? (
            <Loader2 className="size-3 animate-spin" />
          ) : isFailed ? (
            <TriangleAlert className="size-3 text-amber-600 dark:text-amber-400" />
          ) : isStopped ? (
            <CircleSlash className="size-3 text-muted-foreground" />
          ) : (
            <Check className="size-3 text-success" />
          )}
          {toolCount > 0 && (
            <span className="inline-flex items-center gap-0.5">
              <Wrench className="size-3" />
              {toolCount}
            </span>
          )}
          {isAsync ? (
            asyncTokens > 0 && (
              <>
                {toolCount > 0 && <span>·</span>}
                <span className="tabular-nums">{formatTokens(asyncTokens)}</span>
              </>
            )
          ) : (
            <>
              {hasTokens && toolCount > 0 && <span>·</span>}
              {tokens.input > 0 && (
                <span className="inline-flex items-center gap-0.5 tabular-nums">
                  <ArrowUp className="size-2.5" />
                  {formatTokens(tokens.input)}
                </span>
              )}
              {tokens.output > 0 && (
                <span className="inline-flex items-center gap-0.5 tabular-nums">
                  <ArrowDown className="size-2.5" />
                  {formatTokens(tokens.output)}
                </span>
              )}
            </>
          )}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="chat-md mx-auto w-full min-w-0 max-w-3xl px-3 py-3">
          {taskInput.prompt && (
            <div className="mb-3">
              <div className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <span>{t('chat.subagent.prompt')}</span>
                {taskInput.model && (
                  <span className="rounded bg-muted px-1 py-px text-xs normal-case">{taskInput.model}</span>
                )}
              </div>
              <div className={cn('whitespace-pre-wrap rounded border-l-2 bg-muted/30 px-3 py-2 text-xs leading-relaxed text-foreground', colors.borderL)}>
                {taskInput.prompt}
              </div>
            </div>
          )}

          {usesProgressActivity ? (
            <NestedToolContext.Provider value={{ defaultAutoExpand: false }}>
              <div className="space-y-2">
                {asyncEntries.map((entry, i) => renderJsonlEntry(entry, i, isRunning))}
                {isRunning && progress?.description && (
                  <AsyncToolRow toolName={progress.lastToolName ?? ''} description={progress.description} isActive />
                )}
                {asyncEntries.length === 0 && !progress?.description && (
                  <div className="px-1 py-2 text-xs text-muted-foreground">
                    {isRunning ? t('chat.subagent.running') : t('chat.subagent.noActivity', 'No activity recorded')}
                  </div>
                )}
              </div>
            </NestedToolContext.Provider>
          ) : (
            <NestedToolContext.Provider value={{ defaultAutoExpand: false }}>
              <div className="space-y-2">
                {childItems.map((item, i) =>
                  item.kind === 'subagent' ? (
                    <SubagentBlock
                      key={`sa-${item.segment.taskBlock.toolUseId}`}
                      taskBlock={item.segment.taskBlock}
                      childBlocks={item.segment.childBlocks}
                      resultBlock={item.segment.resultBlock}
                      isStreaming={isRunning}
                    />
                  ) : (
                    renderFullViewBlock(item.block, i, isRunning, toolResultMap, toolErrorMaps)
                  )
                )}
              </div>
            </NestedToolContext.Provider>
          )}

          {outputText && !(isAsync && isRunning) && (
            <div className="mt-4 border-t border-border/30 pt-3">
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('chat.subagent.output')}
              </div>
              <Streamdown
                className="chat-md text-xs"
                plugins={streamdownPlugins}
                rehypePlugins={streamdownRehypePlugins}
                components={streamdownComponents}
                controls={streamdownControls}
                linkSafety={streamdownLinkSafety}
              >
                {outputText}
              </Streamdown>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ViewShell({ colors, title, onClose, children }: {
  colors: SubagentColorClasses
  title: string
  onClose: () => void
  children: React.ReactNode
}) {
  const { t } = useTranslation()
  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex items-center gap-2 border-b border-border/40 bg-muted/30 px-3 py-2 text-xs">
        <button
          type="button"
          onClick={onClose}
          title={t('chat.codexCollab.backToMain', 'Back')}
          aria-label={t('chat.codexCollab.backToMain', 'Back')}
          className="inline-flex items-center justify-center rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
        </button>
        <Bot className={cn('size-3.5 shrink-0', colors.text)} />
        <span className="min-w-0 truncate font-medium text-foreground">{title}</span>
      </div>
      <div className="flex-1 overflow-y-auto">{children}</div>
    </div>
  )
}

/** Render a sync subagent child block (text / thinking / tool). */
function renderFullViewBlock(
  block: ContentBlock,
  index: number,
  isStreaming: boolean,
  toolResultMap: Map<string, string>,
  errorMaps: ToolErrorMaps,
) {
  switch (block.type) {
    case 'text':
      return (
        <Streamdown
          key={index}
          className="chat-md text-xs"
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
    case 'thinking':
      return (
        <div key={index} className="rounded border border-border/30 bg-muted/20 px-2 py-1.5 text-xs leading-relaxed text-muted-foreground">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide">thinking</div>
          <div className="whitespace-pre-wrap">{block.thinking}</div>
        </div>
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
          isError={errorMaps.errorIds.has(block.toolUseId)}
          isTimedOut={errorMaps.timedOutIds.has(block.toolUseId)}
        />
      )
    case 'tool_result':
      if (toolResultMap.has(block.toolUseId)) return null
      if (!block.summary) return null
      return (
        <div key={index} className="my-0.5 overflow-x-auto rounded bg-muted/50 px-2 py-1.5 font-mono text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap">
          {block.summary}
        </div>
      )
    default:
      return null
  }
}
