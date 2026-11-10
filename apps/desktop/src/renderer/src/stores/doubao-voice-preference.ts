import type { DesktopVoicePreference, DesktopVoiceSettings } from '@superone/shared/desktop-voice-route'
import { create } from 'zustand'

interface DoubaoVoicePreferenceState {
  preference: DesktopVoicePreference
  configured: boolean
  geminiConfigured: boolean
}

export const useDoubaoVoicePreference = create<DoubaoVoicePreferenceState>(() => ({
  preference: 'doubao',
  configured: false,
  geminiConfigured: false,
}))

export function applyDoubaoVoiceSettings(settings: DesktopVoiceSettings): void {
  useDoubaoVoicePreference.setState({
    preference: settings.preference,
    configured: settings.key.configured,
    geminiConfigured: settings.geminiKey.configured,
  })
}

/** Loads the composer's voice route. Missing IPC leaves Codex as the only button. */
export function refreshDoubaoVoicePreference(): void {
  const read = window.app?.getDoubaoVoiceSettings
  if (!read) return
  void read().then(applyDoubaoVoiceSettings).catch(() => {})
}
