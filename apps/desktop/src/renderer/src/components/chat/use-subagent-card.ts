import { useDeferredToolDetail } from '@superone/chat-view/use-deferred-tool-detail'
import { subagentRunState } from '@superone/chat-view/presenters/subagent-run-state'
import { useMemo, useRef } from 'react'
import type { ContentBlock } from '@superone/shared/agent-types'
import { useActiveSession } from '@/stores/chat'
import {
  looksLikeBackgroundSubagentAck,
  parseSubagentIdFromText,
  parseSubagentOutputFileFromText,
  parseTaskInput,
  resolveTaskProgressEntry,
} from './subagent-utils'

const EMPTY_BLOCKS: ContentBlock[] = []

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

export interface SubagentCardInput {
  taskBlock: ContentBlock & { type: 'tool_use' }
  childBlocks: ContentBlock[]
  resultBlock?: ContentBlock
  /** Whether the card body is open; a summarized card loads its detail only then. */
  open: boolean
  isStreaming: boolean
}

/**
 * Resolved data and run state of a subagent card, shared by the inline block and
 * the full view. A summarized remote card (`remoteDetail`) carries no children,
 * prompt or task output: they load from its detail once the card is open.
 */
export function useSubagentCard({ taskBlock: shellTaskBlock, childBlocks: childBlocksProp, resultBlock: shellResultBlock, open, isStreaming }: SubagentCardInput) {
  const remoteDetail = shellTaskBlock.remoteDetail
  const deferred = useDeferredToolDetail(remoteDetail, open, !isStreaming && !!shellResultBlock, shellTaskBlock.toolUseId)
  const taskBlock = useMemo(() => remoteDetail
    ? { ...shellTaskBlock, ...(deferred.detail.input ? { input: deferred.detail.input } : {}), taskResultText: deferred.detail.taskResultText ?? shellTaskBlock.taskResultText }
    : shellTaskBlock, [remoteDetail, shellTaskBlock, deferred.detail])
  const resultBlock = remoteDetail && shellResultBlock?.type === 'tool_result' && deferred.detail.result !== undefined
    ? { ...shellResultBlock, summary: deferred.detail.result }
    : shellResultBlock
  const childBlocks = useStableArray(remoteDetail ? deferred.detail.childBlocks ?? EMPTY_BLOCKS : childBlocksProp)

  const rawResultText = resultBlock?.type === 'tool_result' ? resultBlock.summary : undefined
  const taskIdHint = useMemo(
    () => parseSubagentIdFromText(rawResultText) ?? parseSubagentIdFromText(taskBlock.taskResultText),
    [rawResultText, taskBlock.taskResultText],
  )
  const progress = useActiveSession((state) =>
    resolveTaskProgressEntry(state.taskProgress, taskBlock.toolUseId, taskIdHint),
  )
  const taskInput = useMemo(() => parseTaskInput(taskBlock.input), [taskBlock.input])
  const isAsync = taskInput.runInBackground || !!taskBlock.runInBackground || looksLikeBackgroundSubagentAck(rawResultText)
  const { isRunning, isComplete } = subagentRunState({
    tracked: !!progress || isAsync,
    // Without live progress (a reload), the block's task facts decide, as on the phone.
    finished: progress ? !!progress.completed : !!taskBlock.taskStatus || !!taskBlock.taskResultText,
    hasResult: !!resultBlock,
    isStreaming,
  })
  const taskStatus = progress?.status
    ?? (resultBlock?.type === 'tool_result' && resultBlock.isError ? 'failed' : undefined)
    ?? taskBlock.taskStatus
  const isFailed = isComplete && taskStatus === 'failed'
  const isStopped = isComplete && !!taskStatus && taskStatus !== 'completed' && !isFailed

  const asyncOutputPath = useMemo(() => parseSubagentOutputFileFromText(rawResultText), [rawResultText])
  const resultOutputPath = resultBlock?.type === 'tool_result' ? resultBlock.outputPath : undefined
  const outputFile = asyncOutputPath ?? progress?.outputFile ?? taskBlock.taskOutputFile ?? resultOutputPath

  return {
    taskBlock,
    resultBlock,
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
  }
}
