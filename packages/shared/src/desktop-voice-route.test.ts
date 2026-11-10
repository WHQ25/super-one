import { describe, expect, it } from 'vitest'
import { parseDesktopVoicePreference, resolveDesktopVoiceRoute } from './desktop-voice-route'

describe('parseDesktopVoicePreference', () => {
  it('keeps Gemini and treats every other stored value as Doubao', () => {
    expect(parseDesktopVoicePreference('gemini')).toBe('gemini')
    expect(parseDesktopVoicePreference('doubao')).toBe('doubao')
    expect(parseDesktopVoicePreference('auto')).toBe('doubao')
    expect(parseDesktopVoicePreference('codex')).toBe('doubao')
    expect(parseDesktopVoicePreference(null)).toBe('doubao')
    expect(parseDesktopVoicePreference(undefined)).toBe('doubao')
  })
})

describe('desktop voice route', () => {
  it('keeps official Codex on Realtime even when another model is selected', () => {
    expect(resolveDesktopVoiceRoute({
      preference: 'doubao', harnessId: 'codex', apiProviderId: 'codex-account:cli', canSend: true, doubaoConfigured: true,
    })).toBe('codex')
    expect(resolveDesktopVoiceRoute({
      preference: 'gemini', harnessId: 'codex', apiProviderId: 'codex-account:cli', canSend: true, doubaoConfigured: true, geminiConfigured: true,
    })).toBe('codex')
    expect(resolveDesktopVoiceRoute({
      preference: 'doubao', harnessId: 'codex', apiProviderId: null, canSend: true, doubaoConfigured: true,
    })).toBe('codex')
    expect(resolveDesktopVoiceRoute({
      preference: 'gemini', harnessId: 'codex', apiProviderId: 'custom-key', canSend: true, doubaoConfigured: true, geminiConfigured: true,
    })).toBe('gemini')
    expect(resolveDesktopVoiceRoute({
      preference: 'doubao', harnessId: 'codex', apiProviderId: 'custom-key', canSend: true, doubaoConfigured: true, geminiConfigured: true,
    })).toBe('doubao')
  })

  it('uses the selected model only when that key is saved', () => {
    expect(resolveDesktopVoiceRoute({
      preference: 'doubao', harnessId: 'claude', canSend: true, doubaoConfigured: true,
    })).toBe('doubao')
    expect(resolveDesktopVoiceRoute({
      preference: 'doubao', harnessId: 'claude', canSend: true, doubaoConfigured: true, geminiConfigured: true,
    })).toBe('doubao')
    expect(resolveDesktopVoiceRoute({
      preference: 'doubao', harnessId: 'claude', canSend: true, doubaoConfigured: false, geminiConfigured: true,
    })).toBeNull()
    expect(resolveDesktopVoiceRoute({
      preference: 'gemini', harnessId: 'claude', canSend: true, doubaoConfigured: true, geminiConfigured: true,
    })).toBe('gemini')
    expect(resolveDesktopVoiceRoute({
      preference: 'gemini', harnessId: 'claude', canSend: true, doubaoConfigured: true, geminiConfigured: false,
    })).toBeNull()
    expect(resolveDesktopVoiceRoute({
      preference: 'gemini', harnessId: 'claude', canSend: false, doubaoConfigured: false, geminiConfigured: true,
    })).toBeNull()
    expect(resolveDesktopVoiceRoute({
      preference: 'doubao', harnessId: 'claude', canSend: false, doubaoConfigured: true,
    })).toBeNull()
    expect(resolveDesktopVoiceRoute({
      preference: 'doubao', harnessId: 'claude', canSend: true, doubaoConfigured: false,
    })).toBeNull()
  })
})
