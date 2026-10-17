import type { ChatMessage, ChatMessageSource } from './agent-types'

/**
 * A host wake (`source: 'task-notification'`) resumes the model with a prompt
 * written for it: download / artifact receipts, collaboration wakes, plan
 * follow-ups. The tool row, inbox or decision card already shows the human
 * side, so the transcript keeps no bubble for one. The exception is a wake
 * whose text the user wrote (a Grok scheduled prompt): its producer marks it
 * `userAuthored` and it stays visible. Hidden is the default so a new wake
 * never leaks its model-facing prompt into the chat.
 */
export function isModelOnlyHostWake(input: { source?: ChatMessageSource; userAuthored?: boolean }): boolean {
  return input.source === 'task-notification' && !input.userAuthored
}

/**
 * Codex echoes collaboration-host's durable wake IDs without their source.
 * Restore it for provider history and older timeline caches. Prompt text is
 * never an identity: a human may paste the same notification into the composer.
 */
export function restoreHostWakeSource(message: ChatMessage): ChatMessage {
  if (message.role !== 'user' || message.metadata?.source !== undefined
    || !/^collab-(?:message|link|stop):.+/.test(message.id)) return message
  return { ...message, metadata: { ...message.metadata, source: 'task-notification' } }
}
