import { describe, expect, it } from 'vitest'
import { canonicalizeEndpointSlots, rebaseLegacyEndpoints, legacyEffectiveBase } from './legacy-endpoints'
import { applyCapabilitiesToPlan, planCapabilities } from './capabilities'
import { endpointBaseUrl, familyBaseUrl, PROTOCOL_FAMILY, WIRE_PROTOCOLS } from './protocols'
import type { Plan, ServiceEndpoint, WireProtocol } from './index'

/**
 * The bar for this conversion is that every protocol resolves to the address it resolved to before.
 * "Before" means what the old resolver produced — `familyBaseUrl(family, endpoint.baseUrl)` — not
 * the raw stored string, which is a different value whenever the URL carried no version segment.
 */
function assertLossless(legacy: ServiceEndpoint[], storedRoot?: string) {
  const before = new Map<string, string>()
  for (const e of legacy) {
    for (const p of e.protocols) before.set(`${e.id}:${p}`, familyBaseUrl(PROTOCOL_FAMILY[p], e.baseUrl!))
  }
  const out = rebaseLegacyEndpoints(legacy, storedRoot)!
  const root = storedRoot?.trim() || out.siteRoot
  for (const e of out.endpoints) {
    for (const p of e.protocols) {
      expect(endpointBaseUrl(root, e, p), `${e.id}:${p}`).toBe(before.get(`${e.id}:${p}`))
    }
  }
  return out
}

describe('rebaseLegacyEndpoints', () => {
  it('hoists a shared origin onto the plan and reproduces every old address', () => {
    const out = assertLossless([
      { id: 'anthropic', baseUrl: 'https://relay.example', protocols: ['anthropic-messages'] },
      { id: 'openai', baseUrl: 'https://relay.example/v1', protocols: ['openai-chat', 'openai-images'] },
      { id: 'google', baseUrl: 'https://relay.example/v1beta', protocols: ['google-generative'] },
    ])
    expect(out.siteRoot).toBe('https://relay.example')
    expect(out.endpoints.every((e) => e.baseUrl === undefined)).toBe(true)
  })

  // The regression Casey caught: a bare host resolved through familyBaseUrl, so the old address
  // had a '/v1' the stored string never showed. Converting against the stored value dropped it.
  it('preserves the family path a bare host used to gain at resolve time', () => {
    const legacy: ServiceEndpoint[] = [{ id: 'openai', baseUrl: 'https://relay.example', protocols: ['openai-chat'] }]
    expect(legacyEffectiveBase(legacy[0]!, 'openai-chat')).toBe('https://relay.example/v1')
    const out = assertLossless(legacy)
    expect(endpointBaseUrl(out.siteRoot, out.endpoints[0]!, 'openai-chat')).toBe('https://relay.example/v1')
  })

  it('preserves the family path under a non-versioned gateway path', () => {
    const out = assertLossless([
      { id: 'openai', baseUrl: 'https://relay.example/gateway/openai', protocols: ['openai-chat'] },
    ])
    expect(endpointBaseUrl(out.siteRoot, out.endpoints[0]!, 'openai-chat')).toBe(
      'https://relay.example/gateway/openai/v1',
    )
  })

  // The other regression: routes were built against a derived root but resolved against the stored
  // one, so a key whose stored root disagreed with its endpoints silently moved hosts.
  it('builds and verifies against the stored root, not a derived one', () => {
    const out = assertLossless(
      [{ id: 'openai', baseUrl: 'https://a.example/v1', protocols: ['openai-chat'] }],
      'https://b.example',
    )
    // b is not a prefix of a's address, so the endpoint stays pinned to its own host.
    expect(out.endpoints[0]!.baseUrl).toBe('https://a.example/v1')
    expect(endpointBaseUrl('https://b.example', out.endpoints[0]!, 'openai-chat')).toBe('https://a.example/v1')
  })

  it('honours a stored root that does agree with its endpoints', () => {
    const out = assertLossless(
      [{ id: 'openai', baseUrl: 'https://relay.example/v1', protocols: ['openai-chat'] }],
      'https://relay.example',
    )
    expect(out.siteRoot).toBe('https://relay.example')
    expect(out.endpoints[0]!.baseUrl).toBeUndefined()
  })

  it('keeps the host override when endpoints do not share one origin', () => {
    const out = assertLossless([
      { id: 'anthropic', baseUrl: 'https://a.example', protocols: ['anthropic-messages'] },
      { id: 'openai', baseUrl: 'https://b.example/v1', protocols: ['openai-chat'] },
    ])
    expect(out.endpoints.map((e) => e.baseUrl)).toEqual(['https://a.example', 'https://b.example/v1'])
  })

  it('is a no-op once endpoints carry routes, so re-running cannot double-prefix', () => {
    const migrated: ServiceEndpoint[] = [
      { id: 'openai', protocols: ['openai-chat'], routes: { 'openai-chat': '/v1/chat/completions' } },
    ]
    expect(rebaseLegacyEndpoints(migrated, 'https://relay.example')).toBeUndefined()

    const once = rebaseLegacyEndpoints(
      [{ id: 'openai', baseUrl: 'https://relay.example/v1', protocols: ['openai-chat'] }],
      undefined,
    )!
    expect(rebaseLegacyEndpoints(once.endpoints, once.siteRoot)).toBeUndefined()
  })

  it('is lossless for every wire protocol, on a bare host and a versioned one', () => {
    for (const protocol of WIRE_PROTOCOLS) {
      for (const stored of ['https://relay.example', 'https://relay.example/v1']) {
        assertLossless([{ id: 'e', baseUrl: stored, protocols: [protocol as WireProtocol] }])
      }
    }
  })
})

