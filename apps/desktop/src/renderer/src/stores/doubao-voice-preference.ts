import type { DesktopVoicePreference, DoubaoVoiceSettings } from '@superone/shared/doubao-call'
import { create } from 'zustand'

interface DoubaoVoicePreferenceState {
  preference: DesktopVoicePreference
  configured: boolean
}

export const useDoubaoVoicePreference = create<DoubaoVoicePreferenceState>(() => ({
  preference: 'auto',
  configured: false,
}))

export function applyDoubaoVoiceSettings(settings: DoubaoVoiceSettings): void {
  useDoubaoVoicePreference.setState({
    preference: settings.preference,
    configured: settings.key.configured,
  })
}

/** Loads the composer's voice route. Missing IPC leaves Codex as the only button. */
export function refreshDoubaoVoicePreference(): void {
  const read = window.app?.getDoubaoVoiceSettings
  if (!read) return
  void read().then(applyDoubaoVoiceSettings).catch(() => {})
}
