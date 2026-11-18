import type { AgentEvent } from '@superone/shared/agent-types'
import { unwatchBashOutput, watchBashOutput } from '../bash-output-watcher'
import {
  extractBackgroundTaskLaunchFromText,
  extractCompletedBackgroundTasksFromTranscript,
  extractSpawnedBackgroundTasksFromTranscript,
} from './antigravity-background-task-transcript'
import { extractParentWakeupProgress } from './antigravity-wakeup-transcript'

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
  wakeupRequired: boolean
}

export interface BackgroundTaskTrackerState {
  boundTaskIds: Set<string>
  tasksByToolUseId: Map<string, TrackedBackgroundTask>
  idleWatchStepIndex: number | null
}

export interface BackgroundTaskSyncSummary {
  anyActiveNonDaemon: boolean
  anyWakeupRequired: boolean
  minWakeupSpawnStepIndex: number | null
  emittedCompletionFromTranscript: boolean
  emittedCompletedToolUseIds: string[]
  hasActiveIdleWatch: boolean
}

export function createBackgroundTaskTrackerState(): BackgroundTaskTrackerState {
  return {
    boundTaskIds: new Set(),
    tasksByToolUseId: new Map(),
    idleWatchStepIndex: null,
  }
}

function isTrackedBackgroundCandidateTool(toolName: string): boolean {
  return toolName === 'Bash' || toolName.toLowerCase() === 'schedule'
}

function startTrackedBashTask(
  entry: TrackedBackgroundTask,
  emitEvent: (event: AgentEvent) => void,
): void {
  if (entry.toolName !== 'Bash' || !entry.taskId) return
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
): void {
  stopLogWatch(entry)
  if (emitEvent && entry.emittedTaskStarted && entry.taskId) {
    emitEvent({
      type: 'task_notification',
      toolUseId: entry.toolUseId,
      taskId: entry.taskId,
      taskStatus,
      outputFile: entry.logFile ?? '',
      summary: entry.description,
    })
  }
}

export function noteBackgroundTaskMappedEvents(
  tracker: BackgroundTaskTrackerState,
  messageId: string,
  mappedEvents: ReadonlyArray<AgentEvent>,
  emitEvent: (event: AgentEvent) => void,
): boolean {
  let touched = false
  for (const event of mappedEvents) {
    if (event.type !== 'content_delta') continue

    if (event.delta.type === 'tool_use') {
      if (!isTrackedBackgroundCandidateTool(event.delta.toolName)) continue
      touched = true
      let command: string | undefined
      let description = event.delta.toolSummary || event.delta.toolName
      let isDaemon = false
      try {
        const parsed = JSON.parse(event.delta.input) as Record<string, unknown>
        if (typeof parsed.command === 'string' && parsed.command.trim()) {
          command = parsed.command.trim()
        } else if (typeof parsed.CommandLine === 'string' && parsed.CommandLine.trim()) {
          command = parsed.CommandLine.trim()
        }
        if (typeof parsed.description === 'string' && parsed.description.trim()) {
          description = parsed.description.trim()
        } else if (typeof parsed.Prompt === 'string' && parsed.Prompt.trim()) {
          description = parsed.Prompt.trim().slice(0, 120)
        } else if (command) {
          description = command.slice(0, 120)
        }
        isDaemon =
          parsed.run_in_background === true ||
          parsed.IsDaemon === true ||
          parsed.is_daemon === true
      } catch {
        void 0
      }

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
          wakeupRequired: false,
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
          entry.wakeupRequired = false
        } else {
          entry.wakeupRequired = true
          entry.wireCompleted = false
          entry.completed = false
          startTrackedBashTask(entry, emitEvent)
        }
        continue
      }

      if (entry.toolName.toLowerCase() === 'schedule' && !entry.isDaemon) {
        entry.wireCompleted = true
        continue
      }

      entry.wireCompleted = true
      entry.completed = true
      entry.wakeupRequired = false
      finishTrackedBackgroundTask(entry, event.delta.isError ? 'failed' : 'completed', emitEvent)
    }
  }
  return touched
}

