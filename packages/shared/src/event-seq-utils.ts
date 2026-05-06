import type { AgentEvent, ChatMessage } from './agent-types'

export function isReplayedEventForMessage(event: AgentEvent, message: ChatMessage): boolean {
  if (event.seq === undefined) return false
  if (message._lastAppliedSeq === undefined) return false
  if (event.epoch !== message._lastAppliedEpoch) return false
  return event.seq <= message._lastAppliedSeq
}

export function applySeqToMessage(event: AgentEvent): Partial<Pick<ChatMessage, '_lastAppliedSeq' | '_lastAppliedEpoch'>> {
  if (event.seq === undefined) return {}
  return {
    _lastAppliedSeq: event.seq,
    ...(event.epoch !== undefined ? { _lastAppliedEpoch: event.epoch } : {}),
  }
}

export function compareMessageSeq(a: ChatMessage, b: ChatMessage): number {
  const aEpoch = a._lastAppliedEpoch ?? -1
  const bEpoch = b._lastAppliedEpoch ?? -1
  if (aEpoch !== bEpoch) return aEpoch - bEpoch
  const aSeq = a._lastAppliedSeq ?? -1
  const bSeq = b._lastAppliedSeq ?? -1
  return aSeq - bSeq
}
