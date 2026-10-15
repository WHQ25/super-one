export const COMPOSER_IDS = ['decision', 'app-consent', 'app-input', 'voice', 'continuation', 'text'] as const

export type BuiltinComposerId = (typeof COMPOSER_IDS)[number]
export type ComposerId = BuiltinComposerId | (string & {})

export interface ComposerInputs {
  needsDecision: boolean
  decisionAvailable?: boolean
  appConsent: boolean
  appInput?: boolean
  voiceEngaged: boolean
  openedComposerId?: string | null
  /** A long session whose cache expired is offered a handoff to a new session. */
  continuationOffered?: boolean
}

/** Resolves the single composer visible in the chat slot. */
export function resolveComposer({
  needsDecision,
  decisionAvailable = true,
  appConsent,
  appInput,
  voiceEngaged,
  openedComposerId,
  continuationOffered,
}: ComposerInputs): ComposerId {
  if (needsDecision && decisionAvailable) return 'decision'
  if (appConsent) return 'app-consent'
  if (decisionAvailable && appInput) return 'app-input'
  if (decisionAvailable && openedComposerId) return openedComposerId
  if (voiceEngaged) return 'voice'
  if (decisionAvailable && continuationOffered) return 'continuation'
  return 'text'
}
