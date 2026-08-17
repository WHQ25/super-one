import { describe, expect, it } from 'vitest'
import {
  classifyModelById,
  extrasForRelayKind,
  extrasFromEndpointTypes,
  extrasFromRelayData,
  familyFromOwner,
  inferRelayKind,
  isNewApiVideoId,
  mergeDiscoveredExtras,
  parseNewApiStatus,
  parseSub2ApiPublicSettings,
  pricingHasEndpointTypes,
  reclassifyVideoFamily,
  relaySiteRoot,
  tasksFromModalities,
  tasksFromTags,
} from './relay-identify'

describe('classifyModelById', () => {
  it('routes Claude ids to anthropic chat', () => {
    expect(classifyModelById('claude-sonnet-4-5')).toEqual({ anthropic: ['chat'] })
    expect(classifyModelById('anthropic/claude-opus-4')).toEqual({ anthropic: ['chat'] })
  })

  it('routes Gemini / Veo / Imagen ids to google', () => {
    expect(classifyModelById('gemini-2.5-pro')).toEqual({ google: ['chat'] })
    expect(classifyModelById('google/gemini-3-flash')).toEqual({ google: ['chat'] })
    expect(classifyModelById('veo-3.1-generate')).toEqual({ google: ['video'] })
    expect(classifyModelById('imagen-4')).toEqual({ google: ['image'] })
  })

  it('routes Gemini image / Nano Banana ids to google image, not chat', () => {
    expect(classifyModelById('gemini-3.1-flash-image')).toEqual({ google: ['image'] })
    expect(classifyModelById('gemini-3.1-flash-image-preview')).toEqual({ google: ['image'] })
    expect(classifyModelById('google/gemini-2.5-flash-image')).toEqual({ google: ['image'] })
    expect(classifyModelById('nano-banana-2')).toEqual({ google: ['image'] })
  })

  it('routes Sora to openai video and Seedance/Kling to newapi video', () => {
    expect(classifyModelById('sora-2')).toEqual({ openai: ['video'] })
    expect(classifyModelById('doubao-seedance-1-5-pro')).toEqual({ newapi: ['video'] })
    expect(classifyModelById('dreamina-seedance-2-0')).toEqual({ newapi: ['video'] })
    expect(classifyModelById('kling-v2-master')).toEqual({ newapi: ['video'] })
  })

  it('routes image / tts / asr ids onto openai', () => {
    expect(classifyModelById('gpt-image-1')).toEqual({ openai: ['image'] })
    expect(classifyModelById('dall-e-3')).toEqual({ openai: ['image'] })
    expect(classifyModelById('flux-pro')).toEqual({ openai: ['image'] })
    expect(classifyModelById('midjourney-v6')).toEqual({ openai: ['image'] })
    expect(classifyModelById('tts-1-hd')).toEqual({ openai: ['tts'] })
    expect(classifyModelById('whisper-1')).toEqual({ openai: ['asr'] })
  })

  it('returns empty for a generic chat id (caller falls back)', () => {
    expect(classifyModelById('gpt-5')).toEqual({})
    expect(classifyModelById('deepseek-chat')).toEqual({})
  })
})

describe('reclassifyVideoFamily', () => {
  it('moves a NewAPI vendor video off openai onto newapi', () => {
    expect(reclassifyVideoFamily({ openai: ['video'] }, 'doubao-seedance-1-5-pro')).toEqual({
      newapi: ['video'],
    })
  })

  it('keeps other openai tasks when stripping video', () => {
    expect(reclassifyVideoFamily({ openai: ['chat', 'video'] }, 'kling-v1')).toEqual({
      openai: ['chat'],
      newapi: ['video'],
    })
  })

  it('leaves Sora on openai', () => {
    expect(reclassifyVideoFamily({ openai: ['video'] }, 'sora-2')).toEqual({ openai: ['video'] })
  })
})

