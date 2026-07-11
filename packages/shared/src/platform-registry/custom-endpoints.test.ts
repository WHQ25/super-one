import { describe, expect, it } from 'vitest'
import { customEndpointsFor, customPlatformEndpoints } from './protocols'

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

  it('ignores capabilities the family has no protocol for (e.g. video)', () => {
    expect(customEndpointsFor('openai', ['video'], 'https://x/v1')).toEqual([])
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
})
