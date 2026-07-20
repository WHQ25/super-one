import { describe, expect, it } from 'vitest'
import { customEndpointsFor, customPlatformEndpoints, familyBaseUrl } from './protocols'

describe('customEndpointsFor', () => {
  it('maps anthropic chat to a single messages endpoint keyed by family', () => {
    expect(customEndpointsFor('anthropic', ['chat'], 'https://x/v1')).toEqual([
      { id: 'anthropic', baseUrl: 'https://x/v1', protocols: ['anthropic-messages'] },
    ])
  })

  it('collapses openai chat + image into one endpoint speaking both protocols in priority order', () => {
    expect(customEndpointsFor('openai', ['image', 'chat'], 'https://x/v1')).toEqual([
      { id: 'openai', baseUrl: 'https://x/v1', protocols: ['openai-chat', 'openai-images'] },
    ])
  })

  it('collapses openai tts + asr into one endpoint (both served by the audio protocol)', () => {
    expect(customEndpointsFor('openai', ['tts', 'asr'], 'https://x/v1')).toEqual([
      { id: 'openai', baseUrl: 'https://x/v1', protocols: ['openai-audio'] },
    ])
  })

  it('does not carry a narrowing field when only one of tts/asr is picked (narrowing is by models)', () => {
    expect(customEndpointsFor('openai', ['tts'], 'https://x/v1')).toEqual([
      { id: 'openai', baseUrl: 'https://x/v1', protocols: ['openai-audio'] },
    ])
  })

  it('collapses gemini capabilities into one generative endpoint', () => {
    expect(customEndpointsFor('google', ['chat', 'tts'], 'https://x/v1')).toEqual([
      { id: 'google', baseUrl: 'https://x/v1', protocols: ['google-generative'] },
    ])
  })

  it('ignores capabilities the family has no protocol for (e.g. image on anthropic)', () => {
    expect(customEndpointsFor('anthropic', ['image'], 'https://x/v1')).toEqual([])
  })

  it('derives the sora-shaped video wire for an openai-compatible relay', () => {
    expect(customEndpointsFor('openai', ['video'], 'https://x/v1')).toEqual([
      { id: 'openai', baseUrl: 'https://x/v1', protocols: ['openai-video'] },
    ])
  })

  it('keeps veo on its own wire alongside generateContent in one gemini endpoint', () => {
    expect(customEndpointsFor('google', ['chat', 'video'], 'https://x/v1')).toEqual([
      { id: 'google', baseUrl: 'https://x/v1', protocols: ['google-generative', 'google-video'] },
    ])
  })

  it('appends an opt-in extra wire (openai-responses) ahead of chat/completions in priority order', () => {
    expect(customEndpointsFor('openai', ['chat'], 'https://x/v1', ['openai-responses'])).toEqual([
      { id: 'openai', baseUrl: 'https://x/v1', protocols: ['openai-responses', 'openai-chat'] },
    ])
  })

  it('builds a Responses-only endpoint (Codex gateway) when only the extra wire is picked', () => {
    expect(customEndpointsFor('openai', [], 'https://x/v1', ['openai-responses'])).toEqual([
      { id: 'openai', baseUrl: 'https://x/v1', protocols: ['openai-responses'] },
    ])
  })

  it('drops an extra wire the family does not offer', () => {
    expect(customEndpointsFor('anthropic', ['chat'], 'https://x/v1', ['openai-responses'])).toEqual([
      { id: 'anthropic', baseUrl: 'https://x/v1', protocols: ['anthropic-messages'] },
    ])
  })
})

