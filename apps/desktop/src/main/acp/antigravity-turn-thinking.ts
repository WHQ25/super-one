import type { AgentEvent } from '@superone/shared/agent-types'
import { noteContextWindow, type XaiCorrelationState } from './acp-xai-session-notify'
import {
  extractAntigravityTurnUsageAndThinking,
  mergeWireTurnUsage,
  type AntigravityWireTurnUsage,
} from './antigravity-usage'

export interface AntigravityTurnThinkingScope {
  sawAgentThoughtChunk: boolean
  stepIndex: number
  stepStartedAt: number
  currentStepHasThinking: boolean
  currentStepThinkingClosed: boolean
  currentStepHasThoughtText: boolean
  pendingThoughtNewline?: boolean
  readonly emittedStepThinkingIds: string[]
  latestWireUsage?: AntigravityWireTurnUsage | null
}

export function openAntigravityThinkingStep(
  turnScope: AntigravityTurnThinkingScope,
  targetMessageId: string,
  emitEvent: (event: AgentEvent) => void,
): void {
  if (turnScope.currentStepHasThinking) return
  const now = Date.now()
  turnScope.stepStartedAt = now
  turnScope.currentStepHasThinking = true
  turnScope.currentStepThinkingClosed = false
  turnScope.currentStepHasThoughtText = false
  turnScope.pendingThoughtNewline = false
  const thinkId = `agy_think_step_${turnScope.stepIndex}`
  if (!turnScope.emittedStepThinkingIds.includes(thinkId)) {
    turnScope.emittedStepThinkingIds.push(thinkId)
  }
  emitEvent({
    type: 'content_delta',
    messageId: targetMessageId,
    delta: {
      type: 'thinking',
      id: thinkId,
      thinking: '',
      startedAt: now,
    },
  })
}

export function closeAntigravityThinkingStep(
  turnScope: AntigravityTurnThinkingScope,
  targetMessageId: string,
  emitEvent: (event: AgentEvent) => void,
): void {
  if (!turnScope.currentStepHasThinking || turnScope.currentStepThinkingClosed) return
  turnScope.currentStepThinkingClosed = true
  turnScope.pendingThoughtNewline = false
  if (!turnScope.currentStepHasThoughtText) {
    emitEvent({
      type: 'content_retracted',
      messageId: targetMessageId,
      blocks: [{ type: 'thinking', thinking: '' }],
    })
    turnScope.emittedStepThinkingIds.pop()
    turnScope.currentStepHasThinking = false
    return
  }
  const thinkId = `agy_think_step_${turnScope.stepIndex}`
  emitEvent({
    type: 'content_delta',
    messageId: targetMessageId,
    delta: {
      type: 'thinking',
      id: thinkId,
      thinking: '',
      startedAt: turnScope.stepStartedAt,
      endedAt: Date.now(),
    },
  })
}

export function stampAntigravityThoughtDeltas(
  turnScope: AntigravityTurnThinkingScope,
  events: AgentEvent[],
): void {
  turnScope.sawAgentThoughtChunk = true
  const thinkId = `agy_think_step_${turnScope.stepIndex}`
  for (const ev of events) {
    if (ev.type === 'content_delta' && ev.delta.type === 'thinking') {
      const rawText = ev.delta.thinking
      let cleaned = rawText.replace(/\r\n/g, '\n').replace(/\n(?:[ \t]*\n)+/g, '\n\n')
      if (!turnScope.currentStepHasThoughtText) {
        cleaned = cleaned.replace(/^\n+/, '')
      }
      const endsWithNewline = cleaned.endsWith('\n')
      cleaned = cleaned.replace(/\n+$/, '')
      if (cleaned.length > 0) {
        if (
          turnScope.currentStepHasThoughtText &&
          (turnScope.pendingThoughtNewline || rawText.startsWith('\n'))
        ) {
          cleaned = `\n\n${cleaned.replace(/^\n+/, '')}`
        }
        turnScope.currentStepHasThoughtText = true
        turnScope.pendingThoughtNewline = endsWithNewline
      } else if (turnScope.currentStepHasThoughtText && endsWithNewline) {
        turnScope.pendingThoughtNewline = true
      }
      ev.delta = {
        type: 'thinking',
        id: thinkId,
        thinking: cleaned,
        startedAt: turnScope.stepStartedAt,
      }
    }
  }
}

