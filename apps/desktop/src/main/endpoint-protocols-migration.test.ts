import { describe, expect, it } from 'vitest'
import type { EndpointOverride } from '@superone/shared/platform-registry'
import { regroupPlanEndpoints, remapOverrides, type OldServiceEndpoint } from './database-migrations'

describe('regroupPlanEndpoints', () => {
  it('collapses same-family protocols into one endpoint keyed by family and remaps their ids', () => {
    const old: OldServiceEndpoint[] = [
      { id: 'chat', baseUrl: 'https://x/v1', protocol: 'openai-chat' },
      { id: 'images', baseUrl: 'https://x/v1', protocol: 'openai-images' },
    ]
    const { endpoints, remap } = regroupPlanEndpoints(old)
    expect(endpoints).toEqual([
      { id: 'openai', baseUrl: 'https://x/v1', protocols: ['openai-chat', 'openai-images'] },
    ])
    expect(remap).toEqual({ chat: 'openai', images: 'openai' })
  })

  it('keeps cross-family endpoints separate (one per family) sharing the base url', () => {
    const old: OldServiceEndpoint[] = [
      { id: 'messages', baseUrl: 'https://relay/v1', protocol: 'anthropic-messages' },
      { id: 'chat', baseUrl: 'https://relay/v1', protocol: 'openai-chat' },
    ]
    const { endpoints, remap } = regroupPlanEndpoints(old)
    expect(endpoints.map((e) => e.id)).toEqual(['anthropic', 'openai'])
    expect(remap).toEqual({ messages: 'anthropic', chat: 'openai' })
  })

  it('merges defaults and models across a collapsed family', () => {
    const old: OldServiceEndpoint[] = [
      { id: 'chat', baseUrl: 'https://x', protocol: 'openai-chat', defaults: { extraEnv: { A: '1' } }, models: [{ id: 'm1' }] },
      { id: 'images', baseUrl: 'https://x', protocol: 'openai-images', models: [{ id: 'm2' }] },
    ]
    const { endpoints } = regroupPlanEndpoints(old)
    expect(endpoints[0].defaults).toEqual({ extraEnv: { A: '1' } })
    expect(endpoints[0].models).toEqual([{ id: 'm1' }, { id: 'm2' }])
  })

  it('is idempotent — already-migrated protocols[] endpoints regroup to themselves', () => {
    const migrated: OldServiceEndpoint[] = [
      { id: 'openai', baseUrl: 'https://x/v1', protocols: ['openai-chat', 'openai-images'] },
    ]
    const first = regroupPlanEndpoints(migrated)
    expect(first.endpoints).toEqual([
      { id: 'openai', baseUrl: 'https://x/v1', protocols: ['openai-chat', 'openai-images'] },
    ])
    expect(first.remap).toEqual({ openai: 'openai' })
    const second = regroupPlanEndpoints(first.endpoints as OldServiceEndpoint[])
    expect(second.endpoints).toEqual(first.endpoints)
  })
})

describe('remapOverrides', () => {
  it('merges overrides whose ids collapse to the same endpoint', () => {
    const overrides: Record<string, EndpointOverride> = {
      chat: { extraEnv: { A: '1' }, models: [{ id: 'm1', tasks: ['chat'] }] },
      images: { baseUrl: 'https://override', models: [{ id: 'm2', tasks: ['image'] }] },
    }
    const out = remapOverrides(overrides, { chat: 'openai', images: 'openai' })
    expect(Object.keys(out)).toEqual(['openai'])
    expect(out.openai.baseUrl).toBe('https://override')
    expect(out.openai.extraEnv).toEqual({ A: '1' })
    expect(out.openai.models).toEqual([
      { id: 'm1', tasks: ['chat'] },
      { id: 'm2', tasks: ['image'] },
    ])
  })

  it('leaves overrides untouched under an identity remap (idempotent second run)', () => {
    const overrides: Record<string, EndpointOverride> = { openai: { baseUrl: 'https://x' } }
    expect(remapOverrides(overrides, { openai: 'openai' })).toEqual(overrides)
  })
})