describe('canonicalizeEndpointSlots', () => {
  // Casey's counterexample: a HEAD-era custom OpenAI platform with video enabled stored one
  // endpoint holding chat + images + video. It resolves fine, but rebuilds bare.
  const combined: ServiceEndpoint = {
    id: 'openai',
    protocols: ['openai-chat', 'openai-images', 'openai-video'],
    routes: { 'openai-video': '/proxy/v1/videos' },
    models: [{ id: 'gpt', tasks: ['chat'] }, { id: 'sora', tasks: ['video'] }, { id: 'shared' }],
    defaults: { extraEnv: { X: '1' } },
  }

  it('splits a combined endpoint and sends each model to the half that serves its task', () => {
    const out = canonicalizeEndpointSlots([combined])!
    expect(out.endpoints.map((e) => e.id)).toEqual(['openai', 'openai-video'])

    const chat = out.endpoints.find((e) => e.id === 'openai')!
    const video = out.endpoints.find((e) => e.id === 'openai-video')!
    expect(chat.protocols).toEqual(['openai-chat', 'openai-images'])
    expect(video.protocols).toEqual(['openai-video'])
    expect(chat.models!.map((m) => m.id)).toEqual(['gpt', 'shared'])
    expect(video.models!.map((m) => m.id)).toEqual(['sora', 'shared'])
    // The video route follows the video half and stops cluttering the chat one.
    expect(video.routes).toEqual({ 'openai-video': '/proxy/v1/videos' })
    expect(chat.routes).toBeUndefined()
    // Shared config is copied, not moved.
    expect(chat.defaults).toEqual({ extraEnv: { X: '1' } })
    expect(video.defaults).toEqual({ extraEnv: { X: '1' } })
  })

  it('reports the split as a task→id map so a binding can follow its own task', () => {
    const out = canonicalizeEndpointSlots([combined])!
    expect(out.remap.openai!.chat).toBe('openai')
    expect(out.remap.openai!.image).toBe('openai')
    expect(out.remap.openai!.video).toBe('openai-video')
  })

  it('keeps the old id on the half that matches it, so existing overrides stay attached', () => {
    const out = canonicalizeEndpointSlots([combined])!
    expect(out.endpoints.some((e) => e.id === 'openai')).toBe(true)
  })

  it('does not collide with a sibling endpoint that already owns the slot name', () => {
    const out = canonicalizeEndpointSlots([
      combined,
      { id: 'openai-video', protocols: ['openai-video'], models: [{ id: 'other' }] },
    ])!
    const ids = out.endpoints.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(out.endpoints.find((e) => e.id === 'openai-video')!.models).toEqual([{ id: 'other' }])
  })

  it('is a no-op on already-canonical endpoints, so re-running writes nothing', () => {
    expect(
      canonicalizeEndpointSlots([
        { id: 'openai', protocols: ['openai-chat', 'openai-images'] },
        { id: 'openai-video', protocols: ['openai-video'] },
      ]),
    ).toBeUndefined()
    const once = canonicalizeEndpointSlots([combined])!
    expect(canonicalizeEndpointSlots(once.endpoints)).toBeUndefined()
  })

  it('survives a rebuild — the thing the split exists to fix', () => {
    const out = canonicalizeEndpointSlots([combined])!
    const plan: Plan = { id: 'api', name: 'API', auth: 'api-key', baseUrl: 'https://relay.example', endpoints: out.endpoints }
    const rebuilt = applyCapabilitiesToPlan(plan, planCapabilities(plan))
    const video = rebuilt.find((e) => e.id === 'openai-video')!
    expect(video.models!.map((m) => m.id)).toEqual(['sora', 'shared'])
    expect(video.routes).toEqual({ 'openai-video': '/proxy/v1/videos' })
  })

  it('loses the video half on rebuild without the split — the regression itself', () => {
    const plan: Plan = { id: 'api', name: 'API', auth: 'api-key', baseUrl: 'https://relay.example', endpoints: [combined] }
    const rebuilt = applyCapabilitiesToPlan(plan, planCapabilities(plan))
    const video = rebuilt.find((e) => e.id === 'openai-video')!
    expect(video.models).toBeUndefined()
    expect(video.routes).toBeUndefined()
  })
})

