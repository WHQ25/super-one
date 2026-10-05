export const COMPOSER_IDS = ['decision', 'app-consent', 'voice', 'text'] as const

export type BuiltinComposerId = (typeof COMPOSER_IDS)[number]
export type ComposerId = BuiltinComposerId | (string & {})

export interface ComposerInputs {
  needsDecision: boolean
  decisionAvailable?: boolean
  appConsent: boolean
  voiceEngaged: boolean
  openedComposerId?: string | null
}

/** Resolves the single composer visible in the chat slot. */
export function resolveComposer({
  needsDecision,
  decisionAvailable = true,
  appConsent,
  voiceEngaged,
  openedComposerId,
}: ComposerInputs): ComposerId {
  if (needsDecision && decisionAvailable) return 'decision'
  if (appConsent) return 'app-consent'
  if (decisionAvailable && openedComposerId) return openedComposerId
  if (voiceEngaged) return 'voice'
  return 'text'
}
