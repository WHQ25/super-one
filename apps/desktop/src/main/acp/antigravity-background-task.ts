import type { AgentEvent } from '@superone/shared/agent-types'
import { unwatchBashOutput, watchBashOutput } from '../bash-output-watcher'
import {
  expectedTranscriptToolNameForTracked,
  extractBackgroundTaskLaunchFromText,
  extractCompletedBackgroundTasksFromTranscript,
  extractSpawnedBackgroundTasksFromTranscript,
  normalizeSpawnedBackgroundToolName,
  parseBackgroundToolUseInput,
} from './antigravity-background-task-transcript'
import {
  finishTrackedWorkflowTask,
  pollWorkflowTaskProgress,
  startTrackedWorkflowTask,
} from './antigravity-background-workflow'

export interface TrackedBackgroundTask {
  toolUseId: string
  messageId: string
  toolName: string
  rawInputJson: string
  toolSummary?: string
  command?: string
  description: string
  isDaemon: boolean
  startedAtMs: number
  taskId?: string
  spawnStepIndex?: number
  completedStepIndex?: number
  logFile?: string
  watchingLog: boolean
  emittedTaskStarted: boolean
  wireCompleted: boolean
  completed: boolean
  lastWorkflowProgressSignature?: string
}

export interface BackgroundTaskTrackerState {
  boundTaskIds: Set<string>
  tasksByToolUseId: Map<string, TrackedBackgroundTask>
}

export interface BackgroundTaskSyncSummary {
  anyActiveNonDaemon: boolean
}

export function createBackgroundTaskTrackerState(): BackgroundTaskTrackerState {
  return {
    boundTaskIds: new Set(),
    tasksByToolUseId: new Map(),
  }
}

function isTrackedBackgroundCandidateTool(toolName: string): boolean {
  return toolName === 'Bash' || toolName === 'Workflow' || toolName.toLowerCase() === 'schedule'
}

function startTrackedBackgroundTask(
  entry: TrackedBackgroundTask,
  emitEvent: (event: AgentEvent) => void,
  brainRoots?: string[],
): void {
  if (!entry.taskId) return
  if (entry.toolName === 'Bash') {
    if (!entry.emittedTaskStarted) {
      entry.emittedTaskStarted = true
      emitEvent({
        type: 'task_started',
        taskType: 'local_bash',
        toolUseId: entry.toolUseId,
        taskId: entry.taskId,
        description: entry.description,
        ...(entry.logFile ? { outputFile: entry.logFile } : {}),
        isBackgrounded: true,
      })
    }
    if (entry.logFile && !entry.watchingLog && !entry.completed) {
      entry.watchingLog = true
      watchBashOutput(entry.toolUseId, entry.logFile)
    }
    return
  }
  if (entry.toolName === 'Workflow') {
    startTrackedWorkflowTask(entry, emitEvent, brainRoots)
  }
}

function stopLogWatch(entry: TrackedBackgroundTask): void {
  if (!entry.watchingLog) return
  unwatchBashOutput(entry.toolUseId)
  entry.watchingLog = false
}

function finishTrackedBackgroundTask(
  entry: TrackedBackgroundTask,
  taskStatus: 'completed' | 'failed' | 'stopped',
  emitEvent?: (event: AgentEvent) => void,
  opts?: { resultText?: string; brainRoots?: string[] },
): void {
  stopLogWatch(entry)
  if (!emitEvent || !entry.emittedTaskStarted || !entry.taskId) return
  if (entry.toolName === 'Workflow') {
    finishTrackedWorkflowTask(entry, taskStatus, emitEvent, opts)
    return
  }
  emitEvent({
    type: 'task_notification',
    toolUseId: entry.toolUseId,
    taskId: entry.taskId,
    taskStatus,
    outputFile: entry.logFile ?? '',
    summary: entry.description,
  })
}

