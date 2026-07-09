import { describe, expect, it } from 'vitest'
import { customEndpointsFor, customPlatformEndpoints } from './protocols'

describe('customEndpointsFor', () => {
  it('maps anthropic chat to a single messages endpoint without a narrowing tasks field', () => {
    expect(customEndpointsFor('anthropic', ['chat'], 'https://x/v1')).toEqual([
      { id: 'messages', protocol: 'anthropic-messages', baseUrl: 'https://x/v1' },
    ])
  })

  it('splits openai chat + image into separate chat and images endpoints in priority order', () => {
    const endpoints = customEndpointsFor('openai', ['image', 'chat'], 'https://x/v1')
    expect(endpoints.map((e) => e.protocol)).toEqual(['openai-chat', 'openai-images'])
    expect(endpoints.every((e) => e.baseUrl === 'https://x/v1')).toBe(true)
    expect(endpoints.some((e) => e.tasks)).toBe(false)
  })

  it('collapses openai tts + asr into one audio endpoint (full set → no narrowing)', () => {
    expect(customEndpointsFor('openai', ['tts', 'asr'], 'https://x/v1')).toEqual([
      { id: 'audio', protocol: 'openai-audio', baseUrl: 'https://x/v1' },
    ])
  })

  it('narrows the audio endpoint tasks when only one of tts/asr is picked', () => {
    expect(customEndpointsFor('openai', ['tts'], 'https://x/v1')).toEqual([
      { id: 'audio', protocol: 'openai-audio', baseUrl: 'https://x/v1', tasks: ['tts'] },
    ])
  })

  it('collapses gemini capabilities into one generative endpoint, narrowing to the picked subset', () => {
    expect(customEndpointsFor('google', ['chat', 'tts'], 'https://x/v1')).toEqual([
      { id: 'generative', protocol: 'google-generative', baseUrl: 'https://x/v1', tasks: ['chat', 'tts'] },
    ])
  })

  it('ignores capabilities the family has no protocol for (e.g. video)', () => {
    expect(customEndpointsFor('openai', ['video'], 'https://x/v1')).toEqual([])
  })
})

describe('customPlatformEndpoints (multiple compat formats, per-format capabilities)', () => {
  it('emits one chat endpoint per selected family sharing the base URL (Claude + OpenAI relay)', () => {
    const endpoints = customPlatformEndpoints({ anthropic: ['chat'], openai: ['chat'] }, 'https://relay/v1')
    expect(endpoints).toEqual([
      { id: 'messages', protocol: 'anthropic-messages', baseUrl: 'https://relay/v1' },
      { id: 'chat', protocol: 'openai-chat', baseUrl: 'https://relay/v1' },
    ])
  })

  it('honors a different capability set per format', () => {
    // openai exposes chat+image; gemini only chat.
    const endpoints = customPlatformEndpoints({ openai: ['chat', 'image'], google: ['chat'] }, 'https://relay/v1')
    expect(endpoints.map((e) => e.protocol)).toEqual(['openai-chat', 'openai-images', 'google-generative'])
  })

  it('drops capabilities a format cannot serve (image passed to anthropic)', () => {
    const endpoints = customPlatformEndpoints({ anthropic: ['chat', 'image'] }, 'https://relay/v1')
    expect(endpoints.map((e) => e.protocol)).toEqual(['anthropic-messages'])
  })

  it('orders families canonically regardless of map key order', () => {
    const endpoints = customPlatformEndpoints({ google: ['chat'], anthropic: ['chat'] }, 'https://relay/v1')
    expect(endpoints.map((e) => e.protocol)).toEqual(['anthropic-messages', 'google-generative'])
  })

  it('skips a selected format with no capabilities picked', () => {
    expect(customPlatformEndpoints({ anthropic: ['chat'], openai: [] }, 'https://relay/v1').map((e) => e.protocol)).toEqual([
      'anthropic-messages',
    ])
  })
})
