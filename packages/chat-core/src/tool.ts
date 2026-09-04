import type { AgentEvent, ChatMessage, ContentBlock } from '@superone/shared/agent-types'
import { applySeqToMessage, isReplayedEventForMessage } from '@superone/shared/event-seq-utils'
import { markMessageEventApplied } from './transformers'
import type { ChatCoreSession } from './types'
import { extractPartialToolInput } from './partial-tool-input'
import { defaultChatCorePorts, type ChatCorePorts } from './ports'
import {
  _patchTaskToolBlock,
  mapMessagesStructural,
  STREAMING_INPUT_TOOLS,
  STREAMING_PREVIEW_THROTTLE_MS,
} from './shared'

type TaskProgressMap = ChatCoreSession['taskProgress']
type TaskProgressEntry = TaskProgressMap[string]

function emptyTaskProgress(): TaskProgressEntry {
  return { description: '', totalTokens: 0, toolUses: 0, durationMs: 0, toolHistory: [] }
}

type ToolHistoryEntry = { toolName: string; description: string }

/**
 * Merge a chronological toolEntries snapshot into accumulated toolHistory.
 * Snapshots may be ordered recent windows (often with empty descriptions); uniqueness
 * by toolName alone would collapse legitimate re-uses (read → grep → read).
 * Match the longest suffix of history that is a prefix of the snapshot, then append
 * only the unseen suffix so the same tool can reappear after another tool.
 *
 * Note: Grok SubagentProgress.tools_used is a *distinct name set*, not a call window —
 * do not feed it here; use child chat_history.jsonl for Grok tool rows.
 */
export function mergeToolEntriesSnapshot(
  history: ToolHistoryEntry[],
  snapshot: ToolHistoryEntry[],
): ToolHistoryEntry[] {
  if (snapshot.length === 0) return history
  if (history.length === 0) return [...snapshot]

  let bestK = 0
  const maxK = Math.min(history.length, snapshot.length)
  for (let k = maxK; k >= 1; k--) {
    let match = true
    for (let i = 0; i < k; i++) {
      const h = history[history.length - k + i]!
      const s = snapshot[i]!
      if (h.toolName !== s.toolName) {
        match = false
        break
      }
      // Empty description is a Grok wildcard; only compare when both are set.
      if (h.description && s.description && h.description !== s.description) {
        match = false
        break
      }
    }
    if (match) {
      bestK = k
      break
    }
  }
  const TOOL_HISTORY_CAP = 50
  if (bestK === snapshot.length) {
    return history.length > TOOL_HISTORY_CAP ? history.slice(-TOOL_HISTORY_CAP) : history
  }
  const next = [...history, ...snapshot.slice(bestK)]
  return next.length > TOOL_HISTORY_CAP ? next.slice(-TOOL_HISTORY_CAP) : next
}

/**
 * Resolve the taskProgress write key.
 *
 * Rules (Codex review):
 * - Key equal to taskId is **provisional** and may migrate to a newly supplied toolUseId.
 * - Key different from taskId is an **established** Agent/Workflow launch key; keep it even
 *   when a resume notification carries a waker toolUseId (do not migrate to the waker).
 * - When only toolUseId is known and no entry exists, create under toolUseId.
 * - A foreign taskId must never write onto an established key that already binds a
 *   different taskId (workflow child finishing with parent toolUseId).
 */
