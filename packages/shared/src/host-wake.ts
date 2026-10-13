import type { ChatMessageSource } from './agent-types'

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
