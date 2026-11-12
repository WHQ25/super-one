import type { AgentStatus, ChatMessage, HarnessId } from '@superone/shared/agent-types'
import { isAcpProtocolHarness } from '@superone/shared/acp-brand'
import { resolveHarnessCapabilities } from '@superone/shared/harness/harness-capabilities'
import type { HarnessRuntimeCapabilities } from '@superone/shared/harness/session-catalog'

export function shouldQueueComposerSend(status: AgentStatus, harness: HarnessId): boolean {
  if (status !== 'streaming') return false
  return harness === 'claude' || isAcpProtocolHarness(harness) || harness === 'opencode' || harness === 'codex' || harness === 'dsh'
}

export type ComposerSendKind = 'send' | 'steer'

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

export function canSteerQueued(harness: HarnessId, runtime?: HarnessRuntimeCapabilities): boolean {
  return resolveHarnessCapabilities(harness, runtime).supportsQueuedSteer === true
}

export function queuedMessageText(message: ChatMessage): string {
  return message.content
    .filter((block): block is Extract<ChatMessage['content'][number], { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join('')
}
