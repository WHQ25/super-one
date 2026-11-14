import type { AgentEvent } from '@superone/shared/agent-types'

type VoiceRemoteListener = (event: AgentEvent) => void

const listeners = new Set<VoiceRemoteListener>()

/** Remote-node events for a voice mirror. The chat hub still receives the same event. */
export function publishVoiceRemoteEvent(event: AgentEvent): void {
  for (const listener of listeners) listener(event)
}

export function subscribeVoiceRemoteEvents(listener: VoiceRemoteListener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
