import type { AgentEvent } from '@superone/shared/agent-types'
import { applySeqToMessage, isReplayedEventForMessage } from '@superone/shared/event-seq-utils'
import { accumulateCodexFooterTokens, getCodexContextTokens } from './codex-pure'
import type { PerSessionState } from '../types'
import { defaultChatCorePorts, type ChatCorePorts } from './ports'

type UsageEvent = Extract<AgentEvent, {
  type: 'message_usage' | 'status_indicator' | 'rate_limit' | 'api_retry'
}>

export function reduceUsage(
  session: PerSessionState,
  event: UsageEvent,
  ports: ChatCorePorts = defaultChatCorePorts,
): Partial<PerSessionState> {
  switch (event.type) {
    case 'message_usage': {
      const usageTarget = session.messages.find((m) => m.id === event.messageId)
      if (usageTarget && isReplayedEventForMessage(event, usageTarget)) {
        return { lastEventAt: ports.now() }
      }
      const messagesWithSeq = usageTarget
        ? session.messages.map((m) => (m.id === event.messageId ? { ...m, ...applySeqToMessage(event) } : m))
        : session.messages
      if (event.codexUsage) {
        const nextStreamingTokens = accumulateCodexFooterTokens(session.streamingTokens, event.codexUsage, session.codexTurnLastUsage)
        return {
          lastEventAt: ports.now(),
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
      const patch: Partial<PerSessionState> = {
        lastEventAt: ports.now(),
        messages: messagesWithSeq,
      }
      // Context-only updates (input/output both 0) must not wipe footer turn tokens.
      if (event.inputTokens > 0 || event.outputTokens > 0) {
        patch.streamingTokens = { input: event.inputTokens, output: event.outputTokens }
      }
      if (typeof event.contextTokens === 'number' && event.contextTokens > 0) {
        patch.contextTokens = event.contextTokens
      }
      if (typeof event.contextWindow === 'number' && event.contextWindow > 0) {
        patch.contextWindow = event.contextWindow
      }
      if (typeof event.costUsd === 'number' && event.costUsd >= 0) {
        patch.totalCostUsd = event.costUsd
      }
      return patch
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
          : { status: event.status, resetsAt: event.resetsAt, rateLimitType: event.rateLimitType, utilization: event.utilization, errorCode: event.errorCode, canUserPurchaseCredits: event.canUserPurchaseCredits, hasChargeableSavedPaymentMethod: event.hasChargeableSavedPaymentMethod },
      }

    case 'api_retry':
      return {
        apiRetry: {
          attempt: event.attempt,
          delayMs: event.delayMs,
          ...(event.maxRetries === undefined ? {} : { maxRetries: event.maxRetries }),
          ...(event.message === undefined ? {} : { message: event.message }),
        },
      }
  }
}