describe('familyFromOwner', () => {
  it('maps New API owned_by / owner_by channel names onto protocol families', () => {
    expect(familyFromOwner('anthropic')).toBe('anthropic')
    expect(familyFromOwner('Claude Channel')).toBe('anthropic')
    expect(familyFromOwner('gemini')).toBe('google')
    expect(familyFromOwner('Google Vertex')).toBe('google')
    expect(familyFromOwner('openai')).toBe('openai')
    expect(familyFromOwner('Azure OpenAI')).toBe('openai')
    expect(familyFromOwner('my-custom-pool')).toBeUndefined()
  })
})

describe('tasksFromTags', () => {
  it('reads New API pricing tags as capability tasks', () => {
    expect(tasksFromTags('vision,图像,工具')).toEqual(['image'])
    expect(tasksFromTags('视频 / seedance')).toEqual(['video'])
    expect(tasksFromTags('tts,whisper')).toEqual(['tts', 'asr'])
    expect(tasksFromTags('chat,tools')).toEqual([])
  })
})

describe('tasksFromModalities', () => {
  it('maps New API catalog modalities onto tasks', () => {
    expect(tasksFromModalities(['text'], ['text'])).toEqual(['chat'])
    expect(tasksFromModalities(['text'], ['image'])).toEqual(['image'])
    expect(tasksFromModalities(['text', 'image'], ['text', 'image'])).toEqual(['image'])
    expect(tasksFromModalities(['text'], ['video'])).toEqual(['video'])
    expect(tasksFromModalities(['text'], ['audio'])).toEqual(['tts'])
    expect(tasksFromModalities(['audio'], ['text'])).toEqual(['asr'])
  })
})

describe('isNewApiVideoId', () => {
  it('matches known New API video vendors including renamed relays', () => {
    expect(isNewApiVideoId('seedance-1-0')).toBe(true)
    expect(isNewApiVideoId('HiFlowt/dreamina-seedance-2')).toBe(true)
    expect(isNewApiVideoId('sora-2')).toBe(false)
  })
})

describe('extrasFromEndpointTypes / extrasFromRelayData', () => {
  it('maps openai-response types onto the Responses extra', () => {
    expect(extrasFromEndpointTypes(['openai', 'openai-response'])).toEqual(['openai-responses'])
    expect(extrasFromEndpointTypes(['openai-response-compact'])).toEqual(['openai-responses'])
    expect(extrasFromEndpointTypes(['openai', 'anthropic'])).toEqual([])
  })

  it('collects extras from a NewAPI-shaped payload', () => {
    expect(
      extrasFromRelayData({
        data: [
          { model_name: 'gpt-5', supported_endpoint_types: ['openai'] },
          { model_name: 'gpt-5.1', supported_endpoint_types: ['openai-response'] },
        ],
      }),
    ).toEqual(['openai-responses'])
  })
})

describe('mergeDiscoveredExtras / extrasForRelayKind', () => {
  it('dedupes extras and turns Responses on for known relays', () => {
    expect(mergeDiscoveredExtras(['openai-responses'], ['openai-responses'])).toEqual(['openai-responses'])
    expect(extrasForRelayKind('new-api')).toEqual(['openai-responses'])
    expect(extrasForRelayKind('one-api')).toEqual(['openai-responses'])
    expect(extrasForRelayKind('sub2api')).toEqual(['openai-responses'])
    expect(extrasForRelayKind('openai-compatible')).toEqual([])
  })
})

describe('relaySiteRoot', () => {
  it('strips /v1 and common API suffixes users paste', () => {
    expect(relaySiteRoot('https://relay.com/v1')).toBe('https://relay.com')
    expect(relaySiteRoot('https://relay.com/v1/')).toBe('https://relay.com')
    expect(relaySiteRoot('https://relay.com/v1/chat/completions')).toBe('https://relay.com')
    expect(relaySiteRoot('https://relay.com/v1/models')).toBe('https://relay.com')
    expect(relaySiteRoot('https://relay.com/anthropic')).toBe('https://relay.com')
    expect(relaySiteRoot('https://relay.com/new-api/v1')).toBe('https://relay.com/new-api')
  })
})