export function noteBackgroundTaskMappedEvents(
  tracker: BackgroundTaskTrackerState,
  messageId: string,
  mappedEvents: ReadonlyArray<AgentEvent>,
  emitEvent: (event: AgentEvent) => void,
  brainRoots?: string[],
): boolean {
  let touched = false
  for (const event of mappedEvents) {
    if (event.type !== 'content_delta') continue

    if (event.delta.type === 'tool_use') {
      if (!isTrackedBackgroundCandidateTool(event.delta.toolName)) continue
      touched = true
      const { command, description, isDaemon } = parseBackgroundToolUseInput(
        event.delta.input,
        event.delta.toolName,
        event.delta.toolSummary,
      )

      const existing = tracker.tasksByToolUseId.get(event.delta.toolUseId)
      if (!existing) {
        tracker.tasksByToolUseId.set(event.delta.toolUseId, {
          toolUseId: event.delta.toolUseId,
          messageId,
          toolName: event.delta.toolName,
          rawInputJson: event.delta.input,
          ...(event.delta.toolSummary ? { toolSummary: event.delta.toolSummary } : {}),
          ...(command ? { command } : {}),
          description,
          isDaemon,
          startedAtMs: Date.now(),
          watchingLog: false,
          emittedTaskStarted: false,
          wireCompleted: false,
          completed: false,
        })
      } else {
        existing.rawInputJson = event.delta.input
        if (event.delta.toolSummary) existing.toolSummary = event.delta.toolSummary
        if (command) existing.command = command
        if (description) existing.description = description
        if (isDaemon) existing.isDaemon = true
      }
      continue
    }

    if (event.delta.type === 'tool_result') {
      const entry = tracker.tasksByToolUseId.get(event.delta.toolUseId)
      if (!entry) continue
      touched = true
      const launch = extractBackgroundTaskLaunchFromText(event.delta.summary ?? '')
      if (launch) {
        entry.taskId = launch.taskId
        tracker.boundTaskIds.add(launch.taskId)
        if (launch.logFile) entry.logFile = launch.logFile
        if (entry.isDaemon) {
          entry.completed = true
        } else {
          entry.wireCompleted = false
          entry.completed = false
          startTrackedBackgroundTask(entry, emitEvent, brainRoots)
        }
        continue
      }

      if (entry.toolName.toLowerCase() === 'schedule' && !entry.isDaemon) {
        entry.wireCompleted = true
        continue
      }

      if (entry.toolName === 'Workflow' && entry.taskId && !entry.completed) {
        const trimmedSummary = (event.delta.summary ?? '').trim().toLowerCase()
        if (!trimmedSummary || trimmedSummary === 'done') continue
      }

      entry.wireCompleted = true
      entry.completed = true
      finishTrackedBackgroundTask(entry, event.delta.isError ? 'failed' : 'completed', emitEvent, { brainRoots })
    }
  }
  return touched
}