describe('canonicalizeEndpointSlots keeps models no half claims', () => {
  // `EndpointModel.tasks` has no non-empty constraint and MCP's coerceModels accepts `[]`, so these
  // are storable. They were never selectable, but a migration must not delete stored config.
  const withOrphans: ServiceEndpoint = {
    id: 'google',
    protocols: ['google-generative', 'google-video'],
    models: [
      { id: 'both', tasks: ['chat', 'video'] },
      { id: 'implicit' },
      { id: 'empty', tasks: [] },
      { id: 'unserved', tasks: ['asr'] },
    ],
  }

  it('lands them on the half that keeps the old id rather than dropping them', () => {
    const out = canonicalizeEndpointSlots([withOrphans])!
    const google = out.endpoints.find((e) => e.id === 'google')!
    const video = out.endpoints.find((e) => e.id === 'google-video')!
    expect(google.models!.map((m) => m.id)).toEqual(['both', 'implicit', 'empty', 'unserved'])
    expect(video.models!.map((m) => m.id)).toEqual(['both', 'implicit'])
  })

  it.each(['google', 'main'])('loses no model anywhere in the split (id=%s)', (id) => {
    const out = canonicalizeEndpointSlots([{ ...withOrphans, id }])!
    const kept = new Set(out.endpoints.flatMap((e) => e.models ?? []).map((m) => m.id))
    expect(kept).toEqual(new Set(withOrphans.models!.map((m) => m.id)))
  })

  it('picks an orphan owner by slot, not by id, when the old id names no slot', () => {
    const out = canonicalizeEndpointSlots([{ ...withOrphans, id: 'main' }])!
    expect(out.endpoints.map((e) => e.id)).toEqual(['google', 'google-video'])
    expect(out.endpoints.find((e) => e.id === 'google')!.models!.map((m) => m.id)).toEqual([
      'both',
      'implicit',
      'empty',
      'unserved',
    ])
  })
})
