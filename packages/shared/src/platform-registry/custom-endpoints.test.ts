import { describe, expect, it } from 'vitest'
import {
  customEndpointsFor,
  endpointBaseUrl,
  endpointIdFor,
  endpointRoute,
  familyBaseUrl,
  isInferableProtocol,
  PROTOCOL_FAMILY,
  PROTOCOL_ROUTE,
  protocolForRoute,
  protocolRoute,
  protocolsForSlot,
  slotTasks,
  WIRE_PROTOCOLS,
} from './protocols'

describe('customEndpointsFor', () => {
  it('maps anthropic chat to a single messages endpoint keyed by family', () => {
    expect(customEndpointsFor(['anthropic-messages'])).toEqual([
      { id: 'anthropic', protocols: ['anthropic-messages'] },
    ])
  })

  it("collapses a family's non-video protocols into one endpoint, in priority order", () => {
    expect(customEndpointsFor(['openai-images', 'openai-chat', 'openai-responses'])).toEqual([
      { id: 'openai', protocols: ['openai-responses', 'openai-chat', 'openai-images'] },
    ])
  })

  it('emits one endpoint per family when several are picked', () => {
    expect(customEndpointsFor(['anthropic-messages', 'openai-chat'])).toEqual([
      { id: 'anthropic', protocols: ['anthropic-messages'] },
      { id: 'openai', protocols: ['openai-chat'] },
    ])
  })

  it('gives every video wire an endpoint of its own so per-model routing can tell them apart', () => {
    expect(customEndpointsFor(['openai-video', 'ark-video', 'newapi-video'])).toEqual([
      { id: 'openai-video', protocols: ['openai-video'] },
      { id: 'ark-video', protocols: ['ark-video'] },
      { id: 'newapi-video', protocols: ['newapi-video'] },
    ])
  })

  it('splits veo off the generateContent endpoint so a curated Veo list never replaces the catalog one', () => {
    expect(customEndpointsFor(['google-generative', 'google-video'])).toEqual([
      { id: 'google', protocols: ['google-generative'] },
      { id: 'google-video', protocols: ['google-video'] },
    ])
  })

  it("keeps Ark's image and video wires in their own family rather than under openai", () => {
    expect(customEndpointsFor(['ark-images', 'ark-video', 'openai-chat'])).toEqual([
      { id: 'openai', protocols: ['openai-chat'] },
      { id: 'volcengine', protocols: ['ark-images'] },
      { id: 'ark-video', protocols: ['ark-video'] },
    ])
  })

  it('ignores an unpicked protocol and returns [] when nothing is picked', () => {
    expect(customEndpointsFor([])).toEqual([])
  })

  it('stores no URL at all — the site root belongs to the plan', () => {
    // The whole point of the split: an endpoint says which wires it speaks, never where it lives.
    for (const endpoint of customEndpointsFor(['anthropic-messages', 'openai-chat', 'ark-video'])) {
      expect(endpoint.baseUrl).toBeUndefined()
      expect(endpoint.routes).toBeUndefined()
    }
  })
})