export function syncBackgroundTasks(
  tracker: BackgroundTaskTrackerState,
  parentRaw: string,
  parentTurnEnded: boolean,
  emitEvent: (event: AgentEvent) => void,
  opts?: {
    fallbackMessageId?: string
    keepIdleWatch?: boolean
  },
): BackgroundTaskSyncSummary {
  const { lastUserStepIndex, tasks: spawnedTasks } = extractSpawnedBackgroundTasksFromTranscript(parentRaw)
  const completedMap = extractCompletedBackgroundTasksFromTranscript(
    parentRaw,
    -1,
    spawnedTasks,
  )
  let emittedCompletionFromTranscript = false
  const emittedCompletedToolUseIds: string[] = []

  for (const ref of spawnedTasks) {
    if (ref.isDaemon && !ref.cancelledInTurn && !completedMap.has(ref.taskId)) {
      if (tracker.idleWatchStepIndex === null || ref.stepIndex < tracker.idleWatchStepIndex) {
        tracker.idleWatchStepIndex = ref.stepIndex
      }
    }
  }

  const spawnedById = new Map(spawnedTasks.map((t) => [t.taskId, t]))
  const currentTurnTasks = spawnedTasks.filter(
    (ref) => ref.stepIndex > lastUserStepIndex && !tracker.boundTaskIds.has(ref.taskId),
  )

  for (const entry of tracker.tasksByToolUseId.values()) {
    if (entry.completed && !entry.wakeupRequired) continue
    if (entry.taskId) {
      const boundRef = spawnedById.get(entry.taskId)
      if (boundRef) {
        entry.spawnStepIndex ??= boundRef.stepIndex
        if (!entry.logFile && boundRef.logFile) entry.logFile = boundRef.logFile
        startTrackedBashTask(entry, emitEvent)
      }
      continue
    }
    const isSchedule = entry.toolName.toLowerCase() === 'schedule'
    if (entry.wireCompleted && !isSchedule) continue

    const expectedRawTool = isSchedule ? 'schedule' : 'run_command'
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

    if (match.cancelledInTurn) {
      entry.completed = true
      entry.wakeupRequired = false
      continue
    }

    if (entry.isDaemon) {
      entry.completed = true
      entry.wakeupRequired = false
      if (tracker.idleWatchStepIndex === null || match.stepIndex < tracker.idleWatchStepIndex) {
        tracker.idleWatchStepIndex = match.stepIndex
      }
      continue
    }

    if (isSchedule && completedMap.has(match.taskId) && !parentTurnEnded) {
      const preCheck = extractParentWakeupProgress(parentRaw, match.stepIndex)
      if (preCheck.completed) {
        entry.completed = true
        entry.completedStepIndex = completedMap.get(match.taskId)?.systemStepIndex
        entry.wakeupRequired = false
        continue
      }
    }

    entry.wakeupRequired = true
    startTrackedBashTask(entry, emitEvent)
  }

  if (opts?.fallbackMessageId) {
    for (const ref of spawnedTasks) {
      if (
        tracker.boundTaskIds.has(ref.taskId) ||
        tracker.tasksByToolUseId.has(ref.toolUseId) ||
        ref.isDaemon ||
        ref.cancelledInTurn ||
        completedMap.has(ref.taskId)
      ) {
        continue
      }
      const normalizedToolName = ref.toolName === 'schedule' ? 'schedule' : 'Bash'
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
        wakeupRequired: true,
      }
      tracker.tasksByToolUseId.set(entry.toolUseId, entry)
      startTrackedBashTask(entry, emitEvent)
    }
  }

  for (const entry of tracker.tasksByToolUseId.values()) {
    if (!entry.taskId || entry.completed) continue

    if (spawnedById.get(entry.taskId)?.cancelledInTurn) {
      entry.completed = true
      entry.wakeupRequired = false
      finishTrackedBackgroundTask(entry, 'stopped', emitEvent)
      continue
    }

    const completedResult = completedMap.get(entry.taskId)
    if (!completedResult) continue

    entry.completed = true
    entry.completedStepIndex = completedResult.systemStepIndex
    if (completedResult.priority === 'low') {
      entry.wakeupRequired = false
    }
    if (!entry.wireCompleted && entry.toolName === 'Bash') {
      emittedCompletionFromTranscript = true
      emittedCompletedToolUseIds.push(entry.toolUseId)
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
    finishTrackedBackgroundTask(entry, completedResult.isError ? 'failed' : 'completed', emitEvent)
  }

  let anyActiveNonDaemon = false
  let anyWakeupRequired = false
  let minWakeupSpawnStepIndex: number | null = null

  for (const entry of tracker.tasksByToolUseId.values()) {
    if (!entry.wakeupRequired) continue
    anyWakeupRequired = true
    if (!entry.completed) {
      anyActiveNonDaemon = true
    }
    if (
      typeof entry.spawnStepIndex === 'number' &&
      (minWakeupSpawnStepIndex === null || entry.spawnStepIndex < minWakeupSpawnStepIndex)
    ) {
      minWakeupSpawnStepIndex = entry.spawnStepIndex
    }
  }

  const hasActiveDaemonInTranscript = spawnedTasks.some(
    (ref) => ref.isDaemon && !ref.cancelledInTurn && !completedMap.has(ref.taskId),
  )
  if (
    !hasActiveDaemonInTranscript &&
    !anyActiveNonDaemon &&
    !opts?.keepIdleWatch &&
    tracker.idleWatchStepIndex !== null
  ) {
    const idleCheck = extractParentWakeupProgress(parentRaw, tracker.idleWatchStepIndex)
    if (!idleCheck.sawSystemMessage) {
      tracker.idleWatchStepIndex = null
    }
  }

  return {
    anyActiveNonDaemon,
    anyWakeupRequired,
    minWakeupSpawnStepIndex,
    emittedCompletionFromTranscript,
    emittedCompletedToolUseIds,
    hasActiveIdleWatch: tracker.idleWatchStepIndex !== null,
  }
}

