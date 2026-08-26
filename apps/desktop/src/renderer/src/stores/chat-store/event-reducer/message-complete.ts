import type { AgentEvent } from '@superone/shared/agent-types'
import { isSubagentToolName } from '@superone/shared/tool-ui'
import { getCodexCompletionEventMeta, getCodexContextTokens } from '../helpers/codex-helpers'
import type { PerSessionState } from '../types'
import { clearStreamingToolInput } from './shared'

type MessageCompleteEvent = Extract<AgentEvent, { type: 'message_complete' }>

export function reduceMessageComplete(session: PerSessionState, event: MessageCompleteEvent): Partial<PerSessionState> {
  const newCost = event.metadata?.costUsd ?? session.totalCostUsd
  const lastAssistantId = session.messages.findLast((m) => m.role === 'assistant' && m.providerId !== 'system')?.id
  const isCurrentTurn = event.messageId === lastAssistantId
  const ft = session.streamingTokens
  const consumedTokens = isCurrentTurn && (ft.input > 0 || ft.output > 0)
    ? { input: ft.input, output: ft.output }
    : undefined
  const codexCompletionMeta = getCodexCompletionEventMeta(event.metadata)
  const completingMsg = session.messages.find((m) => m.id === event.messageId)
  const agentToolIds = new Set<string>()
  let nextPreviews = session._streamingToolInputPreviews
  let previewsChanged = false
  if (completingMsg) {
    for (const b of completingMsg.content) {
      if (b.type === 'tool_use') {
        if (isSubagentToolName(b.toolName)) agentToolIds.add(b.toolUseId)
        // Drop any leftover partial Edit/Write buffers for tools on this message.
        clearStreamingToolInput(b.toolUseId)
        if (nextPreviews[b.toolUseId]) {
          const { [b.toolUseId]: _, ...rest } = nextPreviews
          nextPreviews = rest
          previewsChanged = true
        }
      }
    }
  }
  const codexUsage = codexCompletionMeta?.usage ?? event.metadata?.codex?.usage ?? null
  const hasUncompletedAgents = agentToolIds.size > 0 && [...agentToolIds].some((id) => !session.taskProgress[id]?.completed)
  // Settle a stuck 'streaming' status: a completed current turn with no
  // running subagents is no longer streaming. The backend normally also
  // emits status_change → idle, but after an interrupt + post-interrupt
  // queued turn it can fail to deliver that final idle (Bug B), leaving
  // the UI frozen. Reconciling here removes that single point of failure;
  // it does not touch 'background' or non-current-turn completions.
  // `queuedTurnCount` is the backend's authoritative "another turn follows" signal
  // (SDK 0.3.243+). While it is non-zero the turn has not settled, so neither the
  // reconciliation above nor the backend's own status_change should go idle.
  const queuedTurnsPending = (event.metadata?.queuedTurnCount ?? 0) > 0
  const settleStatusIdle = isCurrentTurn && !hasUncompletedAgents && !queuedTurnsPending && session.status === 'streaming'
  return {
    ...(settleStatusIdle ? { status: 'idle' as const } : {}),
    ...(previewsChanged ? { _streamingToolInputPreviews: nextPreviews } : {}),
    messages: session.messages.map((msg) => {
      if (msg.id !== event.messageId) return msg
      const prevCodex = msg.metadata?.codex
      const nextMetadata = codexCompletionMeta
        ? {
            ...msg.metadata,
            ...event.metadata,
            ...(codexCompletionMeta.durationMs !== undefined ? { durationMs: codexCompletionMeta.durationMs } : {}),
            codex: {
              threadId: codexCompletionMeta.threadId ?? prevCodex?.threadId ?? null,
              usage: codexCompletionMeta.usage ?? prevCodex?.usage ?? null,
              items: codexCompletionMeta.items.length > 0 ? codexCompletionMeta.items : (prevCodex?.items ?? []),
              ...(prevCodex?.planApproval ? { planApproval: prevCodex.planApproval } : {}),
              ...(() => {
                const failed = prevCodex?.mcpStartup?.filter((s) => s.status === 'failed')
                return failed && failed.length > 0 ? { mcpStartup: failed } : {}
              })(),
            },
            ...(consumedTokens ? { consumedTokens } : {}),
          }
        : { ...msg.metadata, ...event.metadata, ...(consumedTokens ? { consumedTokens } : {}) }
      return {
        ...msg,
        status: 'complete' as const,
        ...(codexCompletionMeta?.finalResponse ? { content: [{ type: 'text', text: codexCompletionMeta.finalResponse }] } : {}),
        metadata: nextMetadata,
      }
    }),
    totalCostUsd: newCost,
    contextTokens: (() => {
      if (codexUsage) {
        const total = getCodexContextTokens(codexUsage)
        return total > 0 ? total : session.contextTokens
      }
      const u = event.metadata?.usage
      if (!u) return session.contextTokens
      const total = u.inputTokens + u.cacheReadInputTokens + u.cacheCreationInputTokens
      return total > 0 ? total : session.contextTokens
    })(),
    ...(codexUsage ? {
      contextWindow: codexUsage.contextWindow > 0 ? codexUsage.contextWindow : session.contextWindow,
      codexUsageSnapshot: codexUsage,
      codexTurnLastUsage: null,
    } : {
      contextWindow: (() => {
        const mu = event.metadata?.modelUsage
        if (!mu) return session.contextWindow
        const cw = Math.max(...Object.values(mu).map((u) => u.contextWindow ?? 0))
        return cw > 0 ? cw : session.contextWindow
      })(),
    }),
    awaitingAssistantReply: false,
    ...(isCurrentTurn ? { streamingTokens: { input: 0, output: 0 }, lastEventAt: 0 } : {}),
    ...(hasUncompletedAgents ? {
      taskProgress: {
        ...session.taskProgress,
        ...Object.fromEntries(
          [...agentToolIds]
            .filter(id => !session.taskProgress[id]?.completed)
            .map(id => [id, {
              ...(session.taskProgress[id] ?? {
                description: '',
                totalTokens: 0,
                toolUses: 0,
                durationMs: 0,
                toolHistory: [],
              }),
              completed: true,
            }])
        ),
      },
    } : {}),
  }
}
