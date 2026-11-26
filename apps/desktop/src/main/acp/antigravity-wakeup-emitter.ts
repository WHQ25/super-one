import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentEvent } from '@superone/shared/agent-types'
import { isSubagentToolName } from '@superone/shared/tool-ui'
import {
  extractParentWakeupProgress,
  parseAntigravitySubagentTranscript,
  type ParentWakeupProgress,
  type ParentWakeupToolCall,
  type SpawnedSubagentRef,
} from './antigravity-subagent-transcript'
import type { WakeupReplayContext } from './antigravity-wakeup-policy'

export * from './antigravity-wakeup-policy'

export interface TrackedSubagent {
  toolUseId: string
  messageId: string
  description: string
  startedAtMs: number
  conversationId?: string
  outputFile?: string
  spawnStepIndex?: number
  isSwarmWorker?: boolean
  swarmName?: string
  lastRawLength: number
  emittedSavedImages?: boolean
  killed?: boolean
  wakeupRequired: boolean
  completed: boolean
}

export interface WakeupEmitContext extends WakeupReplayContext {
  brainRoots: string[]
  boundConversationIds: Set<string>
  trackedByToolUseId: Map<string, TrackedSubagent>
  emittedWakeupStepIndices: Set<number>
  emittedWakeupToolUseIds: Set<string>
  activeWakeupMinSpawnStepIndex: number | null
  subagentWakeupPending: boolean
  allWorkCompletedAtMs: number | null
  emitEvent: (event: AgentEvent) => void
  onWakeupToolUseEmitted?: (toolUseId: string, messageId: string) => void
}

