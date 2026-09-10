import type { AgentStatus, ChatMessage, HarnessId } from '@superone/shared/agent-types'
import { HARNESS_CAPABILITIES } from '@superone/shared/harness/harness-capabilities'

/**
 * Desktop `isQueuedSend`: a live turn parks the composer send in the SuperOne-held
 * queue instead of appending it to the transcript. Cursor/dsh still live-send.
 *
 * Status is `AgentStatus` on purpose: a harness id is assignable to `string`,
 * so `shouldQueueComposerSend(selectedProvider)` type-checked and always
 * returned false (`'claude' !== 'streaming'`).
 */
export function shouldQueueComposerSend(status: AgentStatus, harness: HarnessId): boolean {
  if (status !== 'streaming') return false
  return harness === 'claude' || harness === 'acp' || harness === 'opencode' || harness === 'codex'
}

export type ComposerSendKind = 'send' | 'steer' | 'soon'

/**
 * Wire fields for a composer send. Mid-turn queueing (and steer/soon) must
 * carry `priority: 'next'` plus a client id so the runtime can park a bubble
 * and the host can consume it later — a bare `send_message` is serialized
 * behind the live turn and never appears in the transcript until then.
 */
export function composerQueuedSendFields(
  status: AgentStatus,
  harness: HarnessId,
  kind: ComposerSendKind = 'send',
): { queue: boolean; needsClientMessageId: boolean } {
  const queue = shouldQueueComposerSend(status, harness)
  const live = status === 'streaming'
  return {
    queue,
    needsClientMessageId: queue || (live && kind !== 'send'),
  }
}

export function canSteerQueued(harness: HarnessId): boolean {
  return HARNESS_CAPABILITIES[harness]?.supportsQueuedSteer === true
}

export function canSteerQueuedSoon(harness: HarnessId): boolean {
  return HARNESS_CAPABILITIES[harness]?.supportsQueuedSteerSoon === true
}

export function queuedMessageText(message: ChatMessage): string {
  return message.content
    .filter((block): block is Extract<ChatMessage['content'][number], { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join('')
}
