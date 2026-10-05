export const COMPOSER_IDS = ['decision', 'app-consent', 'voice', 'text'] as const

export type ComposerId = (typeof COMPOSER_IDS)[number]

export interface ComposerInputs {
  needsDecision: boolean
  decisionAvailable?: boolean
  appConsent: boolean
  voiceEngaged: boolean
}

/** Resolves the single composer visible in the chat slot. */
export function resolveComposer({
  needsDecision,
  decisionAvailable = true,
  appConsent,
  voiceEngaged,
}: ComposerInputs): ComposerId {
  if (needsDecision && decisionAvailable) return 'decision'
  if (appConsent) return 'app-consent'
  if (voiceEngaged) return 'voice'
  return 'text'
}