export function syncAntigravityTurnFromDb(
  sessionId: string,
  targetMessageId: string,
  turnScope: AntigravityTurnThinkingScope,
  xaiCorrelation: XaiCorrelationState,
  emitEvent: (event: AgentEvent) => void,
  isTurnEnd = false,
  wireUsage?: AntigravityWireTurnUsage | null,
): boolean {
  if (wireUsage) {
    turnScope.latestWireUsage = mergeWireTurnUsage(turnScope.latestWireUsage, wireUsage)
  }
  const effectiveWire = turnScope.latestWireUsage ?? wireUsage ?? null
  const summary = extractAntigravityTurnUsageAndThinking(sessionId)
  if (!summary && !effectiveWire) return false
  if (summary && !turnScope.sawAgentThoughtChunk) {
    for (let i = 0; i < summary.thinkingSteps.length; i += 1) {
      const step = summary.thinkingSteps[i]
      const hasDbText = step.thinkingText.trim().length > 0
      if (!hasDbText) continue
      const thinkId = turnScope.emittedStepThinkingIds[i] ?? `agy_think_step_${i}`
      if (!turnScope.emittedStepThinkingIds.includes(thinkId)) {
        turnScope.emittedStepThinkingIds.push(thinkId)
      }
      const isCurrentOpenStep =
        !isTurnEnd &&
        i === turnScope.stepIndex &&
        turnScope.currentStepHasThinking &&
        !turnScope.currentStepThinkingClosed
      if (i === turnScope.stepIndex) {
        turnScope.currentStepHasThoughtText = true
      }
      emitEvent({
        type: 'content_delta',
        messageId: targetMessageId,
        replace: true,
        delta: {
          type: 'thinking',
          id: thinkId,
          thinking: step.thinkingText,
          startedAt: step.startedAt,
          ...(isCurrentOpenStep ? {} : { endedAt: step.endedAt }),
        },
      })
    }
  }
  const hasDbTokenSummary =
    summary !== null &&
    (summary.inputTokens > 0 || summary.outputTokens > 0 || summary.cacheReadTokens > 0)
  const inputTokens = hasDbTokenSummary ? summary.inputTokens : (effectiveWire?.inputTokens ?? 0)
  const outputTokens = hasDbTokenSummary ? summary.outputTokens : (effectiveWire?.outputTokens ?? 0)
  const cacheReadTokens = hasDbTokenSummary ? summary.cacheReadTokens : (effectiveWire?.cacheReadTokens ?? 0)
  const rawContextTokens = (summary?.contextTokens ?? 0) > 0 ? summary!.contextTokens : (effectiveWire?.contextTokens ?? 0)
  const contextTokens = rawContextTokens > 0
    ? rawContextTokens
    : (xaiCorrelation.lastUsage?.totalTokens ?? 0) > 0
      ? xaiCorrelation.lastUsage!.totalTokens
      : inputTokens + cacheReadTokens + outputTokens
  const rawContextWindow = (summary?.contextWindow ?? 0) > 0 ? summary!.contextWindow : (effectiveWire?.contextWindow ?? 0)
  const model = summary?.model || effectiveWire?.model || ''

  if (rawContextWindow > 0) noteContextWindow(xaiCorrelation, rawContextWindow)
  const resolvedModel = model || (xaiCorrelation.lastUsage?.model ?? '')
  const fallbackWindow = resolvedModel.toLowerCase().includes('claude') ? 200_000 : resolvedModel.toLowerCase().includes('gpt') ? 128_000 : 1_048_576
  const maxTokens = rawContextWindow > 0
    ? rawContextWindow
    : (xaiCorrelation.lastUsage?.maxTokens ?? 0) > 0
      ? xaiCorrelation.lastUsage!.maxTokens
      : contextTokens > 0 ? fallbackWindow : 0
  if (contextTokens > 0) {
    xaiCorrelation.lastUsage = {
      categories: xaiCorrelation.lastUsage?.categories ?? [],
      totalTokens: contextTokens,
      maxTokens,
      percentage: maxTokens > 0 ? Math.min(100, Math.round((contextTokens / maxTokens) * 100)) : (xaiCorrelation.lastUsage?.percentage ?? 0),
      model: resolvedModel,
    }
  }
  if (inputTokens > 0 || outputTokens > 0 || cacheReadTokens > 0 || contextTokens > 0) {
    emitEvent({
      type: 'message_usage',
      messageId: targetMessageId,
      inputTokens,
      outputTokens,
      ...(cacheReadTokens > 0 ? { cacheReadTokens } : {}),
      ...(contextTokens > 0 ? { contextTokens } : {}),
      ...(maxTokens > 0 ? { contextWindow: maxTokens } : {}),
      ...(model ? { model } : {}),
    })
    return true
  }
  return false
}

export function advanceAntigravityThinkingStepAfterTools(
  sessionId: string,
  targetMessageId: string,
  turnScope: AntigravityTurnThinkingScope,
  xaiCorrelation: XaiCorrelationState,
  emitEvent: (event: AgentEvent) => void,
): void {
  turnScope.stepIndex += 1
  turnScope.currentStepHasThinking = false
  turnScope.currentStepThinkingClosed = false
  turnScope.currentStepHasThoughtText = false
  turnScope.stepStartedAt = Date.now()
  syncAntigravityTurnFromDb(sessionId, targetMessageId, turnScope, xaiCorrelation, emitEvent)
}

export function finalizeAntigravityTurnThinking(
  sessionId: string,
  targetMessageId: string,
  turnScope: AntigravityTurnThinkingScope,
  xaiCorrelation: XaiCorrelationState,
  emitEvent: (event: AgentEvent) => void,
  promptResponseUsage?: AntigravityWireTurnUsage | null,
): void {
  if (turnScope.currentStepHasThinking && !turnScope.currentStepThinkingClosed) {
    if (!turnScope.currentStepHasThoughtText) {
      emitEvent({
        type: 'content_retracted',
        messageId: targetMessageId,
        blocks: [{ type: 'thinking', thinking: '' }],
      })
      turnScope.emittedStepThinkingIds.pop()
      turnScope.currentStepHasThinking = false
    } else {
      closeAntigravityThinkingStep(turnScope, targetMessageId, emitEvent)
    }
  }
  syncAntigravityTurnFromDb(
    sessionId,
    targetMessageId,
    turnScope,
    xaiCorrelation,
    emitEvent,
    true,
    promptResponseUsage,
  )
}
