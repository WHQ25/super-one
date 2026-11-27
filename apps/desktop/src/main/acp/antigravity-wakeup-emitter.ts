import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentEvent } from '@superone/shared/agent-types'
import {
  parseAntigravitySubagentTranscript,
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
  isSwarmWorker?: boolean
  swarmName?: string
  lastRawLength: number
  emittedSavedImages?: boolean
  killed?: boolean
  completed: boolean
}

export interface SubagentSyncContext {
  brainRoots: string[]
  boundConversationIds: Set<string>
  trackedByToolUseId: Map<string, TrackedSubagent>
  emitEvent: (event: AgentEvent) => void
}

export function findAntigravityTranscriptPath(
  sessionId: string,
  brainRoots: string[],
  preferFull = false,
): string | null {
  const filenames = preferFull
    ? ['transcript_full.jsonl', 'transcript.jsonl']
    : ['transcript.jsonl', 'transcript_full.jsonl']
  for (const root of brainRoots) {
    for (const filename of filenames) {
      const candidate = join(root, sessionId, '.system_generated', 'logs', filename)
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

export function emitStoppedTrackedSubagent(
  ctx: Pick<SubagentSyncContext, 'emitEvent'>,
  entry: TrackedSubagent,
  opts?: { emitToolResult?: boolean },
): void {
  entry.completed = true
  entry.killed = true
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
  ctx: SubagentSyncContext,
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
        ? JSON.stringify({
            subagent_id: taskId,
            output_file: entry.outputFile,
            status: 'generated',
            savedPaths: parsed.savedImagePaths,
            provider: 'antigravity',
          })
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