export function findAntigravityTranscriptPath(
  sessionId: string,
  brainRoots: string[],
  preferFull = false,
): string | null {
  const filenames = preferFull ? ['transcript_full.jsonl', 'transcript.jsonl'] : ['transcript.jsonl', 'transcript_full.jsonl']
  for (const root of brainRoots) {
    for (const filename of filenames) {
      const candidate = join(root, sessionId, '.system_generated', 'logs', filename)
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

export function emitStoppedTrackedSubagent(
  ctx: Pick<WakeupEmitContext, 'replayedBackgroundToolIds' | 'emitEvent'>,
  entry: TrackedSubagent,
  opts?: { emitToolResult?: boolean },
): void {
  entry.completed = true
  entry.killed = true
  entry.wakeupRequired = false
  ctx.replayedBackgroundToolIds.add(entry.toolUseId)
  if (opts?.emitToolResult && entry.conversationId) {
    ctx.emitEvent({
      type: 'content_delta',
      messageId: entry.messageId,
      delta: {
        type: 'tool_result',
        toolUseId: entry.toolUseId,
        summary: JSON.stringify({
          subagent_id: entry.conversationId,
          output_file: entry.outputFile ?? '',
          status: 'killed',
        }),
        ...(entry.outputFile ? { outputPath: entry.outputFile } : {}),
        isError: false,
      },
    })
  }
  ctx.emitEvent({
    type: 'task_notification',
    toolUseId: entry.toolUseId,
    taskId: entry.conversationId ?? '',
    taskStatus: 'stopped',
    outputFile: entry.outputFile ?? '',
    summary: entry.description,
  })
}

export function syncTrackedSubagentEntries(
  ctx: WakeupEmitContext,
  spawnedRefs: SpawnedSubagentRef[],
  now: number,
  killHints?: { killedAllAtStepIndex?: number; killedSwarmNames?: ReadonlySet<string> },
): void {
  for (const entry of ctx.trackedByToolUseId.values()) {
    if (entry.completed) continue

    if (!entry.conversationId && spawnedRefs.length > 0) {
      const match =
        (entry.isSwarmWorker && entry.swarmName
          ? spawnedRefs.find(
              (ref) =>
                !ctx.boundConversationIds.has(ref.conversationId) &&
                ref.swarmName === entry.swarmName,
            )
          : undefined) ??
        spawnedRefs.find(
          (ref) =>
            !ctx.boundConversationIds.has(ref.conversationId) &&
            (!entry.isSwarmWorker || !ref.swarmName || !entry.swarmName || ref.swarmName === entry.swarmName) &&
            (ref.createdAtMs === undefined || ref.createdAtMs >= entry.startedAtMs - 15_000),
        )
      if (match) {
        ctx.boundConversationIds.add(match.conversationId)
        entry.conversationId = match.conversationId
        entry.spawnStepIndex = match.stepIndex
        if (
          ctx.activeWakeupMinSpawnStepIndex === null ||
          match.stepIndex < ctx.activeWakeupMinSpawnStepIndex
        ) {
          ctx.activeWakeupMinSpawnStepIndex = match.stepIndex
        }
        entry.outputFile =
          match.outputFile ||
          findAntigravityTranscriptPath(match.conversationId, ctx.brainRoots) ||
          join(ctx.brainRoots[0] ?? '', match.conversationId, '.system_generated', 'logs', 'transcript.jsonl')
        if (match.killedAtStepIndex !== undefined) {
          emitStoppedTrackedSubagent(ctx, entry, { emitToolResult: true })
          continue
        }
        ctx.emitEvent({
          type: 'task_started',
          toolUseId: entry.toolUseId,
          taskId: entry.conversationId,
          taskType: 'local_agent',
          description: entry.description,
          ...(entry.outputFile ? { outputFile: entry.outputFile } : {}),
          isBackgrounded: true,
        })
      }
    }

    if (entry.conversationId) {
      const ref = spawnedRefs.find((r) => r.conversationId === entry.conversationId)
      if (ref?.killedAtStepIndex !== undefined) {
        emitStoppedTrackedSubagent(ctx, entry, { emitToolResult: true })
        continue
      }
    } else if (
      entry.isSwarmWorker &&
      (killHints?.killedAllAtStepIndex !== undefined ||
        (entry.swarmName ? killHints?.killedSwarmNames?.has(entry.swarmName) : false))
    ) {
      emitStoppedTrackedSubagent(ctx, entry)
      continue
    }

    if (!entry.outputFile || !existsSync(entry.outputFile)) continue

    let raw = ''
    try {
      raw = readFileSync(entry.outputFile, 'utf8')
    } catch {
      continue
    }
    if (!raw || raw.length === entry.lastRawLength) continue
    entry.lastRawLength = raw.length

    const parsed = parseAntigravitySubagentTranscript(raw)
    const durationMs = parsed.durationMs > 0 ? parsed.durationMs : Math.max(0, now - entry.startedAtMs)

    if (parsed.inputTokens > 0 || parsed.outputTokens > 0) {
      ctx.emitEvent({
        type: 'subagent_usage',
        messageId: entry.messageId,
        parentToolUseId: entry.toolUseId,
        inputTokens: parsed.inputTokens,
        outputTokens: parsed.outputTokens,
      })
    }

    const taskId = entry.conversationId ?? entry.toolUseId
    ctx.emitEvent({
      type: 'task_progress',
      toolUseId: entry.toolUseId,
      taskId,
      description: entry.description,
      ...(parsed.lastToolName ? { lastToolName: parsed.lastToolName } : {}),
      ...(parsed.summary ? { summary: parsed.summary } : {}),
      outputFile: entry.outputFile,
      ...(parsed.toolEntries.length > 0 ? { toolEntries: parsed.toolEntries } : {}),
      usage: { totalTokens: parsed.totalTokens, toolUses: parsed.toolUses, durationMs },
    })

    const formatSummary = (includeImages: boolean): string =>
      includeImages
        ? JSON.stringify({ subagent_id: taskId, output_file: entry.outputFile, status: 'generated', savedPaths: parsed.savedImagePaths, provider: 'antigravity' })
        : JSON.stringify({ subagent_id: taskId, output_file: entry.outputFile })

    if (!parsed.completed && !entry.emittedSavedImages && parsed.savedImagePaths.length > 0) {
      entry.emittedSavedImages = true
      ctx.emitEvent({
        type: 'content_delta',
        messageId: entry.messageId,
        delta: {
          type: 'tool_result',
          toolUseId: entry.toolUseId,
          summary: formatSummary(true),
          outputPath: entry.outputFile,
          isError: false,
        },
      })
    }

    if (parsed.completed) {
      entry.completed = true
      ctx.replayedBackgroundToolIds.add(entry.toolUseId)
      ctx.emitEvent({
        type: 'content_delta',
        messageId: entry.messageId,
        delta: {
          type: 'tool_result',
          toolUseId: entry.toolUseId,
          summary: formatSummary(parsed.savedImagePaths.length > 0),
          outputPath: entry.outputFile,
          isError: parsed.failed,
        },
      })
      ctx.emitEvent({
        type: 'task_notification',
        toolUseId: entry.toolUseId,
        taskId,
        taskStatus: parsed.failed ? 'failed' : 'completed',
        outputFile: entry.outputFile,
        ...(parsed.summary ? { summary: parsed.summary } : {}),
        ...(parsed.resultText ? { resultText: parsed.resultText } : {}),
        usage: { totalTokens: parsed.totalTokens, toolUses: parsed.toolUses, durationMs },
      })
    }
  }

  if (ctx.subagentWakeupPending && ![...ctx.trackedByToolUseId.values()].some((e) => e.wakeupRequired)) {
    ctx.subagentWakeupPending = false
  }
}

export function settleUnboundSwarmWorkersOnWakeup(
  ctx: WakeupEmitContext,
  parentRaw: string,
  afterStepIndex: number,
  now: number,
): void {
  if (!parentRaw) return
  const hasUnboundSwarm = [...ctx.trackedByToolUseId.values()].some(
    (entry) => entry.isSwarmWorker && !entry.conversationId && !entry.completed,
  )
  if (!hasUnboundSwarm) return
  const check = extractParentWakeupProgress(parentRaw, afterStepIndex)
  if (!check.sawSystemMessage) return
  for (const entry of ctx.trackedByToolUseId.values()) {
    if (!entry.isSwarmWorker || entry.conversationId || entry.completed) continue
    entry.completed = true
    ctx.replayedBackgroundToolIds.add(entry.toolUseId)
    const durationMs = Math.max(0, now - entry.startedAtMs)
    ctx.emitEvent({
      type: 'content_delta',
      messageId: entry.messageId,
      delta: {
        type: 'tool_result',
        toolUseId: entry.toolUseId,
        summary: JSON.stringify({ subagent_id: entry.toolUseId, status: 'completed', provider: 'antigravity' }),
        isError: false,
      },
    })
    ctx.emitEvent({
      type: 'task_notification',
      toolUseId: entry.toolUseId,
      taskId: entry.toolUseId,
      taskStatus: 'completed',
      outputFile: '',
      summary: entry.description,
      usage: { totalTokens: 0, toolUses: 0, durationMs },
    })
  }
}

function emitWakeupToolCallEvents(
  ctx: WakeupEmitContext,
  targetMessageId: string,
  tc: ParentWakeupToolCall,
  ready: boolean,
  notifyToolUse = false,
): void {
  ctx.emittedWakeupToolUseIds.add(tc.toolUseId)
  if (notifyToolUse) ctx.onWakeupToolUseEmitted?.(tc.toolUseId, targetMessageId)
  ctx.emitEvent({
    type: 'content_delta',
    messageId: targetMessageId,
    delta: {
      type: 'tool_use',
      toolUseId: tc.toolUseId,
      toolName: tc.toolName,
      input: JSON.stringify(tc.input),
      status: ready ? 'complete' : 'streaming',
      ...(tc.summary ? { toolSummary: tc.summary } : {}),
    },
  })
  if (ready) {
    ctx.emittedWakeupToolResultIds.add(tc.toolUseId)
    ctx.emitEvent({
      type: 'content_delta',
      messageId: targetMessageId,
      delta: {
        type: 'tool_result',
        toolUseId: tc.toolUseId,
        summary: tc.resultSummary ?? 'done',
        isError: Boolean(tc.isError),
      },
    })
  }
}

export function emitWakeupProgressSteps(
  ctx: WakeupEmitContext,
  wakeup: ParentWakeupProgress,
  targetMessageId: string,
  now: number,
): boolean {
  let spawnedNewSubagent = false
  const wireStreamed = Boolean(ctx.wireWakeupStreamed)
  for (const step of wakeup.steps) {
    if (ctx.emittedWakeupStepIndices.has(step.stepIndex)) {
      if (!wireStreamed) {
        for (const tc of step.toolCalls) {
          if (ctx.emittedWakeupToolResultIds.has(tc.toolUseId) || isSubagentToolName(tc.toolName)) continue
          if (tc.hasResult && !tc.resultPending) {
            ctx.unflushedWakeupReplay = true
            emitWakeupToolCallEvents(ctx, targetMessageId, tc, true)
          } else if (tc.resultPending && !ctx.emittedWakeupToolUseIds.has(tc.toolUseId)) {
            ctx.unflushedWakeupReplay = true
            emitWakeupToolCallEvents(ctx, targetMessageId, tc, false, true)
          }
        }
      }
      continue
    }

    ctx.emittedWakeupStepIndices.add(step.stepIndex)
    if (!wireStreamed) {
      ctx.unflushedWakeupReplay = true
    }

    if (step.thinking && !wireStreamed) {
      ctx.emittedWakeupThinkingText = ctx.emittedWakeupThinkingText
        ? `${ctx.emittedWakeupThinkingText}\n${step.thinking}`
        : step.thinking
      ctx.emitEvent({
        type: 'content_delta',
        messageId: targetMessageId,
        replace: true,
        delta: {
          type: 'thinking',
          id: `agy_wakeup_think_${step.stepIndex}`,
          thinking: step.thinking,
          startedAt: step.startedAt,
          endedAt: step.endedAt,
        },
      })
    }

    for (const tc of step.toolCalls) {
      if (isSubagentToolName(tc.toolName)) {
        ctx.emittedWakeupToolUseIds.add(tc.toolUseId)
        ctx.emittedWakeupToolResultIds.add(tc.toolUseId)
        if (!wireStreamed) {
          ctx.emitEvent({
            type: 'content_delta',
            messageId: targetMessageId,
            delta: {
              type: 'tool_use',
              toolUseId: tc.toolUseId,
              toolName: tc.toolName,
              input: JSON.stringify(tc.input),
              status: 'complete',
              ...(tc.summary ? { toolSummary: tc.summary } : {}),
            },
          })
        }
        if (!ctx.trackedByToolUseId.has(tc.toolUseId)) {
          const desc =
            typeof tc.input.description === 'string' && tc.input.description.trim()
              ? tc.input.description.trim()
              : tc.summary || 'Subagent'
          const rawSwarmName =
            typeof tc.input.name === 'string' && tc.input.name.trim()
              ? tc.input.name.trim()
              : typeof tc.input.subagent_type === 'string' && tc.input.subagent_type.trim()
                ? tc.input.subagent_type.trim()
                : undefined
          ctx.trackedByToolUseId.set(tc.toolUseId, {
            toolUseId: tc.toolUseId,
            messageId: targetMessageId,
            description: desc,
            startedAtMs: now,
            ...(tc.input.isSwarmWorker === true
              ? { isSwarmWorker: true, ...(rawSwarmName ? { swarmName: rawSwarmName } : {}) }
              : {}),
            lastRawLength: 0,
            wakeupRequired: true,
            completed: false,
          })
          ctx.subagentWakeupPending = true
          ctx.allWorkCompletedAtMs = null
          spawnedNewSubagent = true
        }
        continue
      }

      if (wireStreamed) continue
      const ready = Boolean(tc.hasResult && !tc.resultPending)
      if (!ready && !tc.resultPending) continue
      emitWakeupToolCallEvents(ctx, targetMessageId, tc, ready, true)
    }

    if (step.content && !wireStreamed) {
      ctx.emittedWakeupMessageText = ctx.emittedWakeupMessageText
        ? `${ctx.emittedWakeupMessageText}\n${step.content}`
        : step.content
      ctx.emitEvent({
        type: 'content_delta',
        messageId: targetMessageId,
        replace: true,
        delta: {
          type: 'text',
          id: `agy_wakeup_text_${step.stepIndex}`,
          text: step.content,
        },
      })
    }

    if (!wireStreamed && (wakeup.turnInputTokens > 0 || wakeup.turnOutputTokens > 0 || wakeup.turnCacheReadTokens > 0)) {
      ctx.emitEvent({
        type: 'message_usage',
        messageId: targetMessageId,
        inputTokens: wakeup.turnInputTokens,
        outputTokens: wakeup.turnOutputTokens,
        ...(wakeup.turnCacheReadTokens > 0 ? { cacheReadTokens: wakeup.turnCacheReadTokens } : {}),
        ...(wakeup.turnContextTokens > 0 ? { contextTokens: wakeup.turnContextTokens } : {}),
      })
    }
  }
  return spawnedNewSubagent
}

export function flushRemainingWakeupToolResults(
  ctx: WakeupEmitContext,
  wakeup: ParentWakeupProgress,
  targetMessageId: string,
): void {
  for (const step of wakeup.steps) {
    for (const tc of step.toolCalls) {
      if (
        !tc.hasResult ||
        tc.resultPending ||
        ctx.emittedWakeupToolResultIds.has(tc.toolUseId) ||
        isSubagentToolName(tc.toolName)
      ) {
        continue
      }
      emitWakeupToolCallEvents(ctx, targetMessageId, tc, true)
    }
  }
}
