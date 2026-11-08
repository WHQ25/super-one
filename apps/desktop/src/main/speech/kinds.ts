import type { ResolvedService } from '@superone/shared/platform-registry'

/** Adapter a speech request is sent through. Compatible relays reuse the OpenAI audio routes. */
export type SpeechProviderKind = 'openai' | 'openai-compatible' | 'elevenlabs' | 'google'

const DEFAULT_VOICE: Record<SpeechProviderKind, string> = {
  openai: 'alloy',
  'openai-compatible': 'alloy',
  // Legacy premade voice. Free API accounts cannot use it; synthesis prefers an owned voice.
  elevenlabs: '21m00Tcm4TlvDq8ikWAM',
  google: 'Kore',
}

export function defaultVoice(kind: SpeechProviderKind): string {
  return DEFAULT_VOICE[kind]
}

function officialOpenAI(resolved: Pick<ResolvedService, 'platformId'>): boolean {
  return resolved.platformId === 'openai' || resolved.platformId === 'openai-official'
}

/** Adapter selection for speech protocols. Official OpenAI uses the strict client; relays share its routes. */
export function speechKindFor(resolved: Pick<ResolvedService, 'platformId' | 'protocol'>): SpeechProviderKind {
  switch (resolved.protocol) {
    case 'elevenlabs-audio':
      return 'elevenlabs'
    case 'google-generative':
      return 'google'
    case 'openai-audio':
      return officialOpenAI(resolved) ? 'openai' : 'openai-compatible'
    default:
      throw new Error(`protocol '${resolved.protocol}' does not serve speech`)
  }
}
