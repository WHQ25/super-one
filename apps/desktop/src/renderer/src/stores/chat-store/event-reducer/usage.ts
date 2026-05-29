import type { AgentEvent } from '@superone/shared/agent-types'
import { applySeqToMessage, isReplayedEventForMessage } from '@superone/shared/event-seq-utils'
import { accumulateCodexFooterTokens, getCodexContextTokens } from '../helpers/codex-helpers'
import type { PerSessionState } from '../types'

type UsageEvent = Extract<AgentEvent, {
  type: 'message_usage' | 'status_indicator' | 'rate_limit' | 'api_retry'
}>

export function reduceUsage(session: PerSessionState, event: UsageEvent): Partial<PerSessionState> {
  switch (event.type) {
    case 'message_usage': {
      const usageTarget = session.messages.find((m) => m.id === event.messageId)
      if (usageTarget && isReplayedEventForMessage(event, usageTarget)) {
        return { lastEventAt: Date.now() }
      }
      const messagesWithSeq = usageTarget
        ? session.messages.map((m) => (m.id === event.messageId ? { ...m, ...applySeqToMessage(event) } : m))
        : session.messages
      if (event.codexUsage) {
        const nextStreamingTokens = accumulateCodexFooterTokens(session.streamingTokens, event.codexUsage, session.codexTurnLastUsage)
        return {
          lastEventAt: Date.now(),
          streamingTokens: nextStreamingTokens,
          contextTokens: (() => {
            const total = getCodexContextTokens(event.codexUsage)
            return total > 0 ? total : session.contextTokens
          })(),
          contextWindow: event.codexUsage.contextWindow > 0 ? event.codexUsage.contextWindow : session.contextWindow,
          codexUsageSnapshot: event.codexUsage,
          codexTurnLastUsage: event.codexUsage,
          messages: messagesWithSeq,
        }
      }
      return { lastEventAt: Date.now(), streamingTokens: { input: event.inputTokens, output: event.outputTokens }, messages: messagesWithSeq }
    }

    case 'status_indicator': {
      if (event.indicator === 'compacting') return { isCompacting: true, compactError: null }
      if (event.compactResult === 'failed') {
        return {
          isCompacting: false,
          compactError: event.compactError || 'Compaction failed',
          _pendingCompactUserId: '',
          _pendingSlashCommand: '',
        }
      }
      return { isCompacting: false }
    }

    case 'rate_limit':
      return {
        rateLimitInfo: event.status === 'allowed'
          ? null
          : { status: event.status, resetsAt: event.resetsAt, rateLimitType: event.rateLimitType, utilization: event.utilization },
      }

    case 'api_retry':
      return { apiRetry: { attempt: event.attempt, maxRetries: event.maxRetries, delayMs: event.delayMs } }
  }
}