export function syncBackgroundTasks(
  tracker: BackgroundTaskTrackerState,
  parentRaw: string,
  emitEvent: (event: AgentEvent) => void,
  opts?: { fallbackMessageId?: string; brainRoots?: string[] },
): BackgroundTaskSyncSummary {
  const { lastUserStepIndex, tasks: spawnedTasks } = extractSpawnedBackgroundTasksFromTranscript(parentRaw)
  const completedMap = extractCompletedBackgroundTasksFromTranscript(parentRaw, -1, spawnedTasks)
  const spawnedById = new Map(spawnedTasks.map((t) => [t.taskId, t]))
  const currentTurnTasks = spawnedTasks.filter(
    (ref) => ref.stepIndex > lastUserStepIndex && !tracker.boundTaskIds.has(ref.taskId),
  )

  for (const entry of tracker.tasksByToolUseId.values()) {
    if (entry.completed) continue
    if (entry.taskId) {
      const boundRef = spawnedById.get(entry.taskId)
      if (boundRef) {
        entry.spawnStepIndex ??= boundRef.stepIndex
        if (!entry.logFile && boundRef.logFile) entry.logFile = boundRef.logFile
        startTrackedBackgroundTask(entry, emitEvent, opts?.brainRoots)
      }
      continue
    }
    const isSchedule = entry.toolName.toLowerCase() === 'schedule'
    if (entry.wireCompleted && !isSchedule) continue

    const expectedRawTool = expectedTranscriptToolNameForTracked(entry.toolName)
    let matchIdx = currentTurnTasks.findIndex((ref) => ref.toolUseId === entry.toolUseId)
    if (matchIdx < 0) {
      matchIdx = currentTurnTasks.findIndex(
        (ref) =>
          ref.toolName === expectedRawTool &&
          (!entry.command || !ref.command || entry.command === ref.command),
      )
    }
    if (matchIdx < 0) {
      matchIdx = currentTurnTasks.findIndex((ref) => ref.toolName === expectedRawTool)
    }
    if (matchIdx < 0) continue

    const [match] = currentTurnTasks.splice(matchIdx, 1)
    if (!match) continue

    tracker.boundTaskIds.add(match.taskId)
    entry.taskId = match.taskId
    entry.spawnStepIndex = match.stepIndex
    if (match.logFile) entry.logFile = match.logFile
    if (match.isDaemon) entry.isDaemon = true

    if (match.cancelledInTurn || entry.isDaemon) {
      entry.completed = true
      continue
    }

    startTrackedBackgroundTask(entry, emitEvent, opts?.brainRoots)
  }

  if (opts?.fallbackMessageId) {
    for (const ref of spawnedTasks) {
      if (
        ref.stepIndex <= lastUserStepIndex ||
        tracker.boundTaskIds.has(ref.taskId) ||
        tracker.tasksByToolUseId.has(ref.toolUseId) ||
        ref.isDaemon ||
        ref.cancelledInTurn ||
        completedMap.has(ref.taskId)
      ) {
        continue
      }
      const normalizedToolName = normalizeSpawnedBackgroundToolName(ref.toolName)
      const description = ref.description || ref.toolSummary || ref.command || normalizedToolName
      tracker.boundTaskIds.add(ref.taskId)
      const entry: TrackedBackgroundTask = {
        toolUseId: ref.toolUseId,
        messageId: opts.fallbackMessageId,
        toolName: normalizedToolName,
        rawInputJson: ref.rawInputJson,
        ...(ref.toolSummary ? { toolSummary: ref.toolSummary } : {}),
        ...(ref.command ? { command: ref.command } : {}),
        description,
        isDaemon: false,
        startedAtMs: ref.createdAtMs ?? Date.now(),
        taskId: ref.taskId,
        spawnStepIndex: ref.stepIndex,
        ...(ref.logFile ? { logFile: ref.logFile } : {}),
        watchingLog: false,
        emittedTaskStarted: false,
        wireCompleted: false,
        completed: false,
      }
      tracker.tasksByToolUseId.set(entry.toolUseId, entry)
      startTrackedBackgroundTask(entry, emitEvent, opts?.brainRoots)
    }
  }

  for (const entry of tracker.tasksByToolUseId.values()) {
    if (!entry.taskId || entry.completed) continue

    if (spawnedById.get(entry.taskId)?.cancelledInTurn) {
      entry.completed = true
      finishTrackedBackgroundTask(entry, 'stopped', emitEvent, { brainRoots: opts?.brainRoots })
      continue
    }

    const completedResult = completedMap.get(entry.taskId)
    if (!completedResult) {
      pollWorkflowTaskProgress(entry, emitEvent, opts?.brainRoots)
      continue
    }

    entry.completed = true
    entry.completedStepIndex = completedResult.systemStepIndex
    if (!entry.logFile && completedResult.logFile) {
      entry.logFile = completedResult.logFile
    }
    if (!entry.wireCompleted && entry.toolName === 'Bash') {
      emitEvent({
        type: 'content_delta',
        messageId: entry.messageId,
        delta: {
          type: 'tool_use',
          toolUseId: entry.toolUseId,
          toolName: entry.toolName,
          input: entry.rawInputJson,
          status: 'complete',
          ...(entry.toolSummary ? { toolSummary: entry.toolSummary } : {}),
        },
      })
      emitEvent({
        type: 'content_delta',
        messageId: entry.messageId,
        delta: {
          type: 'tool_result',
          toolUseId: entry.toolUseId,
          summary: completedResult.outputSummary,
          ...(entry.logFile ? { outputPath: entry.logFile } : {}),
          isError: completedResult.isError,
        },
      })
    }
    const taskStatus = completedResult.canceled ? 'stopped' : completedResult.isError ? 'failed' : 'completed'
    finishTrackedBackgroundTask(entry, taskStatus, emitEvent, {
      resultText: completedResult.outputSummary,
      brainRoots: opts?.brainRoots,
    })
  }

  let anyActiveNonDaemon = false
  for (const entry of tracker.tasksByToolUseId.values()) {
    if (!entry.completed && !entry.isDaemon && (Boolean(entry.taskId) || entry.toolName === 'Workflow')) {
      anyActiveNonDaemon = true
      break
    }
  }

  return { anyActiveNonDaemon }
}

export function clearSettledWakeupBackgroundTasks(
  tracker: BackgroundTaskTrackerState,
  emitStopped?: (event: AgentEvent) => void,
  brainRoots?: string[],
): void {
  for (const entry of tracker.tasksByToolUseId.values()) {
    if (!entry.completed) {
      finishTrackedBackgroundTask(entry, 'stopped', emitStopped, { brainRoots })
    } else {
      stopLogWatch(entry)
    }
    entry.completed = true
  }
}

export function pruneStaleUnboundBackgroundTasks(tracker: BackgroundTaskTrackerState): void {
  for (const [id, entry] of tracker.tasksByToolUseId.entries()) {
    if (!entry.taskId && entry.completed) {
      stopLogWatch(entry)
      tracker.tasksByToolUseId.delete(id)
    }
  }
}

export function disposeBackgroundTaskTracker(tracker: BackgroundTaskTrackerState): void {
  for (const entry of tracker.tasksByToolUseId.values()) stopLogWatch(entry)
  tracker.tasksByToolUseId.clear()
  tracker.boundTaskIds.clear()
}