describe('endpointBaseUrl', () => {
  it('hands each family the base its driver expects, off one shared root', () => {
    const [anthropic, openai] = customEndpointsFor(['anthropic-messages', 'openai-chat'])
    expect(endpointBaseUrl('https://x', anthropic, 'anthropic-messages')).toBe('https://x')
    expect(endpointBaseUrl('https://x', openai, 'openai-chat')).toBe('https://x/v1')
  })

  it('round-trips the default route back to the family base, for every wire', () => {
    // The invariant that keeps route and base two views of one fact: strip what the driver appends
    // and you are back at the base the resolver hands it.
    for (const protocol of WIRE_PROTOCOLS) {
      const endpoint = { id: endpointIdFor(protocol), protocols: [protocol] }
      expect(endpointBaseUrl('https://x', endpoint, protocol)).toBe(familyBaseUrl(PROTOCOL_FAMILY[protocol], 'https://x'))
    }
  })

  it('honours a route override by handing the SDK everything before its own segment', () => {
    // GLM's real shape: Claude on /api/anthropic, OpenAI on /api/coding/paas/v4, one host.
    const anthropic = { id: 'anthropic', protocols: ['anthropic-messages' as const], routes: { 'anthropic-messages': '/api/anthropic/v1/messages' } }
    const openai = { id: 'openai', protocols: ['openai-chat' as const], routes: { 'openai-chat': '/api/coding/paas/v4/chat/completions' } }
    expect(endpointBaseUrl('https://open.bigmodel.cn', anthropic, 'anthropic-messages')).toBe('https://open.bigmodel.cn/api/anthropic')
    expect(endpointBaseUrl('https://open.bigmodel.cn', openai, 'openai-chat')).toBe('https://open.bigmodel.cn/api/coding/paas/v4')
  })

  it('lets a per-endpoint host win over the plan root, for a format served elsewhere', () => {
    const endpoint = { id: 'ark-video', protocols: ['ark-video' as const], baseUrl: 'https://ark.cn-beijing.volces.com' }
    expect(endpointBaseUrl('https://relay.example.com', endpoint, 'ark-video')).toBe('https://ark.cn-beijing.volces.com/api/v3')
  })

  it('falls back to the family default when a route cannot be honoured', () => {
    // Nothing coherent to hand an SDK that appends /v1/messages itself, so do not invent a URL.
    const endpoint = { id: 'anthropic', protocols: ['anthropic-messages' as const], routes: { 'anthropic-messages': '/weird/path' } }
    expect(endpointBaseUrl('https://x', endpoint, 'anthropic-messages')).toBe('https://x')
  })

  it('keeps an empty root empty rather than turning it into a relative path', () => {
    const endpoint = { id: 'openai', protocols: ['openai-chat' as const] }
    expect(endpointBaseUrl('', endpoint, 'openai-chat')).toBe('')
  })
})

describe('endpointIdFor', () => {
  it('keys non-video protocols by family and video wires by themselves', () => {
    expect(endpointIdFor('openai-chat')).toBe('openai')
    expect(endpointIdFor('ark-images')).toBe('volcengine')
    expect(endpointIdFor('ark-video')).toBe('ark-video')
    expect(endpointIdFor('google-video')).toBe('google-video')
  })
})

describe('protocolsForSlot', () => {
  it('expands a family slot to the inferable protocols serving the given tasks', () => {
    expect(protocolsForSlot('openai', ['chat', 'image'])).toEqual(['openai-chat', 'openai-images'])
  })

  it('never infers an opt-in wire from a bare capability', () => {
    expect(isInferableProtocol('openai-responses')).toBe(false)
    expect(protocolsForSlot('openai', ['chat'])).toEqual(['openai-chat'])
  })

  it('never puts video on a family slot — video wires own their endpoints', () => {
    expect(protocolsForSlot('openai', ['video'])).toEqual([])
    expect(protocolsForSlot('openai-video', ['video'])).toEqual(['openai-video'])
  })
})

describe('slotTasks', () => {
  it('reports a video wire as video-only and a family as its non-video union', () => {
    expect(slotTasks('ark-video')).toEqual(['video'])
    expect(slotTasks('openai')).toEqual(['chat', 'image', 'tts', 'asr'])
    expect(slotTasks('volcengine')).toEqual(['image'])
  })
})