function resolveTaskProgressWrite(
  taskProgress: TaskProgressMap,
  toolUseId: string | undefined,
  taskId: string | undefined,
): { key: string; dropKey?: string; prev: TaskProgressEntry | undefined } | null {
  if (!toolUseId && !taskId) return null

  let establishedKey: string | undefined
  let provisionalKey: string | undefined

  if (taskId) {
    for (const key of Object.keys(taskProgress)) {
      if (taskProgress[key].taskId !== taskId) continue
      if (key === taskId) provisionalKey = key
      else establishedKey = key
    }
    if (!provisionalKey && !establishedKey && taskProgress[taskId]) {
      provisionalKey = taskId
    }
  }

  // Established canonical Agent/Workflow key always wins over a resume waker.
  if (establishedKey) {
    return { key: establishedKey, prev: taskProgress[establishedKey] }
  }

  if (toolUseId && taskProgress[toolUseId]) {
    const prev = taskProgress[toolUseId]
    // Foreign taskId must not hijack an established launch key.
    if (taskId && prev.taskId && prev.taskId !== taskId) {
      return { key: taskId, prev: taskProgress[taskId] }
    }
    return { key: toolUseId, prev }
  }

  // Migrate provisional taskId key → launch toolUseId (only if toolUseId is free
  // or already bound to the same taskId — never onto a different workflow/agent).
  if (provisionalKey && toolUseId && toolUseId !== provisionalKey) {
    const existing = taskProgress[toolUseId]
    if (!existing?.taskId || existing.taskId === taskId) {
      return { key: toolUseId, dropKey: provisionalKey, prev: taskProgress[provisionalKey] }
    }
  }

  if (provisionalKey) {
    return { key: provisionalKey, prev: taskProgress[provisionalKey] }
  }

  // Prefer toolUseId for new launch keys (Agent/Workflow chips).
  if (toolUseId) return { key: toolUseId, prev: undefined }
  return { key: taskId!, prev: undefined }
}

function commitTaskProgress(
  taskProgress: TaskProgressMap,
  write: { key: string; dropKey?: string; prev: TaskProgressEntry | undefined },
  next: TaskProgressEntry,
): TaskProgressMap {
  const out: TaskProgressMap = { ...taskProgress, [write.key]: next }
  if (write.dropKey && write.dropKey !== write.key) {
    delete out[write.dropKey]
  }
  return out
}

/**
 * A subagent launched by a slash command (`/code-review`) drives its whole run
 * through task_* events: the turn emits no content_delta, so the Task block those
 * events name never reaches messages. SubagentBlock has nothing to hang off and
 * the run stays invisible for minutes while taskProgress updates unread.
 *
 * Synthesize the block the renderer expects. The trigger is the block being
 * *absent*, not `tool_use_id` being unset — a slash-command turn does supply an
 * id, it just never ships the block. Keyed identically to taskProgress so every
 * later task_* event resolves onto it; a no-op once the real block exists.
 *
 * Only for task types that own a subagent transcript: shell/monitor tasks already
 * surface as their own notification rows and must not become agent cards.
 */
function synthesizeTaskBlock(
  messages: ChatMessage[],
  blockId: string,
  description: string,
): ChatMessage[] | null {
  const idx = messages.findLastIndex((m) => m.role === 'assistant')
  if (idx < 0) return null
  if (messages.some((m) => m.content.some((b) => b.type === 'tool_use' && b.toolUseId === blockId))) {
    return null
  }
  const block = {
    type: 'tool_use',
    toolName: 'Task',
    toolUseId: blockId,
    input: JSON.stringify({ description }),
    // Running state is driven by taskProgress.completed, not block status; leaving
    // this 'streaming' would spin forever if the terminal notification is missed.
    status: 'complete',
  } as ContentBlock
  const next = [...messages]
  next[idx] = { ...next[idx], content: [...next[idx].content, block] }
  return next
}

type ToolEvent = Extract<AgentEvent, {
  type:
    | 'tool_input_delta'
    | 'tool_progress'
    | 'subagent_usage'
    | 'task_started'
    | 'task_progress'
    | 'task_notification'
    | 'browser_download_update'
}>

function patchBrowserDownloadToolResult(
  messages: ChatCoreSession['messages'],
  taskId: string,
  patch: Record<string, unknown>,
): ChatCoreSession['messages'] {
  return mapMessagesStructural(messages, (block) => {
    if (block.type !== 'tool_result') return block
    const summary = block.summary
    if (typeof summary !== 'string' || !summary.includes(taskId)) return block
    try {
      const data = JSON.parse(summary) as Record<string, unknown>
      if (data.taskId !== taskId) return block
      return { ...block, summary: JSON.stringify({ ...data, ...patch }) }
    } catch {
      return block
    }
  })
}

