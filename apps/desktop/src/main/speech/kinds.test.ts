import { describe, expect, it } from 'vitest'
import { defaultVoice, speechKindFor } from './kinds'

describe('speechKindFor', () => {
  it('selects the adapter from the wire protocol', () => {
    expect(speechKindFor({ platformId: 'elevenlabs', protocol: 'elevenlabs-audio' })).toBe('elevenlabs')
    expect(speechKindFor({ platformId: 'gemini', protocol: 'google-generative' })).toBe('google')
    expect(speechKindFor({ platformId: 'openai', protocol: 'openai-audio' })).toBe('openai')
    expect(speechKindFor({ platformId: 'openai-official', protocol: 'openai-audio' })).toBe('openai')
    expect(speechKindFor({ platformId: 'openrouter', protocol: 'openai-audio' })).toBe('openai-compatible')
  })

  it('refuses a protocol that does not serve speech', () => {
    expect(() => speechKindFor({ platformId: 'openai', protocol: 'openai-responses' })).toThrow(/does not serve speech/)
  })
})

describe('defaultVoice', () => {
  it('uses a premade voice for each adapter', () => {
    expect(defaultVoice('elevenlabs')).toBe('21m00Tcm4TlvDq8ikWAM')
    expect(defaultVoice('openai')).toBe('alloy')
    expect(defaultVoice('google')).toBe('Kore')
  })
})
