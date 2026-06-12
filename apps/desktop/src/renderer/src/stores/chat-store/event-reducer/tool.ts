import type { AgentEvent } from '@superone/shared/agent-types'
import { applySeqToMessage, isReplayedEventForMessage } from '@superone/shared/event-seq-utils'
import { extractPartialToolInput } from '@/components/chat/tool-display'
import { markMessageEventApplied } from '../index'
import type { PerSessionState } from '../types'
import {
  _patchAgentBlock,
  STREAMING_INPUT_TOOLS,
  STREAMING_PREVIEW_THROTTLE_MS,
  streamingPreviewLastUpdate,
  streamingToolInputRaw,
} from './shared'

type ToolEvent = Extract<AgentEvent, {
  type:
    | 'tool_input_delta'
    | 'tool_progress'
    | 'subagent_usage'
    | 'task_started'
    | 'task_progress'
    | 'task_notification'
}>

export function reduceTool(session: PerSessionState, event: ToolEvent): Partial<PerSessionState> {
  switch (event.type) {
    case 'tool_input_delta': {
      const targetMsg = session.messages.find((m) => m.id === event.messageId)
      if (targetMsg && isReplayedEventForMessage(event, targetMsg)) {
        return { lastEventAt: Date.now() }
      }
      const targetBlock = targetMsg?.content.find(
        (b) => b.type === 'tool_use' && b.toolUseId === event.toolUseId
      )
      window.app?.trace?.('widget.store', 'tool_input_delta', {
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
          const nextRaw = (streamingToolInputRaw.get(event.toolUseId) ?? '') + event.partialJson
          streamingToolInputRaw.set(event.toolUseId, nextRaw)
          const now = Date.now()
          const hasPrev = !!session._streamingToolInputPreviews[event.toolUseId]
          const addsCommittedLine = event.partialJson.includes('\\n') || event.partialJson.includes('\n')
          const lastUpdate = streamingPreviewLastUpdate.get(event.toolUseId) ?? 0
          const shouldExtract = !hasPrev || addsCommittedLine || (now - lastUpdate) >= STREAMING_PREVIEW_THROTTLE_MS
          const appliedMessages = markMessageEventApplied(session.messages, event.messageId, event)
          if (!shouldExtract) {
            return { lastEventAt: now, ...(appliedMessages ? { messages: appliedMessages } : {}) }
          }
          streamingPreviewLastUpdate.set(event.toolUseId, now)
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
          lastEventAt: Date.now(),
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
      return { lastEventAt: Date.now() }
    }

    case 'tool_progress':
      return {
        lastEventAt: Date.now(),
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
      }

    case 'subagent_usage':
      return {
        subagentTokens: {
          ...session.subagentTokens,
          [event.parentToolUseId]: { input: event.inputTokens, output: event.outputTokens },
        },
      }

    case 'task_started': {
      if (!event.toolUseId) return {}
      const prev = session.taskProgress[event.toolUseId]
      return {
        taskProgress: {
          ...session.taskProgress,
          [event.toolUseId]: {
            ...(prev ?? { description: '', totalTokens: 0, toolUses: 0, durationMs: 0, toolHistory: [] }),
            description: event.description,
            taskId: event.taskId,
            completed: prev?.completed === true ? true : false,
          },
        },
      }
    }

    case 'task_progress': {
      if (!event.toolUseId) return {}
      const prev = session.taskProgress[event.toolUseId]
      const toolHistory = prev?.toolHistory ? [...prev.toolHistory] : []
      if (prev && prev.description && prev.description !== event.description) {
        toolHistory.push({ toolName: prev.lastToolName ?? '', description: prev.description })
      }
      const progressSummary = event.summary ?? prev?.summary
      return {
        messages: _patchAgentBlock(session.messages, event.toolUseId, {
          taskUsage: { totalTokens: event.usage.totalTokens, toolUses: event.usage.toolUses, durationMs: event.usage.durationMs },
          taskToolHistory: toolHistory,
          taskSummary: progressSummary,
        }),
        taskProgress: {
          ...session.taskProgress,
          [event.toolUseId]: {
            ...(prev ?? { description: '', totalTokens: 0, toolUses: 0, durationMs: 0, toolHistory: [] }),
            description: event.description,
            lastToolName: event.lastToolName,
            summary: progressSummary,
            totalTokens: event.usage.totalTokens,
            toolUses: event.usage.toolUses,
            durationMs: event.usage.durationMs,
            toolHistory,
          },
        },
      }
    }

    case 'task_notification': {
      if (!event.toolUseId) return {}
      const tid = event.toolUseId
      const file = event.outputFile
      const prevProgress = session.taskProgress[tid]
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
      const finalUsage = event.usage ?? { totalTokens: prevProgress?.totalTokens ?? 0, toolUses: prevProgress?.toolUses ?? 0, durationMs: prevProgress?.durationMs ?? 0 }
      const finalToolHistory = prevProgress?.toolHistory ?? []
      const agentPatch = {
        taskUsage: { totalTokens: finalUsage.totalTokens, toolUses: finalUsage.toolUses, durationMs: finalUsage.durationMs },
        taskToolHistory: finalToolHistory,
        taskSummary: finalSummary,
      }
      const msgs = session.messages.map((msg) => ({
        ...msg,
        content: msg.content.map((block) => {
          if (block.type === 'tool_use' && block.toolName === 'Agent' && block.toolUseId === tid) return { ...block, ...agentPatch }
          if (file && block.type === 'tool_result' && block.toolUseId === tid) return { ...block, outputPath: file }
          return block
        }),
      }))
      return {
        messages: msgs,
        taskProgress: {
          ...session.taskProgress,
          [tid]: {
            ...(prevProgress ?? { description: '', totalTokens: 0, toolUses: 0, durationMs: 0, toolHistory: [] }),
            ...usageUpdate,
            completed: true,
            status: finalStatus,
            outputFile: file || prevProgress?.outputFile,
            summary: finalSummary,
          },
        },
      }
    }
  }
}
