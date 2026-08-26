import { describe, expect, it } from 'vitest'
import type { EndpointOverride } from '@superone/shared/platform-registry'
import { needsProtocolRegroup, regroupPlanEndpoints, remapOverrides, type OldServiceEndpoint } from './database-migrations'

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

/**
 * This migration runs on every startup, not once — so anything it fails to carry through is
 * destroyed the next time the app opens, long after the migration that wrote it.
 */
describe('needsProtocolRegroup', () => {
  it('is true only for the pre-protocols[] shape it exists to fix', () => {
    expect(needsProtocolRegroup([{ id: 'chat', baseUrl: 'https://x/v1', protocol: 'openai-chat' }])).toBe(true)
    expect(needsProtocolRegroup([{ id: 'openai', protocols: ['openai-chat'] }])).toBe(false)
    // Mixed data still needs the pass; the current-shape entries regroup to themselves.
    expect(
      needsProtocolRegroup([
        { id: 'openai', protocols: ['openai-chat'] },
        { id: 'msg', baseUrl: 'https://x', protocol: 'anthropic-messages' },
      ]),
    ).toBe(true)
  })

  // Splitting a combined endpoint would make one old id map to two new ones, which the single-valued
  // remap cannot express — the overrides and bindings pointing at it would follow only one half.
  it('skips a combined family endpoint that also serves a video wire', () => {
    const current: OldServiceEndpoint[] = [
      { id: 'openai', protocols: ['openai-chat', 'openai-images', 'openai-video'] },
    ]
    expect(needsProtocolRegroup(current)).toBe(false)
  })
})

describe('regroupPlanEndpoints carries the current-shape fields', () => {
  it('keeps routes and disabled, so a restart cannot silently reset them', () => {
    const mixed: OldServiceEndpoint[] = [
      {
        id: 'anthropic',
        protocols: ['anthropic-messages'],
        routes: { 'anthropic-messages': '/api/anthropic/v1/messages' },
      },
      { id: 'chat', baseUrl: 'https://x/v1', protocol: 'openai-chat', disabled: true },
    ]
    const { endpoints } = regroupPlanEndpoints(mixed)
    expect(endpoints.find((e) => e.id === 'anthropic')!.routes).toEqual({
      'anthropic-messages': '/api/anthropic/v1/messages',
    })
    expect(endpoints.find((e) => e.id === 'openai')!.disabled).toBe(true)
  })

  it('remaps every old id to exactly one new id', () => {
    const legacy: OldServiceEndpoint[] = [
      { id: 'chat', baseUrl: 'https://x/v1', protocol: 'openai-chat' },
      { id: 'video', baseUrl: 'https://x/v1', protocol: 'openai-video' },
    ]
    const { endpoints, remap } = regroupPlanEndpoints(legacy)
    expect(endpoints.map((e) => e.id)).toEqual(['openai'])
    expect(remap).toEqual({ chat: 'openai', video: 'openai' })
    // No old id is dropped, and none points at an endpoint that was not produced.
    const ids = new Set(endpoints.map((e) => e.id))
    for (const target of Object.values(remap)) expect(ids.has(target)).toBe(true)
  })

  it('keeps the fixed family order rather than the order the array happened to have', () => {
    const legacy: OldServiceEndpoint[] = [
      { id: 'chat', baseUrl: 'https://x/v1', protocol: 'openai-chat' },
      { id: 'msg', baseUrl: 'https://x', protocol: 'anthropic-messages' },
    ]
    // Downstream code takes endpoints[0] when it cannot match by protocol, so this order is routing.
    expect(regroupPlanEndpoints(legacy).endpoints.map((e) => e.id)).toEqual(['anthropic', 'openai'])
  })
})
