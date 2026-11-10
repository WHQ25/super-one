import { HARNESS_CAPABILITIES } from './harness/harness-capabilities'
import { isCodexAccountProvider } from './codex-accounts'

export type DesktopVoicePreference = 'doubao' | 'gemini'
export type DesktopVoiceRoute = 'codex' | 'doubao' | 'gemini'

/** What the renderer may see. Speech keys stay in the main process. */
export interface DesktopVoiceSettings {
  preference: DesktopVoicePreference
  speaker: string
  geminiVoice: string
  key: { configured: boolean; masked: string }
  geminiKey: { configured: boolean; masked: string }
}

/** Stored `auto` and `codex` values are the Doubao model. Codex Realtime is chosen by the session, not this setting. */
export function parseDesktopVoicePreference(value: unknown): DesktopVoicePreference {
  return value === 'gemini' ? 'gemini' : 'doubao'
}

/**
 * Official Codex always keeps its own Realtime voice.
 * Every other sendable session uses the selected model when that model's key is saved.
 */
export function resolveDesktopVoiceRoute(input: {
  preference: DesktopVoicePreference
  harnessId: string
  apiProviderId?: string | null
  canSend: boolean
  doubaoConfigured: boolean
  geminiConfigured?: boolean
}): DesktopVoiceRoute | null {
  const caps = HARNESS_CAPABILITIES[input.harnessId as keyof typeof HARNESS_CAPABILITIES]
  const officialCodex = input.harnessId === 'codex'
    && caps?.supportsRealtimeVoice === true
    && (!input.apiProviderId || isCodexAccountProvider(input.apiProviderId))
  if (officialCodex) return 'codex'
  const doubao = input.doubaoConfigured && input.canSend
  const gemini = input.geminiConfigured === true && input.canSend
  if (input.preference === 'gemini') return gemini ? 'gemini' : null
  return doubao ? 'doubao' : null
}