describe('customPlatformEndpoints (multiple compat formats, per-format capabilities)', () => {
  it('emits one endpoint per selected family sharing the base URL (Claude + OpenAI relay)', () => {
    const endpoints = customPlatformEndpoints({ anthropic: ['chat'], openai: ['chat'] }, 'https://relay/v1')
    expect(endpoints).toEqual([
      { id: 'anthropic', baseUrl: 'https://relay/v1', protocols: ['anthropic-messages'] },
      { id: 'openai', baseUrl: 'https://relay/v1', protocols: ['openai-chat'] },
    ])
  })

  it('honors a different capability set per format', () => {
    // openai exposes chat+image (one endpoint, two protocols); gemini only chat.
    const endpoints = customPlatformEndpoints({ openai: ['chat', 'image'], google: ['chat'] }, 'https://relay/v1')
    expect(endpoints.map((e) => e.protocols)).toEqual([['openai-chat', 'openai-images'], ['google-generative']])
  })

  it('drops capabilities a format cannot serve (image passed to anthropic)', () => {
    const endpoints = customPlatformEndpoints({ anthropic: ['chat', 'image'] }, 'https://relay/v1')
    expect(endpoints.map((e) => e.protocols)).toEqual([['anthropic-messages']])
  })

  it('orders families canonically regardless of map key order', () => {
    const endpoints = customPlatformEndpoints({ google: ['chat'], anthropic: ['chat'] }, 'https://relay/v1')
    expect(endpoints.map((e) => e.id)).toEqual(['anthropic', 'google'])
  })

  it('skips a selected format with no capabilities picked', () => {
    expect(customPlatformEndpoints({ anthropic: ['chat'], openai: [] }, 'https://relay/v1').map((e) => e.id)).toEqual([
      'anthropic',
    ])
  })

  it('carries an opt-in extra wire onto its family endpoint', () => {
    const endpoints = customPlatformEndpoints({ openai: ['chat'] }, 'https://relay/v1', { openai: ['openai-responses'] })
    expect(endpoints).toEqual([
      { id: 'openai', baseUrl: 'https://relay/v1', protocols: ['openai-responses', 'openai-chat'] },
    ])
  })

  it('emits a family endpoint even when only its extra wire is picked (no tasks)', () => {
    const endpoints = customPlatformEndpoints({}, 'https://relay/v1', { openai: ['openai-responses'] })
    expect(endpoints).toEqual([{ id: 'openai', baseUrl: 'https://relay/v1', protocols: ['openai-responses'] }])
  })
})

describe('familyBaseUrl (single relay root → per-protocol base URL)', () => {
  it('appends /v1 to an openai root that has no version segment', () => {
    expect(familyBaseUrl('openai', 'https://relay.com')).toBe('https://relay.com/v1')
  })

  it('leaves an openai root that already carries a version segment untouched', () => {
    expect(familyBaseUrl('openai', 'https://relay.com/v1')).toBe('https://relay.com/v1')
    expect(familyBaseUrl('openai', 'https://relay.com/v3')).toBe('https://relay.com/v3')
  })

  it('strips a trailing slash before appending /v1', () => {
    expect(familyBaseUrl('openai', 'https://relay.com/')).toBe('https://relay.com/v1')
  })

  it('addresses anthropic and google from the root verbatim (trailing slash stripped)', () => {
    expect(familyBaseUrl('anthropic', 'https://relay.com')).toBe('https://relay.com')
    expect(familyBaseUrl('anthropic', 'https://relay.com/')).toBe('https://relay.com')
    expect(familyBaseUrl('google', 'https://relay.com')).toBe('https://relay.com')
  })

  it('returns an empty root unchanged (official OAuth platforms carry no base)', () => {
    expect(familyBaseUrl('openai', '')).toBe('')
  })
})

describe('customPlatformEndpoints (NewAPI-style relay: one site root, all protocols)', () => {
  it('splits a bare site root into anthropic={root} + openai={root}/v1 (chat + codex + image)', () => {
    const endpoints = customPlatformEndpoints({ anthropic: ['chat'], openai: ['chat', 'image'] }, 'https://relay.com')
    expect(endpoints).toEqual([
      { id: 'anthropic', baseUrl: 'https://relay.com', protocols: ['anthropic-messages'] },
      { id: 'openai', baseUrl: 'https://relay.com/v1', protocols: ['openai-chat', 'openai-images'] },
    ])
  })

  it('is idempotent when the root already ends in /v1', () => {
    const endpoints = customPlatformEndpoints({ anthropic: ['chat'], openai: ['chat', 'image'] }, 'https://relay.com/v1')
    expect(endpoints.map((e) => e.baseUrl)).toEqual(['https://relay.com/v1', 'https://relay.com/v1'])
  })
})
