import { describe, expect, it } from 'vitest'
import type { CatalogModel, ModelCatalog } from '../model-catalog-types'
import {
  assembleRegistry,
  BUILTIN_PLATFORMS,
  endpointTasks,
  everyHarnessReachable,
  findEndpoint,
  findPlan,
  findPlatform,
  PROTOCOL_TASKS,
  resolveEndpointModels,
  selectEndpoint,
  synthesizePlatformFromCatalog,
  validatePlatform,
  validateRegistry,
} from './index'
import type { WireProtocol } from './protocols'
import type { Plan, Platform } from './types'

describe('builtin registry', () => {
  it('passes structural validation (unique ids, known protocols)', () => {
    expect(validateRegistry(BUILTIN_PLATFORMS)).toEqual([])
  })

  it('every endpoint declares at least one known protocol and derives a non-empty task set', () => {
    for (const platform of BUILTIN_PLATFORMS) {
      for (const plan of platform.plans) {
        for (const endpoint of plan.endpoints) {
          expect(endpoint.protocols.length).toBeGreaterThan(0)
          for (const p of endpoint.protocols) expect(PROTOCOL_TASKS[p]).toBeDefined()
          expect(endpointTasks(endpoint).length).toBeGreaterThan(0)
        }
      }
    }
  })

  it('is reachable by both claude and codex chat consumers', () => {
    expect(everyHarnessReachable(BUILTIN_PLATFORMS)).toBe(true)
  })

  it('keeps CN and Global as separate platforms with distinct brands', () => {
    const cn = findPlatform(BUILTIN_PLATFORMS, 'zhipu-cn')
    const global = findPlatform(BUILTIN_PLATFORMS, 'zhipu-global')
    expect(cn?.brand).toBe('zhipu')
    expect(global?.brand).toBe('zai')
    expect(cn?.id).not.toBe(global?.id)
  })

  it('registers dual anthropic+openai endpoints for major Chinese coding platforms', () => {
    const dual: Array<{ id: string; planId: string; openaiBase: string }> = [
      { id: 'zhipu-cn', planId: 'coding', openaiBase: 'https://open.bigmodel.cn/api/coding/paas/v4' },
      { id: 'zhipu-cn', planId: 'api', openaiBase: 'https://open.bigmodel.cn/api/paas/v4' },
      { id: 'zhipu-global', planId: 'coding', openaiBase: 'https://api.z.ai/api/coding/paas/v4' },
      { id: 'minimax', planId: 'cn', openaiBase: 'https://api.minimaxi.com/v1' },
      { id: 'minimax', planId: 'global', openaiBase: 'https://api.minimax.io/v1' },
      { id: 'volcengine', planId: 'coding', openaiBase: 'https://ark.cn-beijing.volces.com/api/coding/v3' },
      { id: 'volcengine', planId: 'agent', openaiBase: 'https://ark.cn-beijing.volces.com/api/plan/v3' },
      { id: 'volcengine', planId: 'api', openaiBase: 'https://ark.cn-beijing.volces.com/api/v3' },
      { id: 'bailian', planId: 'coding', openaiBase: 'https://coding.dashscope.aliyuncs.com/v1' },
      { id: 'bailian', planId: 'api', openaiBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
    ]
    for (const row of dual) {
      const plan = findPlan(findPlatform(BUILTIN_PLATFORMS, row.id), row.planId)
      expect(plan?.endpoints.some((e) => e.protocols.includes('anthropic-messages')), `${row.id}/${row.planId} anthropic`).toBe(true)
      const openai = plan?.endpoints.find((e) => e.protocols.includes('openai-chat'))
      expect(openai?.baseUrl, `${row.id}/${row.planId} openai base`).toBe(row.openaiBase)
    }
  })

  it('splits Kimi Code membership tiers and Moonshot API regions into plans', () => {
    const kimi = findPlatform(BUILTIN_PLATFORMS, 'kimi')
    const moonshot = findPlatform(BUILTIN_PLATFORMS, 'moonshot')
    expect(kimi?.brand).toBe('kimi')
    expect(moonshot?.brand).toBe('moonshot')
    expect(kimi?.plans.map((p) => p.id)).toEqual(['andante', 'moderato', 'allegretto'])
    expect(moonshot?.plans.map((p) => p.id).sort()).toEqual(['cn', 'global'])
    for (const plan of [...(kimi?.plans ?? []), ...(moonshot?.plans ?? [])]) {
      expect(plan.endpoints.some((e) => e.protocols.includes('anthropic-messages'))).toBe(true)
      expect(plan.endpoints.some((e) => e.protocols.includes('openai-chat'))).toBe(true)
    }

    const andante = findPlan(kimi, 'andante')?.endpoints.find((e) => e.id === 'anthropic')
    expect(andante?.defaults?.modelMapping?.default?.id).toBe('kimi-for-coding')
    expect(andante?.models?.map((m) => m.id)).toEqual(['kimi-for-coding'])
    expect(andante?.defaults?.extraEnv?.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBe('262144')
    expect(andante?.defaults?.extraEnv?.CLAUDE_CODE_EFFORT_LEVEL).toBeUndefined()

    const moderato = findPlan(kimi, 'moderato')?.endpoints.find((e) => e.id === 'anthropic')
    expect(moderato?.defaults?.modelMapping?.default?.id).toBe('k3')
    expect(moderato?.models?.map((m) => m.id)).toEqual(['k3', 'kimi-for-coding'])
    expect(moderato?.defaults?.extraEnv?.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBe('262144')
    expect(moderato?.defaults?.extraEnv?.CLAUDE_CODE_EFFORT_LEVEL).toBe('max')

    const allegretto = findPlan(kimi, 'allegretto')?.endpoints.find((e) => e.id === 'anthropic')
    expect(allegretto?.defaults?.modelMapping?.default?.id).toBe('k3[1m]')
    expect(allegretto?.models?.map((m) => m.id)).toEqual([
      'k3',
      'kimi-for-coding',
      'kimi-for-coding-highspeed',
    ])
    expect(allegretto?.defaults?.extraEnv?.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBe('1048576')
    expect(allegretto?.defaults?.extraEnv?.CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBe('1048576')
    expect(allegretto?.defaults?.extraEnv?.CLAUDE_CODE_EFFORT_LEVEL).toBe('max')

    expect(findPlan(moonshot, 'cn')?.endpoints.find((e) => e.id === 'anthropic')?.baseUrl).toBe(
      'https://api.moonshot.cn/anthropic',
    )
    expect(findPlan(moonshot, 'global')?.endpoints.find((e) => e.id === 'anthropic')?.baseUrl).toBe(
      'https://api.moonshot.ai/anthropic',
    )
    expect(
      findPlan(moonshot, 'cn')?.endpoints.find((e) => e.id === 'anthropic')?.defaults?.modelMapping?.default?.id,
    ).toBe('kimi-k3')
  })

  it('official oauth platforms carry an oauth plan and no api key url', () => {
    const claude = findPlatform(BUILTIN_PLATFORMS, 'claude-official')
    expect(claude?.plans[0].auth).toBe('oauth')
    expect(claude?.plans[0].apiKeyUrl).toBeUndefined()
  })
})

describe('selectEndpoint', () => {
  it('picks the anthropic endpoint + protocol for chat:claude on a cross-family plan', () => {
    const plan = findPlatform(BUILTIN_PLATFORMS, 'openrouter')!.plans[0]
    const claude = selectEndpoint(plan, 'chat:claude')
    expect(claude?.endpoint.id).toBe('anthropic')
    expect(claude?.protocol).toBe('anthropic-messages')
  })

  it('resolves chat:codex against a chat-completions-only endpoint (bridged through proxy)', () => {
    const plan = findPlatform(BUILTIN_PLATFORMS, 'openrouter')!.plans[0]
    const resolved = selectEndpoint(plan, 'chat:codex')
    expect(resolved?.protocol).toBe('openai-chat')
  })

  it('resolves chat:codex to the openai-responses protocol on a responses endpoint', () => {
    const plan = findPlatform(BUILTIN_PLATFORMS, 'openai-official')!.plans[0]
    expect(selectEndpoint(plan, 'chat:codex')?.protocol).toBe('openai-responses')
  })

  it('returns undefined when the plan cannot serve the consumer', () => {
    const anthropicPlatform = findPlatform(BUILTIN_PLATFORMS, 'anthropic')!
    expect(selectEndpoint(anthropicPlatform.plans[0], 'chat:codex')).toBeUndefined()
  })

  it('honors an explicit valid endpointId', () => {
    const plan = findPlatform(BUILTIN_PLATFORMS, 'openrouter')!.plans[0]
    expect(selectEndpoint(plan, 'chat:claude', 'anthropic')?.endpoint.id).toBe('anthropic')
  })

  it('prefers anthropic-messages for chat:claude even when an openai-chat endpoint is listed first', () => {
    const plan: Plan = {
      id: 'api',
      name: 'API',
      auth: 'api-key',
      endpoints: [
        { id: 'openai', baseUrl: 'https://x/v1', protocols: ['openai-chat'] },
        { id: 'anthropic', baseUrl: 'https://x/anthropic', protocols: ['anthropic-messages'] },
      ],
    }
    const claude = selectEndpoint(plan, 'chat:claude')
    expect(claude?.endpoint.id).toBe('anthropic')
    expect(claude?.protocol).toBe('anthropic-messages')
  })

  it('does not resolve chat:claude against an openai-chat-only endpoint', () => {
    const plan: Plan = {
      id: 'api',
      name: 'API',
      auth: 'api-key',
      endpoints: [{ id: 'openai', baseUrl: 'https://x/v1/chat/completions', protocols: ['openai-chat'] }],
    }
    expect(selectEndpoint(plan, 'chat:claude')).toBeUndefined()
  })

  it('derives media capability from the credential enabled models', () => {
    const plan = findPlatform(BUILTIN_PLATFORMS, 'gemini')!.plans[0]
    // No credential context → protocol capability only (generateContent serves image).
    expect(selectEndpoint(plan, 'media:image')?.endpoint.id).toBe('generative')
    // A credential with nothing enabled does not serve image.
    expect(selectEndpoint(plan, 'media:image', undefined, { overrides: {} })).toBeUndefined()
    // Enabling an image-tagged model makes the endpoint serve image.
    expect(
      selectEndpoint(plan, 'media:image', undefined, {
        overrides: { generative: { models: [{ id: 'nano', name: 'Nano', tasks: ['image'] }] } },
      })?.endpoint.id,
    ).toBe('generative')
    // A chat-only enabled model does not make it an image provider.
    expect(
      selectEndpoint(plan, 'media:image', undefined, {
        overrides: { generative: { models: [{ id: 'flash', name: 'Flash', tasks: ['chat'] }] } },
      }),
    ).toBeUndefined()
  })

  it('routes volcengine image to the ark wire while its chat endpoint keeps serving claude', () => {
    const plan = findPlatform(BUILTIN_PLATFORMS, 'volcengine')!.plans.find((p) => p.id === 'api')!
    expect(selectEndpoint(plan, 'media:image')?.protocol).toBe('ark-images')
    // Ark's image wire is not openai-compatible — resolving it as such is what made image edits 404.
    expect(selectEndpoint(plan, 'media:image')?.endpoint.id).toBe('ark-images')
    // The added image endpoint must not shadow the chat endpoint that shares the plan.
    expect(selectEndpoint(plan, 'chat:claude')?.protocol).toBe('anthropic-messages')
    // Media still gates on an enabled image-tagged model once a credential is in play.
    expect(selectEndpoint(plan, 'media:image', undefined, { overrides: {} })).toBeUndefined()
    expect(
      selectEndpoint(plan, 'media:image', undefined, {
        overrides: { 'ark-images': { models: [{ id: 'doubao-seedream-5-0-260128', name: 'Seedream', tasks: ['image'] }] } },
      })?.endpoint.id,
    ).toBe('ark-images')
  })

  it('routes video to a dedicated endpoint per vendor without shadowing image or chat', () => {
    const ark = findPlatform(BUILTIN_PLATFORMS, 'volcengine')!.plans.find((p) => p.id === 'api')!
    expect(selectEndpoint(ark, 'media:video')?.endpoint.id).toBe('ark-video')
    expect(selectEndpoint(ark, 'media:video')?.protocol).toBe('ark-video')
    // The video endpoint must not steal the image or chat consumers that share the plan.
    expect(selectEndpoint(ark, 'media:image')?.endpoint.id).toBe('ark-images')
    expect(selectEndpoint(ark, 'chat:claude')?.protocol).toBe('anthropic-messages')

    const openai = findPlatform(BUILTIN_PLATFORMS, 'openai')!.plans[0]
    expect(selectEndpoint(openai, 'media:video')?.endpoint.id).toBe('sora')
    expect(selectEndpoint(openai, 'media:image')?.endpoint.id).toBe('openai')

    const gemini = findPlatform(BUILTIN_PLATFORMS, 'gemini')!.plans[0]
    expect(selectEndpoint(gemini, 'media:video')?.endpoint.id).toBe('veo')
    expect(selectEndpoint(gemini, 'media:image')?.endpoint.id).toBe('generative')
  })

  it('gates video on an enabled video-tagged model like the other media consumers', () => {
    const plan = findPlatform(BUILTIN_PLATFORMS, 'volcengine')!.plans.find((p) => p.id === 'api')!
    expect(selectEndpoint(plan, 'media:video', undefined, { overrides: {} })).toBeUndefined()
    expect(
      selectEndpoint(plan, 'media:video', undefined, {
        overrides: { 'ark-video': { models: [{ id: 'doubao-seedance-2-0-260128', name: 'Seedance', tasks: ['video'] }] } },
      })?.endpoint.id,
    ).toBe('ark-video')
    // An image-tagged model on the video endpoint does not make it a video provider.
    expect(
      selectEndpoint(plan, 'media:video', undefined, {
        overrides: { 'ark-video': { models: [{ id: 'doubao-seedance-2-0-260128', name: 'Seedance', tasks: ['image'] }] } },
      }),
    ).toBeUndefined()
  })
})

describe('validatePlatform', () => {
  it('flags an endpoint with an unknown protocol', () => {
    const bad: Platform = {
      id: 'bad',
      brand: 'bad',
      name: 'Bad',
      plans: [
        {
          id: 'api',
          name: 'API',
          auth: 'api-key',
          endpoints: [{ id: 'x', baseUrl: '', protocols: ['bogus-protocol' as WireProtocol] }],
        },
      ],
    }
    expect(validatePlatform(bad).length).toBeGreaterThan(0)
  })

  it('flags an endpoint with no protocols', () => {
    const bad: Platform = {
      id: 'bad2',
      brand: 'bad',
      name: 'Bad',
      plans: [{ id: 'api', name: 'API', auth: 'api-key', endpoints: [{ id: 'x', baseUrl: '', protocols: [] }] }],
    }
    expect(validatePlatform(bad).length).toBeGreaterThan(0)
  })
})

describe('assembleRegistry', () => {
  it('lets a custom platform override a builtin of the same id', () => {
    const custom: Platform = { id: 'anthropic', brand: 'x', name: 'Overridden', plans: [] }
    const merged = assembleRegistry(BUILTIN_PLATFORMS, [custom])
    expect(findPlatform(merged, 'anthropic')?.name).toBe('Overridden')
    expect(merged.filter((p) => p.id === 'anthropic')).toHaveLength(1)
  })
})

describe('synthesizePlatformFromCatalog', () => {
  it('builds a single api plan with one openai-chat endpoint', () => {
    const platform = synthesizePlatformFromCatalog({
      id: 'groq',
      name: 'Groq',
      npm: '@ai-sdk/groq',
      api: 'https://api.groq.com/openai/v1',
      env: ['GROQ_API_KEY'],
      doc: 'https://console.groq.com/docs',
      models: [],
    })
    expect(platform.id).toBe('catalog:groq')
    expect(platform.plans[0].endpoints[0].protocols).toEqual(['openai-chat'])
    expect(platform.plans[0].endpoints[0].baseUrl).toBe('https://api.groq.com/openai/v1')
  })
})

describe('resolveEndpointModels (image source)', () => {
  const model = (id: string, output: CatalogModel['outputModalities']): CatalogModel => ({
    id,
    name: id,
    providerId: 'openai',
    inputModalities: ['text'],
    outputModalities: output,
    reasoning: false,
    toolCall: false,
    attachment: false,
  })

  const catalog: ModelCatalog = {
    generatedAt: '',
    source: 'snapshot',
    providers: [
      {
        id: 'openai',
        name: 'OpenAI',
        npm: '@ai-sdk/openai',
        env: [],
        doc: '',
        models: [
          model('gpt-image-2', ['image']),
          model('gpt-5-chat', ['text']),
          model('dall-e-3', ['image']),
        ],
      },
    ],
  }

  const openaiImage = () => {
    const platform = findPlatform(BUILTIN_PLATFORMS, 'openai')!
    const plan = findPlan(platform, 'api')!
    const endpoint = findEndpoint(plan, 'openai')!
    return { platform, plan, endpoint }
  }

  it('sources builtin models from the catalog across the endpoint task union (chat + image)', () => {
    const { platform, plan, endpoint } = openaiImage()
    // Builtin openai endpoint no longer hardcodes models.
    expect(endpoint.models).toBeUndefined()
    const models = resolveEndpointModels(platform, plan, endpoint, catalog)
    // The collapsed openai endpoint speaks responses+images+audio, so chat and image models both qualify.
    expect(models.map((m) => m.id)).toEqual(['gpt-image-2', 'gpt-5-chat', 'dall-e-3'])
  })

  it('returns nothing without a catalog when no curated list exists', () => {
    const { platform, plan, endpoint } = openaiImage()
    expect(resolveEndpointModels(platform, plan, endpoint, undefined)).toEqual([])
  })

  it('prefers a curated endpoint list over the catalog', () => {
    const platform: Platform = {
      id: 'custom:x',
      brand: 'custom',
      name: 'Custom',
      catalogProviderId: 'openai',
      plans: [
        {
          id: 'api',
          name: 'API',
          auth: 'api-key',
          endpoints: [
            {
              id: 'images',
              baseUrl: '',
              protocols: ['openai-images'],
              models: [{ id: 'my-model', name: 'Mine' }],
            },
          ],
        },
      ],
    }
    const plan = findPlan(platform, 'api')!
    const endpoint = findEndpoint(plan, 'images')!
    expect(resolveEndpointModels(platform, plan, endpoint, catalog).map((m) => m.id)).toEqual(['my-model'])
  })
})
