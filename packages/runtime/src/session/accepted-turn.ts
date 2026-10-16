import type { MessageDisplayFields } from '@superone/shared/message-display'
import type { ChatMessageSource } from '@superone/shared/agent-types'
import type { TurnImageAttachment } from './types'
import type { InputAdmission } from './input-admission'

export interface TurnOpts extends MessageDisplayFields {
  inputAdmission?: InputAdmission
  parkInComposer?: boolean
  clientMessageId?: string
  echoUserMessage?: boolean
  text: string
  requestId?: string
  model?: string | null
  effort?: string | null
  agent?: string | null
  images?: TurnImageAttachment[]
  permissionMode?: string | null
  sandboxMode?: string | null
  additionalDirectories?: string[]
  enabledSkills?: string[]
  disabledSkills?: string[]
  apiProviderId?: string | null
  /** Codex turn kind (run|steer|review|compact). */
  turnKind?: 'run' | 'steer' | 'review' | 'compact' | null
  parentTurnId?: string
  rootTurnId?: string
  collaborationMode?: string | Record<string, unknown> | null
  reviewTarget?: unknown
  /**
   * Who wrote the text (see TurnRunner `source`). Transcript/events store a
   * redacted copy so collaboration credentials never leak into the UI snapshot.
   */
  source?: ChatMessageSource
  /** Claude Ultracode from this turn on; omitted keeps the live process's. */
  ultracode?: boolean
  claudeFastMode?: boolean
  /** The transcript user row this turn runs; absent for a model-only host wake. */
  userBlockId?: string
}
