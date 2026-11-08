import { readAppSettings } from '../app-settings-service'
import { defaultVoice, type SpeechProviderKind } from './kinds'

/** The voice saved for this credential, when Settings has one. */
export function savedSpeechVoice(credentialId: string): string | undefined {
  const voice = readAppSettings().speechVoices?.[credentialId]
  return typeof voice === 'string' && voice.trim() ? voice.trim() : undefined
}

/**
 * Explicit tool input wins. Otherwise the voice saved for this credential.
 * Otherwise the driver default.
 */
export function resolveSpeechVoice(
  kind: SpeechProviderKind,
  credentialId: string,
  explicit?: string | null,
): string {
  return explicit?.trim() || savedSpeechVoice(credentialId) || defaultVoice(kind)
}
