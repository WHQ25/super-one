import type { SDKMessageOrigin } from '@anthropic-ai/claude-agent-sdk'
import type { ChatMessageSource } from '@superone/shared/agent-types'

/**
 * SDK provenance for a user turn SuperOne sends. The CLI keeps keyboard-only
 * behaviour — the `ultracode` keyword among it — to messages stamped human and
 * treats an absent origin as unattributed. A send without a source is the
 * user's own text, typed now or set up earlier (composer, phone, scheduled send,
 * automation); peer collaboration and host wake-ups are not.
 */
export function claudeMessageOrigin(source: ChatMessageSource | undefined): SDKMessageOrigin | undefined {
  return source === undefined || source === 'user' ? { kind: 'human' } : undefined
}