export function reduceTool(
  session: ChatCoreSession,
  event: ToolEvent,
  ports: ChatCorePorts = defaultChatCorePorts,
): Partial<ChatCoreSession> {
  switch (event.type) {
    case 'tool_input_delta': {
      const targetMsg = session.messages.find((m) => m.id === event.messageId)
      if (targetMsg && isReplayedEventForMessage(event, targetMsg)) {
        return { lastEventAt: ports.now() }
      }
      const targetBlock = targetMsg?.content.find(
        (b) => b.type === 'tool_use' && b.toolUseId === event.toolUseId
      )
      ports.trace?.('widget.store', 'tool_input_delta', {
        toolUseId: event.toolUseId,
        toolName: targetBlock?.type === 'tool_use' ? targetBlock.toolName : null,
        partialLen: event.partialJson.length,
        matchesWidget: targetBlock?.type === 'tool_use' && targetBlock.toolName.endsWith('__widget_show'),
      })
      const shouldAccumulate = targetBlock?.type === 'tool_use' && (
        targetBlock.toolName.endsWith('__widget_show') ||
        STREAMING_INPUT_TOOLS.has(targetBlock.toolName)
      )
      if (shouldAccumulate) {
        if (targetBlock?.type === 'tool_use' && STREAMING_INPUT_TOOLS.has(targetBlock.toolName)) {
          const nextRaw = (ports.streaming.getRaw(event.toolUseId) ?? '') + event.partialJson
          ports.streaming.setRaw(event.toolUseId, nextRaw)
          ports.streaming.noteOwner(event.toolUseId, event.projectPath, event.sessionId)
          const now = ports.now()
          const hasPrev = !!session._streamingToolInputPreviews[event.toolUseId]
          const lastUpdate = ports.streaming.getLastUpdate(event.toolUseId) ?? 0
          const shouldExtract = !hasPrev || (now - lastUpdate) >= STREAMING_PREVIEW_THROTTLE_MS
          const appliedMessages = markMessageEventApplied(session.messages, event.messageId, event)
          if (!shouldExtract) {
            return { lastEventAt: now, ...(appliedMessages ? { messages: appliedMessages } : {}) }
          }
          ports.streaming.setLastUpdate(event.toolUseId, now)
          const nextPreview = extractPartialToolInput(nextRaw, targetBlock.toolName)
          return {
            lastEventAt: now,
            ...(appliedMessages ? { messages: appliedMessages } : {}),
            _streamingToolInputPreviews: {
              ...session._streamingToolInputPreviews,
              [event.toolUseId]: nextPreview,
            },
          }
        }
        return {
          lastEventAt: ports.now(),
          messages: session.messages.map((msg) => {
            if (msg.id !== event.messageId) return msg
            return {
              ...msg,
              content: msg.content.map((b) =>
                b.type === 'tool_use' && b.toolUseId === event.toolUseId
                  ? { ...b, input: b.input + event.partialJson }
                  : b
              ),
              ...applySeqToMessage(event),
            }
          }),
        }
      }
      return { lastEventAt: ports.now() }
    }

    case 'tool_progress': {
      const prevTask = session.taskProgress[event.toolUseId]
      // Retry status only lives on sub-agent tool_progress (Task/Agent). A plain
      // tick clears any prior retry; a non-subagent tool never gets an entry.
      // A heartbeat is liveness, not progress — since SDK 0.3.257 Agent tool calls
      // emit them periodically, so treating one as a plain tick would retract the
      // badge while the subagent is still backing off.
      const touchRetry = !!event.subagentRetry || (!!prevTask?.retry && !event.heartbeat)
      return {
        lastEventAt: ports.now(),
        messages: session.messages.map((msg) => {
          if (msg.id !== event.messageId) return msg
          return {
            ...msg,
            content: msg.content.map((block) => {
              if (block.type === 'tool_use' && block.toolUseId === event.toolUseId) {
                return { ...block, elapsedSeconds: event.elapsedSeconds }
              }
              return block
            }),
          }
        }),
        ...(touchRetry
          ? {
              taskProgress: {
                ...session.taskProgress,
                [event.toolUseId]: {
                  ...(prevTask ?? { description: '', totalTokens: 0, toolUses: 0, durationMs: 0, toolHistory: [] }),
                  retry: event.subagentRetry,
                },
              },
            }
          : {}),
      }
    }

    case 'subagent_usage':
      return {
        subagentTokens: {
          ...session.subagentTokens,
          [event.parentToolUseId]: { input: event.inputTokens, output: event.outputTokens },
        },
      }

    case 'task_started': {
      const write = resolveTaskProgressWrite(session.taskProgress, event.toolUseId, event.taskId)
      if (!write) return {}
      const prev = write.prev
      const next: TaskProgressEntry = {
        ...(prev ?? emptyTaskProgress()),
        description: event.description,
        taskId: event.taskId ?? prev?.taskId,
        completed: prev?.completed === true ? true : false,
        ...(event.outputFile ? { outputFile: event.outputFile } : {}),
      }
      const patch = { taskProgress: commitTaskProgress(session.taskProgress, write, next) }
      if (event.taskType !== 'local_agent' || event.skipTranscript) return patch
      // Key the block the same way taskProgress is keyed, so every later task_*
      // event lands on it. A toolUseId being present does not mean the block
      // arrived: a slash-command turn names one but emits no content at all.
      const blockId = event.toolUseId ?? event.taskId
      if (!blockId) return patch
      const messages = synthesizeTaskBlock(session.messages, blockId, event.description)
      return messages ? { ...patch, messages } : patch
    }

    case 'task_progress': {
      const write = resolveTaskProgressWrite(session.taskProgress, event.toolUseId, event.taskId)
      if (!write) return {}
      const prev = write.prev
      // Chronological tool rows only from real toolEntries (Claude progress / explicit).
      // Grok no longer sends tools_used as toolEntries (distinct-name set); full rows
      // come from child chat_history.jsonl via outputFile — skip description-transition
      // accumulation when a transcript path is available so we don't invent sparse rows.
      let toolHistory = prev?.toolHistory ? [...prev.toolHistory] : []
      const transcriptPath = event.outputFile ?? prev?.outputFile
      if (event.toolEntries?.length) {
        toolHistory = mergeToolEntriesSnapshot(toolHistory, event.toolEntries)
      } else if (
        !transcriptPath
        && prev
        && prev.description
        && prev.description !== event.description
      ) {
        toolHistory.push({ toolName: prev.lastToolName ?? '', description: prev.description })
        if (toolHistory.length > 50) toolHistory = toolHistory.slice(-50)
      }
      const progressSummary = event.summary ?? prev?.summary
      const workflowAgents = event.workflowAgents?.length
        ? event.workflowAgents
        : prev?.workflowAgents
      const workflowPhases = event.workflowPhases?.length
        ? event.workflowPhases
        : prev?.workflowPhases
      const currentPhase = event.currentPhase ?? prev?.currentPhase
      const next: TaskProgressEntry = {
        ...(prev ?? emptyTaskProgress()),
        description: event.description,
        taskId: event.taskId ?? prev?.taskId,
        lastToolName: event.lastToolName,
        summary: progressSummary,
        totalTokens: event.usage.totalTokens,
        toolUses: event.usage.toolUses,
        durationMs: event.usage.durationMs,
        toolHistory,
        // Progress means the task is still live — clear a sticky false complete
        // from a prior foreign notification (workflow child hijack).
        completed: false,
        status: undefined,
        ...(event.outputFile || prev?.outputFile
          ? { outputFile: event.outputFile ?? prev?.outputFile }
          : {}),
        ...(workflowAgents ? { workflowAgents } : {}),
        ...(workflowPhases ? { workflowPhases } : {}),
        ...(currentPhase ? { currentPhase } : {}),
      }
      // Only patch tool blocks when we know the launch toolUseId (not provisional taskId key).
      const messages = event.toolUseId
        ? _patchTaskToolBlock(session.messages, event.toolUseId, {
            taskUsage: {
              totalTokens: event.usage.totalTokens,
              toolUses: event.usage.toolUses,
              durationMs: event.usage.durationMs,
            },
            taskToolHistory: toolHistory,
            taskSummary: progressSummary,
            ...(transcriptPath ? { taskOutputFile: transcriptPath } : {}),
            ...(workflowAgents ? { workflowAgents } : {}),
            ...(workflowPhases ? { workflowPhases } : {}),
            ...(currentPhase ? { workflowCurrentPhase: currentPhase } : {}),
          })
        : session.messages
      return {
        messages,
        taskProgress: commitTaskProgress(session.taskProgress, write, next),
      }
    }

    case 'task_notification': {
      let msgs = session.messages
      let browserDownloads = session.browserDownloads ?? {}
      // Host browser_download tasks (bdl_*) finish via task_notification — flip the tool block UI.
      if (event.taskId?.startsWith('bdl_')) {
        let parsedExtra: Record<string, unknown> = {}
        if (event.resultText) {
          try { parsedExtra = JSON.parse(event.resultText) as Record<string, unknown> } catch { /* ignore */ }
        }
        const dlPatch: Record<string, unknown> = {
          status: event.taskStatus === 'completed' ? 'completed' : 'failed',
          ...(typeof parsedExtra.path === 'string' ? { path: parsedExtra.path } : event.outputFile ? { path: event.outputFile } : {}),
          ...(typeof parsedExtra.filename === 'string' ? { filename: parsedExtra.filename } : {}),
          ...(typeof parsedExtra.bytes === 'number' ? { bytes: parsedExtra.bytes } : {}),
          ...(typeof parsedExtra.mimeType === 'string' ? { mimeType: parsedExtra.mimeType } : {}),
          ...(typeof parsedExtra.url === 'string' ? { url: parsedExtra.url } : {}),
          ...(event.taskStatus !== 'completed' && event.summary ? { error: event.summary } : {}),
        }
        msgs = patchBrowserDownloadToolResult(msgs, event.taskId, dlPatch)
        browserDownloads = {
          ...browserDownloads,
          [event.taskId]: {
            ...(browserDownloads[event.taskId] ?? { status: 'progressing' }),
            status: event.taskStatus === 'completed' ? 'completed' : 'failed',
            path: typeof dlPatch.path === 'string' ? dlPatch.path : browserDownloads[event.taskId]?.path,
            filename: typeof dlPatch.filename === 'string' ? dlPatch.filename : browserDownloads[event.taskId]?.filename,
            bytes: typeof dlPatch.bytes === 'number' ? dlPatch.bytes : browserDownloads[event.taskId]?.bytes,
            mimeType: typeof dlPatch.mimeType === 'string' ? dlPatch.mimeType : browserDownloads[event.taskId]?.mimeType,
            url: typeof dlPatch.url === 'string' ? dlPatch.url : browserDownloads[event.taskId]?.url,
            error: typeof dlPatch.error === 'string' ? dlPatch.error : undefined,
          },
        }
      }

      // Resolve final write key: keep established Agent keys on resume; migrate provisional workflow keys.
      const write = resolveTaskProgressWrite(session.taskProgress, event.toolUseId, event.taskId)
      if (!write) {
        return msgs !== session.messages || browserDownloads !== (session.browserDownloads ?? {})
          ? { messages: msgs, browserDownloads }
          : {}
      }

      const file = event.outputFile
      const prevProgress = write.prev
      const usageUpdate = event.usage ? {
        totalTokens: event.usage.totalTokens,
        toolUses: event.usage.toolUses,
        durationMs: event.usage.durationMs,
      } : {}
      const finalSummary = event.summary || prevProgress?.summary
      const prevStatus = prevProgress?.status
      const finalStatus = event.taskStatus === 'completed' && (prevStatus === 'failed' || prevStatus === 'stopped')
        ? prevStatus
        : event.taskStatus
      const finalUsage = event.usage ?? {
        totalTokens: prevProgress?.totalTokens ?? 0,
        toolUses: prevProgress?.toolUses ?? 0,
        durationMs: prevProgress?.durationMs ?? 0,
      }
      const finalToolHistory = prevProgress?.toolHistory ?? []
      // Preserve prior agents/phases when terminal snapshot omits them.
      const workflowAgents = event.workflowAgents?.length
        ? event.workflowAgents
        : prevProgress?.workflowAgents
      const workflowPhases = event.workflowPhases?.length
        ? event.workflowPhases
        : prevProgress?.workflowPhases
      const currentPhase = event.currentPhase ?? prevProgress?.currentPhase
      const resultText = event.resultText ?? prevProgress?.resultText
      // A later notification may carry only this — the dsh subagent diagnostic
      // becomes available after the run has already closed the block — so it
      // merges rather than replacing what is already there.
      const diagnostic = event.diagnostic ?? prevProgress?.diagnostic
      const outputPath = file || prevProgress?.outputFile
      const toolPatch = {
        taskUsage: {
          totalTokens: finalUsage.totalTokens,
          toolUses: finalUsage.toolUses,
          durationMs: finalUsage.durationMs,
        },
        taskToolHistory: finalToolHistory,
        taskSummary: finalSummary,
        ...(resultText ? { taskResultText: resultText } : {}),
        ...(outputPath ? { taskOutputFile: outputPath } : {}),
        ...(workflowAgents ? { workflowAgents } : {}),
        ...(workflowPhases ? { workflowPhases } : {}),
        ...(currentPhase ? { workflowCurrentPhase: currentPhase } : {}),
      }
      // Patch under the resolved canonical write key. A taskId-only key used to be
      // skipped because it named no real block; a slash-command subagent now has a
      // synthesized block under exactly that id, so match on the block instead —
      // mapMessagesStructural is a no-op when nothing carries the id.
      const patchToolId = write.key
      if (patchToolId) {
        msgs = mapMessagesStructural(msgs, (block) => {
          if (
            block.type === 'tool_use'
            && (block.toolName === 'Agent' || block.toolName === 'Task' || block.toolName === 'Workflow')
            && block.toolUseId === patchToolId
          ) {
            return { ...block, ...toolPatch }
          }
          if (file && block.type === 'tool_result' && block.toolUseId === patchToolId) {
            if (block.outputPath === file) return block
            return { ...block, outputPath: file }
          }
          return block
        })
      }
      const next: TaskProgressEntry = {
        ...(prevProgress ?? emptyTaskProgress()),
        ...usageUpdate,
        taskId: event.taskId ?? prevProgress?.taskId,
        completed: true,
        status: finalStatus,
        outputFile: file || prevProgress?.outputFile,
        summary: finalSummary,
        ...(resultText ? { resultText } : {}),
        ...(diagnostic ? { diagnostic } : {}),
        ...(workflowAgents ? { workflowAgents } : {}),
        ...(workflowPhases ? { workflowPhases } : {}),
        ...(currentPhase ? { currentPhase } : {}),
      }
      return {
        messages: msgs,
        browserDownloads,
        taskProgress: commitTaskProgress(session.taskProgress, write, next),
      }
    }

    case 'browser_download_update': {
      const prevMap = session.browserDownloads ?? {}
      const prev = prevMap[event.taskId]
      const next = {
        ...prev,
        status: event.status,
        path: event.path ?? prev?.path,
        filename: event.filename ?? prev?.filename,
        bytes: event.bytes ?? prev?.bytes,
        totalBytes: event.totalBytes ?? prev?.totalBytes,
        mimeType: event.mimeType ?? prev?.mimeType,
        url: event.url ?? prev?.url,
        error: event.error ?? (event.status === 'failed' ? prev?.error : undefined),
      }
      const browserDownloads = { ...prevMap, [event.taskId]: next }
      if (event.status === 'completed' || event.status === 'failed') {
        const patch: Record<string, unknown> = {
          status: event.status,
          ...(event.path ? { path: event.path } : {}),
          ...(event.filename ? { filename: event.filename } : {}),
          ...(event.bytes != null ? { bytes: event.bytes } : {}),
          ...(event.mimeType ? { mimeType: event.mimeType } : {}),
          ...(event.url ? { url: event.url } : {}),
          ...(event.error ? { error: event.error } : {}),
        }
        return {
          browserDownloads,
          messages: patchBrowserDownloadToolResult(session.messages, event.taskId, patch),
        }
      }
      return { browserDownloads }
    }
  }
}