export function reconcileForegroundCompletedBackgroundTasks(
  tracker: BackgroundTaskTrackerState,
  foregroundEndStepIndex: number,
): void {
  for (const entry of tracker.tasksByToolUseId.values()) {
    if (
      entry.completed &&
      typeof entry.completedStepIndex === 'number' &&
      entry.completedStepIndex <= foregroundEndStepIndex
    ) {
      entry.wakeupRequired = false
    }
  }
}

export function clearSettledWakeupBackgroundTasks(
  tracker: BackgroundTaskTrackerState,
  emitStopped?: (event: AgentEvent) => void,
): void {
  for (const entry of tracker.tasksByToolUseId.values()) {
    if (!entry.completed) {
      finishTrackedBackgroundTask(entry, 'stopped', emitStopped)
    } else {
      stopLogWatch(entry)
    }
    entry.completed = true
    entry.wakeupRequired = false
  }
}

export function pruneStaleUnboundBackgroundTasks(tracker: BackgroundTaskTrackerState): void {
  for (const [id, entry] of tracker.tasksByToolUseId.entries()) {
    if (!entry.taskId && !entry.wakeupRequired) {
      stopLogWatch(entry)
      tracker.tasksByToolUseId.delete(id)
    }
  }
}

export function disposeBackgroundTaskTracker(tracker: BackgroundTaskTrackerState): void {
  for (const entry of tracker.tasksByToolUseId.values()) {
    stopLogWatch(entry)
  }
  tracker.tasksByToolUseId.clear()
  tracker.boundTaskIds.clear()
  tracker.idleWatchStepIndex = null
}
