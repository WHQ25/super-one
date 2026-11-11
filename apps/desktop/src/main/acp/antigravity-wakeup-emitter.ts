import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentEvent } from '@superone/shared/agent-types'
import { isSubagentToolName } from '@superone/shared/tool-ui'
import {
  parseAntigravitySubagentTranscript,
  type ParentWakeupProgress,
  type SpawnedSubagentRef,
} from './antigravity-subagent-transcript'

export interface TrackedSubagent {
  toolUseId: string
  messageId: string
  description: string
  startedAtMs: number
  conversationId?: string
  outputFile?: string
  spawnStepIndex?: number
  lastRawLength: number
  emittedSavedImages?: boolean
  completed: boolean
}

export interface WakeupEmitContext {
  brainRoots: string[]
  boundConversationIds: Set<string>
  trackedByToolUseId: Map<string, TrackedSubagent>
  emittedWakeupStepIndices: Set<number>
  emittedWakeupToolResultIds: Set<string>
  activeWakeupMinSpawnStepIndex: number | null
  subagentWakeupPending: boolean
  allWorkCompletedAtMs: number | null
  unflushedWakeupReplay: boolean
  emitEvent: (event: AgentEvent) => void
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

export function syncTrackedSubagentEntries(
  ctx: WakeupEmitContext,
  spawnedRefs: SpawnedSubagentRef[],
  now: number,
  maxTrackDurationMs: number,
): void {
  for (const entry of ctx.trackedByToolUseId.values()) {
    if (entry.completed) continue
    if (now - entry.startedAtMs > maxTrackDurationMs) {
      entry.completed = true
      continue
    }

    if (!entry.conversationId && spawnedRefs.length > 0) {
      const match = spawnedRefs.find(
        (ref) =>
          !ctx.boundConversationIds.has(ref.conversationId) &&
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
        ctx.emitEvent({
          type: 'task_started',
          toolUseId: entry.toolUseId,
          taskId: entry.conversationId,
          description: entry.description,
          ...(entry.outputFile ? { outputFile: entry.outputFile } : {}),
          isBackgrounded: true,
        })
      }
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
}

export function emitWakeupProgressSteps(
  ctx: WakeupEmitContext,
  wakeup: ParentWakeupProgress,
  targetMessageId: string,
  now: number,
): boolean {
  let spawnedNewSubagent = false
  for (const step of wakeup.steps) {
    if (ctx.emittedWakeupStepIndices.has(step.stepIndex)) {
      for (const tc of step.toolCalls) {
        if (!tc.hasResult || tc.resultPending || ctx.emittedWakeupToolResultIds.has(tc.toolUseId)) continue
        ctx.emittedWakeupToolResultIds.add(tc.toolUseId)
        ctx.unflushedWakeupReplay = true
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
      continue
    }

    ctx.emittedWakeupStepIndices.add(step.stepIndex)
    ctx.unflushedWakeupReplay = true

    if (step.thinking) {
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
        ctx.emittedWakeupToolResultIds.add(tc.toolUseId)
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
        if (!ctx.trackedByToolUseId.has(tc.toolUseId)) {
          const desc =
            typeof tc.input.description === 'string' && tc.input.description.trim()
              ? tc.input.description.trim()
              : tc.summary || 'Subagent'
          ctx.trackedByToolUseId.set(tc.toolUseId, {
            toolUseId: tc.toolUseId,
            messageId: targetMessageId,
            description: desc,
            startedAtMs: now,
            lastRawLength: 0,
            completed: false,
          })
          ctx.subagentWakeupPending = true
          ctx.allWorkCompletedAtMs = null
          spawnedNewSubagent = true
        }
        continue
      }

      const ready = Boolean(tc.hasResult && !tc.resultPending)
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

    if (step.content) {
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

    if (wakeup.turnInputTokens > 0 || wakeup.turnOutputTokens > 0 || wakeup.turnCacheReadTokens > 0) {
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
      if (ctx.emittedWakeupToolResultIds.has(tc.toolUseId) || isSubagentToolName(tc.toolName)) continue
      ctx.emittedWakeupToolResultIds.add(tc.toolUseId)
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
}