describe('protocolForRoute', () => {
  it('round-trips every wire, so a relay that publishes a path is identified exactly', () => {
    // Also asserts route uniqueness: a collision would make one protocol unreachable here.
    for (const protocol of WIRE_PROTOCOLS) {
      expect(protocolForRoute(protocolRoute(protocol))).toBe(protocol)
    }
  })

  it('separates the two video wires New API gives the same endpoint-type name', () => {
    expect(protocolForRoute('/v1/videos')).toBe('openai-video')
    expect(protocolForRoute('/v1/video/generations')).toBe('newapi-video')
  })

  it('accepts the forms relays publish: absolute URL, trailing slash, mixed case, query', () => {
    expect(protocolForRoute('https://relay.example.com/v1/chat/completions')).toBe('openai-chat')
    expect(protocolForRoute('/v1/messages/')).toBe('anthropic-messages')
    expect(protocolForRoute('/V1/Images/Generations')).toBe('openai-images')
    expect(protocolForRoute('/v1/responses?stream=true')).toBe('openai-responses')
  })

  it('matches Gemini regardless of what the path parameter is named', () => {
    expect(protocolForRoute('/v1beta/models/{model}:generateContent')).toBe('google-generative')
    expect(protocolForRoute('/v1beta/models/{model_name}:generateContent')).toBe('google-generative')
  })

  it('returns undefined for wires we do not implement, so callers fall back to the name', () => {
    expect(protocolForRoute('/v1/rerank')).toBeUndefined()
    expect(protocolForRoute('/v1/embeddings')).toBeUndefined()
    expect(protocolForRoute('')).toBeUndefined()
  })
})

describe('protocolRoute', () => {
  it('measures every wire from the site root, not from its endpoint base', () => {
    // What a user compares against their relay's docs. Anthropic is the one that catches a
    // relative-path bug: its base URL is a bare root, so the version segment rides the route.
    expect(protocolRoute('anthropic-messages')).toBe('/v1/messages')
    expect(protocolRoute('openai-chat')).toBe('/v1/chat/completions')
    expect(protocolRoute('openai-video')).toBe('/v1/videos')
    expect(protocolRoute('ark-images')).toBe('/api/v3/images/generations')
    expect(protocolRoute('ark-video')).toBe('/api/v3/contents/generations/tasks')
    expect(protocolRoute('newapi-video')).toBe('/v1/video/generations')
    expect(protocolRoute('google-video')).toBe('/v1beta/models/{model}:predictLongRunning')
  })

  it('agrees with the base URL the resolver builds, for every wire', () => {
    // The invariant that keeps the displayed path honest: whatever the driver appends to the base URL
    // the resolver hands it must land on exactly the path shown in the picker.
    for (const protocol of WIRE_PROTOCOLS) {
      const base = familyBaseUrl(PROTOCOL_FAMILY[protocol], 'https://x')
      expect(`${base}${PROTOCOL_ROUTE[protocol]}`).toBe(`https://x${protocolRoute(protocol)}`)
    }
  })
})

describe('hand-typed routes are normalized before use', () => {
  // These are user input from the Route field, not values the app generated.
  it('adds a leading slash so the route never concatenates onto the host', () => {
    const ep = { routes: { 'anthropic-messages': 'api/v1/messages' } }
    expect(endpointRoute(ep, 'anthropic-messages')).toBe('/api/v1/messages')
    // PROTOCOL_ROUTE['anthropic-messages'] is '/v1/messages' and the SDK re-appends it,
    // so the base the driver gets is the route minus that suffix.
    expect(endpointBaseUrl('https://relay.example', ep, 'anthropic-messages')).toBe('https://relay.example/api')
  })

  it('drops a trailing slash so the suffix match still finds the protocol path', () => {
    const ep = { routes: { 'anthropic-messages': '/api/v1/messages/' } }
    expect(endpointRoute(ep, 'anthropic-messages')).toBe('/api/v1/messages')
    // Without normalization this fell back to the family default and lost the '/api'.
    expect(endpointBaseUrl('https://relay.example', ep, 'anthropic-messages')).toBe('https://relay.example/api')
  })

  it('treats whitespace and a bare slash as no override', () => {
    expect(endpointRoute({ routes: { 'openai-chat': '   ' } }, 'openai-chat')).toBe(protocolRoute('openai-chat'))
    expect(endpointRoute({ routes: { 'openai-chat': '/' } }, 'openai-chat')).toBe('/')
  })
})