describe('parseNewApiStatus', () => {
  it('identifies New API from panel-only status fields', () => {
    expect(
      parseNewApiStatus({
        success: true,
        data: { version: 'v0.9', system_name: 'My Relay', enable_task: true, quota_display_type: 'USD' },
      }),
    ).toEqual({ kind: 'new-api', name: 'My Relay' })
  })

  it('identifies New API from the system_name even without extra fields', () => {
    expect(parseNewApiStatus({ data: { version: 'v0.8', system_name: 'New API' } })).toEqual({
      kind: 'new-api',
      name: 'New API',
    })
  })

  it('identifies One API from the status envelope without New API fields', () => {
    expect(parseNewApiStatus({ data: { version: 'v0.6', system_name: 'One API', start_time: 1 } })).toEqual({
      kind: 'one-api',
      name: 'One API',
    })
    expect(parseNewApiStatus({ data: { version: 'v0.5', system_name: 'My Panel', start_time: 1 } })).toEqual({
      kind: 'one-api',
      name: 'My Panel',
    })
  })

  it('returns null for a non-status payload', () => {
    expect(parseNewApiStatus({ data: [] })).toBeNull()
    expect(parseNewApiStatus({ success: true })).toBeNull()
  })
})

describe('parseSub2ApiPublicSettings', () => {
  it('identifies Sub2API from site_name + a distinctive field', () => {
    expect(parseSub2ApiPublicSettings({ site_name: 'My Sub', api_base_url: 'https://x/v1' })).toEqual({
      kind: 'sub2api',
      name: 'My Sub',
    })
  })

  it('returns null when the distinctive combo is missing', () => {
    expect(parseSub2ApiPublicSettings({ site_name: 'Just a name' })).toBeNull()
    expect(parseSub2ApiPublicSettings({ api_base_url: 'https://x/v1' })).toBeNull()
  })
})

describe('inferRelayKind', () => {
  it('prefers Sub2API settings, then status, then pricing shape', () => {
    expect(
      inferRelayKind({
        sub2: { kind: 'sub2api', name: 'S' },
        status: { kind: 'new-api', name: 'N' },
        pricingHasEndpointTypes: true,
        pricingOk: true,
        modelsListOk: true,
      }),
    ).toEqual({ kind: 'sub2api', name: 'S' })

    expect(
      inferRelayKind({
        sub2: null,
        status: { kind: 'new-api', name: 'N' },
        pricingHasEndpointTypes: false,
        pricingOk: true,
        modelsListOk: true,
      }),
    ).toEqual({ kind: 'new-api', name: 'N' })

    expect(
      inferRelayKind({
        sub2: null,
        status: null,
        pricingHasEndpointTypes: true,
        pricingOk: true,
        modelsListOk: true,
      }),
    ).toEqual({ kind: 'new-api' })

    expect(
      inferRelayKind({
        sub2: null,
        status: null,
        pricingHasEndpointTypes: false,
        pricingOk: true,
        modelsListOk: true,
      }),
    ).toEqual({ kind: 'one-api' })

    expect(
      inferRelayKind({
        sub2: null,
        status: null,
        pricingHasEndpointTypes: false,
        pricingOk: false,
        modelsListOk: true,
      }),
    ).toEqual({ kind: 'openai-compatible' })
  })
})

describe('pricingHasEndpointTypes', () => {
  it('is true only for a NewAPI array with at least one typed row', () => {
    expect(pricingHasEndpointTypes({ data: [{ model_name: 'gpt-5', supported_endpoint_types: ['openai'] }] })).toBe(true)
    expect(pricingHasEndpointTypes({ data: [{ model_name: 'gpt-5' }] })).toBe(false)
    expect(pricingHasEndpointTypes({ data: { model_ratio: { 'gpt-5': 1 } } })).toBe(false)
  })
})
