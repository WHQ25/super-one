import type { ProviderModelEnv } from '../agent-types'
import { PROXY_TRANSFORMERS_ENV } from './protocols'
import type { EndpointModel, Platform, ServiceEndpoint } from './types'

// --- endpoint helpers ---------------------------------------------------------

function anthropic(
  baseUrl: string,
  opts: { extraEnv?: Record<string, string>; modelMapping?: ProviderModelEnv; models?: EndpointModel[]; id?: string } = {},
): ServiceEndpoint {
  const defaults =
    opts.extraEnv || opts.modelMapping ? { extraEnv: opts.extraEnv, modelMapping: opts.modelMapping } : undefined
  return { id: opts.id ?? 'anthropic', baseUrl, protocols: ['anthropic-messages'], defaults, models: opts.models }
}

function openaiChat(
  baseUrl: string,
  opts: { extraEnv?: Record<string, string>; modelMapping?: ProviderModelEnv; models?: EndpointModel[]; id?: string } = {},
): ServiceEndpoint {
  const defaults =
    opts.extraEnv || opts.modelMapping ? { extraEnv: opts.extraEnv, modelMapping: opts.modelMapping } : undefined
  return { id: opts.id ?? 'openai', baseUrl, protocols: ['openai-chat'], defaults, models: opts.models }
}

// --- shared model mappings ----------------------------------------------------

const XIAOMI_MODELS: ProviderModelEnv = {
  default: { id: 'mimo-v2.5-pro', name: 'MiMo V2.5 Pro' },
  opus: { id: 'mimo-v2.5-pro', name: 'MiMo V2.5 Pro' },
  sonnet: { id: 'mimo-v2.5-pro', name: 'MiMo V2.5 Pro' },
  haiku: { id: 'mimo-v2.5-pro', name: 'MiMo V2.5 Pro' },
}

const BAILIAN_CODING_PLAN_MODELS: ProviderModelEnv = {
  default: { id: 'qwen3.7-plus', name: 'Qwen 3.7 Plus' },
  opus: { id: 'qwen3.7-plus', name: 'Qwen 3.7 Plus' },
  sonnet: { id: 'qwen3.7-plus', name: 'Qwen 3.7 Plus' },
  haiku: { id: 'qwen3.7-plus', name: 'Qwen 3.7 Plus' },
  subagent: { id: 'qwen3.7-plus', name: 'Qwen 3.7 Plus' },
}

const BAILIAN_TOKEN_PLAN_MODELS: ProviderModelEnv = {
  default: { id: 'qwen3.7-max', name: 'Qwen 3.7 Max' },
  opus: { id: 'qwen3.7-max', name: 'Qwen 3.7 Max' },
  sonnet: { id: 'qwen3.7-max', name: 'Qwen 3.7 Max' },
  haiku: { id: 'qwen3.6-flash', name: 'Qwen 3.6 Flash' },
  subagent: { id: 'qwen3.7-max', name: 'Qwen 3.7 Max' },
}

const BAILIAN_API_MODELS: ProviderModelEnv = {
  default: { id: 'qwen3.7-max', name: 'Qwen 3.7 Max' },
  opus: { id: 'qwen3.7-max', name: 'Qwen 3.7 Max' },
  sonnet: { id: 'qwen3.7-max', name: 'Qwen 3.7 Max' },
  haiku: { id: 'qwen3.6-flash', name: 'Qwen 3.6 Flash' },
  subagent: { id: 'qwen3.7-max', name: 'Qwen 3.7 Max' },
}

const GLM_MODELS: ProviderModelEnv = {
  default: { id: 'glm-5.2[1m]', name: 'GLM-5.2' },
  opus: { id: 'glm-5.2[1m]', name: 'GLM-5.2' },
  sonnet: { id: 'glm-5.2[1m]', name: 'GLM-5.2' },
  haiku: { id: 'glm-4.5-air', name: 'GLM-4.5 Air' },
}

const MINIMAX_MODELS: ProviderModelEnv = {
  default: { id: 'MiniMax-M3[1m]', name: 'MiniMax M3' },
  opus: { id: 'MiniMax-M3[1m]', name: 'MiniMax M3' },
  sonnet: { id: 'MiniMax-M3', name: 'MiniMax M3' },
  haiku: { id: 'MiniMax-M3', name: 'MiniMax M3' },
}

const DOUBAO_MODELS: ProviderModelEnv = {
  default: { id: 'doubao-seed-2-0-code-preview-latest', name: 'Doubao Seed 2.0 Code' },
  opus: { id: 'doubao-seed-2-0-code-preview-latest', name: 'Doubao Seed 2.0 Code' },
  sonnet: { id: 'doubao-seed-2-0-code-preview-latest', name: 'Doubao Seed 2.0 Code' },
  haiku: { id: 'doubao-seed-2-0-code-preview-latest', name: 'Doubao Seed 2.0 Code' },
}

/**
 * Curated video model lists. These live on their own endpoints because `resolveEndpointModels`
 * treats a curated `models` array as a full replacement for the catalog list — putting them on the
 * shared chat/image endpoint would wipe out its catalog-driven models. models.dev carries no video
 * models for volcengine / openai / google, so a curated list is the only way these resolve at all.
 */
const SEEDANCE_MODELS: EndpointModel[] = [
  { id: 'doubao-seedance-2-0-260128', name: 'Seedance 2.0', tasks: ['video'] },
  { id: 'doubao-seedance-2-0-fast-260128', name: 'Seedance 2.0 Fast', tasks: ['video'] },
  { id: 'doubao-seedance-1-5-pro-250428', name: 'Seedance 1.5 Pro', tasks: ['video'] },
  { id: 'doubao-seedance-1-0-pro-250528', name: 'Seedance 1.0 Pro', tasks: ['video'] },
  { id: 'doubao-seedance-1-0-lite-t2v-250428', name: 'Seedance 1.0 Lite (T2V)', tasks: ['video'] },
  { id: 'doubao-seedance-1-0-lite-i2v-250428', name: 'Seedance 1.0 Lite (I2V)', tasks: ['video'] },
]

const SORA_MODELS: EndpointModel[] = [
  { id: 'sora-2', name: 'Sora 2', tasks: ['video'] },
  { id: 'sora-2-pro', name: 'Sora 2 Pro', tasks: ['video'] },
]

const VEO_MODELS: EndpointModel[] = [
  { id: 'veo-3.1-generate', name: 'Veo 3.1', tasks: ['video'] },
  { id: 'veo-3.1-fast-generate-preview', name: 'Veo 3.1 Fast', tasks: ['video'] },
  { id: 'veo-3.0-generate-001', name: 'Veo 3.0', tasks: ['video'] },
  { id: 'veo-3.0-fast-generate-001', name: 'Veo 3.0 Fast', tasks: ['video'] },
  { id: 'veo-2.0-generate-001', name: 'Veo 2.0', tasks: ['video'] },
]

const ARK_CODE_MODELS: ProviderModelEnv = {
  default: { id: 'ark-code-latest', name: 'Ark Code Latest' },
  opus: { id: 'ark-code-latest', name: 'Ark Code Latest' },
  sonnet: { id: 'ark-code-latest', name: 'Ark Code Latest' },
  haiku: { id: 'ark-code-latest', name: 'Ark Code Latest' },
}

const KIMI_API_MODELS: ProviderModelEnv = {
  default: { id: 'kimi-k3', name: 'Kimi K3' },
  opus: { id: 'kimi-k3', name: 'Kimi K3' },
  sonnet: { id: 'kimi-k3', name: 'Kimi K3' },
  haiku: { id: 'kimi-k2.7-code-highspeed', name: 'Kimi K2.7 Code HighSpeed' },
  subagent: { id: 'kimi-k3', name: 'Kimi K3' },
}

const KIMI_ANDANTE_MODELS: ProviderModelEnv = {
  default: { id: 'kimi-for-coding', name: 'Kimi for Coding' },
  opus: { id: 'kimi-for-coding', name: 'Kimi for Coding' },
  sonnet: { id: 'kimi-for-coding', name: 'Kimi for Coding' },
  haiku: { id: 'kimi-for-coding', name: 'Kimi for Coding' },
  subagent: { id: 'kimi-for-coding', name: 'Kimi for Coding' },
}

const KIMI_ANDANTE_ENDPOINT_MODELS: EndpointModel[] = [
  { id: 'kimi-for-coding', name: 'Kimi for Coding', tasks: ['chat'] },
]

const KIMI_MODERATO_MODELS: ProviderModelEnv = {
  default: { id: 'k3', name: 'Kimi K3' },
  opus: { id: 'k3', name: 'Kimi K3' },
  sonnet: { id: 'k3', name: 'Kimi K3' },
  haiku: { id: 'kimi-for-coding', name: 'Kimi for Coding' },
  subagent: { id: 'k3', name: 'Kimi K3' },
}

const KIMI_MODERATO_ENDPOINT_MODELS: EndpointModel[] = [
  { id: 'k3', name: 'Kimi K3', tasks: ['chat'] },
  { id: 'kimi-for-coding', name: 'Kimi for Coding', tasks: ['chat'] },
]

const KIMI_ALLEGRETTO_MODELS: ProviderModelEnv = {
  default: { id: 'k3[1m]', name: 'Kimi K3' },
  opus: { id: 'k3[1m]', name: 'Kimi K3' },
  sonnet: { id: 'k3[1m]', name: 'Kimi K3' },
  haiku: { id: 'kimi-for-coding', name: 'Kimi for Coding' },
  subagent: { id: 'k3[1m]', name: 'Kimi K3' },
}

const KIMI_ALLEGRETTO_ENDPOINT_MODELS: EndpointModel[] = [
  { id: 'k3', name: 'Kimi K3', tasks: ['chat'] },
  { id: 'kimi-for-coding', name: 'Kimi for Coding', tasks: ['chat'] },
  { id: 'kimi-for-coding-highspeed', name: 'Kimi for Coding HighSpeed', tasks: ['chat'] },
]

const NVIDIA_MODELS: ProviderModelEnv = {
  default: { id: 'moonshotai/kimi-k3', name: 'Kimi K3' },
  opus: { id: 'moonshotai/kimi-k3', name: 'Kimi K3' },
  sonnet: { id: 'moonshotai/kimi-k3', name: 'Kimi K3' },
  haiku: { id: 'moonshotai/kimi-k3', name: 'Kimi K3' },
}

const CODING_TIMEOUT = { API_TIMEOUT_MS: '3000000' }
const DISABLE_NONESSENTIAL = { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' }
const EMPTY_AUTH_TOKEN = { ANTHROPIC_AUTH_TOKEN: '' }

const KIMI_BASE_EXTRA_ENV = {
  ...CODING_TIMEOUT,
  ENABLE_TOOL_SEARCH: 'false',
  ...DISABLE_NONESSENTIAL,
  ...EMPTY_AUTH_TOKEN,
}

const KIMI_CTX_256K = {
  CLAUDE_CODE_AUTO_COMPACT_WINDOW: '262144',
  CLAUDE_CODE_MAX_CONTEXT_TOKENS: '262144',
}

const KIMI_CTX_1M = {
  CLAUDE_CODE_AUTO_COMPACT_WINDOW: '1048576',
  CLAUDE_CODE_MAX_CONTEXT_TOKENS: '1048576',
}

const KIMI_ANDANTE_EXTRA_ENV = {
  ...KIMI_BASE_EXTRA_ENV,
  ...KIMI_CTX_256K,
}

const KIMI_MODERATO_EXTRA_ENV = {
  ...KIMI_BASE_EXTRA_ENV,
  ...KIMI_CTX_256K,
  CLAUDE_CODE_EFFORT_LEVEL: 'max',
}

const KIMI_ALLEGRETTO_EXTRA_ENV = {
  ...KIMI_BASE_EXTRA_ENV,
  ...KIMI_CTX_1M,
  CLAUDE_CODE_EFFORT_LEVEL: 'max',
}

const KIMI_EXTRA_ENV = {
  ...KIMI_BASE_EXTRA_ENV,
  ...KIMI_CTX_1M,
}

// --- built-in platforms -------------------------------------------------------

export const BUILTIN_PLATFORMS: Platform[] = [
  // Official subscription (OAuth) — Credential rows exist so bindings have a target, but hold no secret.
  {
    id: 'claude-official',
    brand: 'claude',
    name: 'Claude',
    description: 'Claude Pro / Max subscription via the official Anthropic login',
    catalogProviderId: 'anthropic',
    plans: [
      {
        id: 'subscription',
        name: 'Subscription',
        auth: 'oauth',
        endpoints: [anthropic('')],
      },
    ],
  },
  {
    id: 'openai-official',
    brand: 'openai',
    name: 'ChatGPT',
    description: 'ChatGPT Plus / Pro subscription via the official OpenAI login',
    catalogProviderId: 'openai',
    plans: [
      {
        id: 'subscription',
        name: 'Subscription',
        auth: 'oauth',
        endpoints: [{ id: 'responses', baseUrl: '', protocols: ['openai-responses'] }],
      },
    ],
  },

  // Coding-plan model providers (Anthropic-protocol compatible)
  {
    id: 'zhipu-cn',
    brand: 'zhipu',
    name: 'GLM (CN)',
    description: '智谱 GLM 编程套餐 — 中国区，支持 Claude 协议兼容调用',
    catalogProviderId: 'zhipuai',
    plans: [
      {
        id: 'coding',
        name: 'Coding Plan',
        description: '智谱 GLM 编程套餐 — 中国区，支持 Claude 协议兼容调用',
        auth: 'api-key',
        apiKeyUrl: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys',
        catalogProviderId: 'zhipuai-coding-plan',
        endpoints: [
          anthropic('https://open.bigmodel.cn/api/anthropic', {
            extraEnv: {
              ...CODING_TIMEOUT,
              CLAUDE_CODE_AUTO_COMPACT_WINDOW: '1000000',
              ...DISABLE_NONESSENTIAL,
              ...EMPTY_AUTH_TOKEN,
            },
            modelMapping: GLM_MODELS,
          }),
          // Coding Plan OpenAI Chat Completions — not the pay-as-you-go /paas/v4 path.
          openaiChat('https://open.bigmodel.cn/api/coding/paas/v4', {
            modelMapping: GLM_MODELS,
          }),
        ],
      },
      {
        id: 'api',
        name: 'API',
        auth: 'api-key',
        apiKeyUrl: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys',
        catalogProviderId: 'zhipuai',
        endpoints: [
          anthropic('https://open.bigmodel.cn/api/anthropic', {
            extraEnv: {
              ...CODING_TIMEOUT,
              CLAUDE_CODE_AUTO_COMPACT_WINDOW: '1000000',
              ...DISABLE_NONESSENTIAL,
              ...EMPTY_AUTH_TOKEN,
            },
            modelMapping: GLM_MODELS,
          }),
          openaiChat('https://open.bigmodel.cn/api/paas/v4', {
            modelMapping: GLM_MODELS,
          }),
        ],
      },
    ],
  },
  {
    id: 'zhipu-global',
    brand: 'zai',
    name: 'GLM (Global)',
    description: 'Zhipu GLM Code Plan — Global endpoint for international users',
    catalogProviderId: 'zai',
    plans: [
      {
        id: 'coding',
        name: 'Coding Plan',
        auth: 'api-key',
        apiKeyUrl: 'https://z.ai/manage-apikey/apikey-list',
        catalogProviderId: 'zai-coding-plan',
        endpoints: [
          anthropic('https://api.z.ai/api/anthropic', {
            extraEnv: {
              ...CODING_TIMEOUT,
              CLAUDE_CODE_AUTO_COMPACT_WINDOW: '1000000',
              ...DISABLE_NONESSENTIAL,
              ...EMPTY_AUTH_TOKEN,
            },
            modelMapping: GLM_MODELS,
          }),
          openaiChat('https://api.z.ai/api/coding/paas/v4', {
            modelMapping: GLM_MODELS,
          }),
        ],
      },
      {
        id: 'api',
        name: 'API',
        auth: 'api-key',
        apiKeyUrl: 'https://z.ai/manage-apikey/apikey-list',
        catalogProviderId: 'zai',
        endpoints: [
          anthropic('https://api.z.ai/api/anthropic', {
            extraEnv: {
              ...CODING_TIMEOUT,
              CLAUDE_CODE_AUTO_COMPACT_WINDOW: '1000000',
              ...DISABLE_NONESSENTIAL,
              ...EMPTY_AUTH_TOKEN,
            },
            modelMapping: GLM_MODELS,
          }),
          openaiChat('https://api.z.ai/api/paas/v4', {
            modelMapping: GLM_MODELS,
          }),
        ],
      },
    ],
  },
  {
    id: 'kimi',
    brand: 'kimi',
    name: 'Kimi',
    description: 'Kimi Code — 编程套餐订阅，按会员档位区分模型与上下文配置',
    catalogProviderId: 'moonshotai',
    plans: [
      {
        id: 'andante',
        name: 'Andante',
        description: 'Kimi Code Andante — kimi-for-coding，256k 上下文',
        auth: 'api-key',
        apiKeyUrl: 'https://www.kimi.com/code/console',
        endpoints: [
          anthropic('https://api.kimi.com/coding/', {
            extraEnv: KIMI_ANDANTE_EXTRA_ENV,
            modelMapping: KIMI_ANDANTE_MODELS,
            models: KIMI_ANDANTE_ENDPOINT_MODELS,
          }),
          openaiChat('https://api.kimi.com/coding/v1', {
            modelMapping: KIMI_ANDANTE_MODELS,
            models: KIMI_ANDANTE_ENDPOINT_MODELS,
          }),
        ],
      },
      {
        id: 'moderato',
        name: 'Moderato',
        description: 'Kimi Code Moderato — k3 / kimi-for-coding，256k 上下文',
        auth: 'api-key',
        apiKeyUrl: 'https://www.kimi.com/code/console',
        endpoints: [
          anthropic('https://api.kimi.com/coding/', {
            extraEnv: KIMI_MODERATO_EXTRA_ENV,
            modelMapping: KIMI_MODERATO_MODELS,
            models: KIMI_MODERATO_ENDPOINT_MODELS,
          }),
          openaiChat('https://api.kimi.com/coding/v1', {
            modelMapping: KIMI_MODERATO_MODELS,
            models: KIMI_MODERATO_ENDPOINT_MODELS,
          }),
        ],
      },
      {
        id: 'allegretto',
        name: 'Allegretto+',
        description: 'Kimi Code Allegretto 及以上 — k3[1m] / HighSpeed，最高 1M 上下文',
        auth: 'api-key',
        apiKeyUrl: 'https://www.kimi.com/code/console',
        endpoints: [
          anthropic('https://api.kimi.com/coding/', {
            extraEnv: KIMI_ALLEGRETTO_EXTRA_ENV,
            modelMapping: KIMI_ALLEGRETTO_MODELS,
            models: KIMI_ALLEGRETTO_ENDPOINT_MODELS,
          }),
          openaiChat('https://api.kimi.com/coding/v1', {
            modelMapping: KIMI_ALLEGRETTO_MODELS,
            models: KIMI_ALLEGRETTO_ENDPOINT_MODELS,
          }),
        ],
      },
    ],
  },
  {
    id: 'moonshot',
    brand: 'moonshot',
    name: 'Moonshot',
    description: 'Moonshot 开放平台 — 按量计费 API',
    catalogProviderId: 'moonshotai',
    plans: [
      {
        id: 'cn',
        name: '中国版',
        description: 'Moonshot 开放平台 API — 按量计费，中国区端点',
        auth: 'api-key',
        apiKeyUrl: 'https://platform.kimi.com/console/api-keys',
        catalogProviderId: 'moonshotai',
        endpoints: [
          anthropic('https://api.moonshot.cn/anthropic', {
            extraEnv: KIMI_EXTRA_ENV,
            modelMapping: KIMI_API_MODELS,
          }),
          openaiChat('https://api.moonshot.cn/v1', {
            modelMapping: KIMI_API_MODELS,
          }),
        ],
      },
      {
        id: 'global',
        name: 'Global',
        description: 'Moonshot Open Platform API — pay-as-you-go, global endpoint',
        auth: 'api-key',
        apiKeyUrl: 'https://platform.kimi.ai/console/api-keys',
        catalogProviderId: 'moonshotai',
        endpoints: [
          anthropic('https://api.moonshot.ai/anthropic', {
            extraEnv: KIMI_EXTRA_ENV,
            modelMapping: KIMI_API_MODELS,
          }),
          openaiChat('https://api.moonshot.ai/v1', {
            modelMapping: KIMI_API_MODELS,
          }),
        ],
      },
    ],
  },
  {
    id: 'minimax',
    brand: 'minimax',
    name: 'MiniMax',
    description: 'MiniMax 编程套餐或 API — 海螺 AI 代码模型',
    plans: [
      {
        id: 'cn',
        name: '中国版',
        description: 'MiniMax 编程套餐或 API — 中国区，海螺 AI 代码模型',
        auth: 'api-key',
        apiKeyUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
        endpoints: [
          anthropic('https://api.minimaxi.com/anthropic', {
            extraEnv: { ...CODING_TIMEOUT, ...DISABLE_NONESSENTIAL, ...EMPTY_AUTH_TOKEN },
            modelMapping: MINIMAX_MODELS,
          }),
          openaiChat('https://api.minimaxi.com/v1', {
            modelMapping: MINIMAX_MODELS,
          }),
        ],
      },
      {
        id: 'global',
        name: 'Global',
        description: 'MiniMax Coding Plan or API — Global endpoint for international users',
        auth: 'api-key',
        apiKeyUrl: 'https://platform.minimax.io/user-center/basic-information/interface-key',
        endpoints: [
          anthropic('https://api.minimax.io/anthropic', {
            extraEnv: { ...CODING_TIMEOUT, ...DISABLE_NONESSENTIAL, ...EMPTY_AUTH_TOKEN },
            modelMapping: MINIMAX_MODELS,
          }),
          openaiChat('https://api.minimax.io/v1', {
            modelMapping: MINIMAX_MODELS,
          }),
        ],
      },
    ],
  },
  {
    id: 'volcengine',
    brand: 'volcengine',
    name: 'Volcengine Ark',
    description: '火山引擎方舟 — 聚合豆包、GLM、DeepSeek、Kimi 等多模型',
    catalogProviderId: 'volcengine',
    plans: [
      {
        id: 'agent',
        name: 'Agent Plan',
        description: '火山方舟 Agent Plan — 编程 + 多模态 + Harness 工具链，需专属 Agent Plan API Key',
        auth: 'api-key',
        apiKeyUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey',
        catalogProviderId: 'volcengine-agent-plan',
        endpoints: [
          anthropic('https://ark.cn-beijing.volces.com/api/plan', {
            extraEnv: { ...CODING_TIMEOUT, ...EMPTY_AUTH_TOKEN },
            modelMapping: ARK_CODE_MODELS,
          }),
          // Agent Plan OpenAI path — do not use /api/v3 (bypasses plan quota).
          openaiChat('https://ark.cn-beijing.volces.com/api/plan/v3', {
            modelMapping: ARK_CODE_MODELS,
          }),
        ],
      },
      {
        id: 'coding',
        name: 'Coding Plan',
        auth: 'api-key',
        apiKeyUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey',
        catalogProviderId: 'volcengine-coding-plan',
        endpoints: [
          anthropic('https://ark.cn-beijing.volces.com/api/coding', {
            extraEnv: { ...CODING_TIMEOUT, ...EMPTY_AUTH_TOKEN },
            modelMapping: ARK_CODE_MODELS,
          }),
          // Coding Plan OpenAI path — do not use /api/v3 (bypasses plan quota).
          openaiChat('https://ark.cn-beijing.volces.com/api/coding/v3', {
            modelMapping: ARK_CODE_MODELS,
          }),
        ],
      },
      {
        id: 'api',
        name: 'API',
        auth: 'api-key',
        apiKeyUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey',
        catalogProviderId: 'volcengine',
        endpoints: [
          anthropic('https://ark.cn-beijing.volces.com/api/compatible', {
            extraEnv: { ...CODING_TIMEOUT, ...EMPTY_AUTH_TOKEN },
            modelMapping: DOUBAO_MODELS,
          }),
          openaiChat('https://ark.cn-beijing.volces.com/api/v3', {
            modelMapping: DOUBAO_MODELS,
          }),
          {
            id: 'ark-images',
            baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
            protocols: ['ark-images'],
          },
          {
            id: 'ark-video',
            baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
            protocols: ['ark-video'],
            models: SEEDANCE_MODELS,
          },
        ],
      },
    ],
  },
  {
    id: 'xiaomi',
    brand: 'xiaomimimo',
    name: 'Xiaomi MiMo',
    description: '小米 MiMo — 支持 Claude 协议',
    plans: [
      {
        id: 'token-plan',
        name: 'Token Plan',
        auth: 'api-key',
        apiKeyUrl: 'https://platform.xiaomimimo.com/#/console/api-keys',
        endpoints: [
          anthropic('https://token-plan-cn.xiaomimimo.com/anthropic', {
            extraEnv: { ...EMPTY_AUTH_TOKEN },
            modelMapping: XIAOMI_MODELS,
          }),
        ],
      },
      {
        id: 'api',
        name: 'API',
        auth: 'api-key',
        apiKeyUrl: 'https://platform.xiaomimimo.com/#/console/api-keys',
        endpoints: [
          anthropic('https://api.xiaomimimo.com/anthropic', {
            extraEnv: { ...EMPTY_AUTH_TOKEN },
            modelMapping: XIAOMI_MODELS,
          }),
        ],
      },
    ],
  },
  {
    id: 'bailian',
    brand: 'bailian',
    name: 'Aliyun Bailian',
    description: '阿里云百炼 — 聚合通义千问、GLM、Kimi、MiniMax 等多模型',
    catalogProviderId: 'alibaba-cn',
    plans: [
      {
        id: 'coding',
        name: 'Coding Plan',
        auth: 'api-key',
        apiKeyUrl: 'https://bailian.console.aliyun.com/?tab=model#/api-key',
        catalogProviderId: 'alibaba-coding-plan-cn',
        endpoints: [
          anthropic('https://coding.dashscope.aliyuncs.com/apps/anthropic', {
            extraEnv: { ...EMPTY_AUTH_TOKEN },
            modelMapping: BAILIAN_CODING_PLAN_MODELS,
          }),
          // Coding Plan OpenAI path — requires Coding Plan key (sk-sp-…), not pay-as-you-go sk-.
          openaiChat('https://coding.dashscope.aliyuncs.com/v1', {
            modelMapping: BAILIAN_CODING_PLAN_MODELS,
          }),
        ],
      },
      {
        id: 'token',
        name: 'Token Plan',
        auth: 'api-key',
        apiKeyUrl: 'https://bailian.console.aliyun.com/?tab=model#/api-key',
        catalogProviderId: 'alibaba-token-plan-cn',
        endpoints: [
          anthropic('https://dashscope.aliyuncs.com/apps/anthropic', {
            extraEnv: { ...EMPTY_AUTH_TOKEN },
            modelMapping: BAILIAN_TOKEN_PLAN_MODELS,
          }),
          openaiChat('https://dashscope.aliyuncs.com/compatible-mode/v1', {
            modelMapping: BAILIAN_TOKEN_PLAN_MODELS,
          }),
        ],
      },
      {
        id: 'api',
        name: 'API',
        auth: 'api-key',
        apiKeyUrl: 'https://bailian.console.aliyun.com/?tab=model#/api-key',
        catalogProviderId: 'alibaba-cn',
        endpoints: [
          anthropic('https://dashscope.aliyuncs.com/apps/anthropic', {
            extraEnv: { ...EMPTY_AUTH_TOKEN },
            modelMapping: BAILIAN_API_MODELS,
          }),
          openaiChat('https://dashscope.aliyuncs.com/compatible-mode/v1', {
            modelMapping: BAILIAN_API_MODELS,
          }),
        ],
      },
    ],
  },
  {
    id: 'kat-coder',
    brand: 'kwaikat',
    name: 'KAT-Coder',
    description: 'KAT-Coder — 快手旗下 AI 编程模型（需填入 Vanchin Endpoint ID）',
    plans: [
      {
        id: 'coding',
        name: 'Coding Plan',
        auth: 'api-key',
        apiKeyUrl: 'https://console.streamlake.com/console/wanqing/api-key',
        endpoints: [
          anthropic('https://vanchin.streamlake.ai/api/gateway/v1/endpoints/${ENDPOINT_ID}/claude-code-proxy', {
            extraEnv: { ...EMPTY_AUTH_TOKEN },
            modelMapping: {
              default: { id: 'kat-coder-pro-v2', name: 'KAT-Coder Pro V2' },
              opus: { id: 'kat-coder-pro-v2', name: 'KAT-Coder Pro V2' },
              sonnet: { id: 'kat-coder-pro-v2', name: 'KAT-Coder Pro V2' },
              haiku: { id: 'KAT-Coder-Air V1', name: 'KAT-Coder Air V1' },
            },
          }),
        ],
      },
    ],
  },
  {
    id: 'longcat',
    brand: 'longcat',
    name: 'Longcat',
    description: 'Longcat — 长猫 AI 编程助手',
    plans: [
      {
        id: 'coding',
        name: 'Coding Plan',
        auth: 'api-key',
        apiKeyUrl: 'https://longcat.chat/platform/api_keys',
        endpoints: [
          anthropic('https://api.longcat.chat/anthropic', {
            extraEnv: {
              ...EMPTY_AUTH_TOKEN,
              CLAUDE_CODE_MAX_OUTPUT_TOKENS: '6000',
              ...DISABLE_NONESSENTIAL,
            },
            modelMapping: {
              default: { id: 'LongCat-Flash-Chat', name: 'LongCat Flash Chat' },
              opus: { id: 'LongCat-Flash-Chat', name: 'LongCat Flash Chat' },
              sonnet: { id: 'LongCat-Flash-Chat', name: 'LongCat Flash Chat' },
              haiku: { id: 'LongCat-Flash-Chat', name: 'LongCat Flash Chat' },
            },
          }),
        ],
      },
    ],
  },

  // Direct / API-tier model providers
  {
    id: 'anthropic',
    brand: 'anthropic',
    name: 'Anthropic',
    description: 'Direct access to Claude models via the official Anthropic API',
    catalogProviderId: 'anthropic',
    plans: [
      {
        id: 'api',
        name: 'API',
        auth: 'api-key',
        apiKeyUrl: 'https://console.anthropic.com/settings/keys',
        endpoints: [anthropic('https://api.anthropic.com')],
      },
    ],
  },
  {
    id: 'deepseek',
    brand: 'deepseek',
    name: 'DeepSeek',
    description: 'DeepSeek — 深度求索，支持 Claude 协议兼容调用',
    catalogProviderId: 'deepseek',
    plans: [
      {
        id: 'api',
        name: 'API',
        auth: 'api-key',
        apiKeyUrl: 'https://platform.deepseek.com/api_keys',
        endpoints: [
          openaiChat('https://api.deepseek.com'),
          anthropic('https://api.deepseek.com/anthropic', {
            extraEnv: {
              ...EMPTY_AUTH_TOKEN,
              ...DISABLE_NONESSENTIAL,
              CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK: '1',
              CLAUDE_CODE_EFFORT_LEVEL: 'max',
            },
            modelMapping: {
              default: { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
              opus: { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
              sonnet: { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
              haiku: { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
              subagent: { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
            },
          }),
        ],
      },
    ],
  },
  {
    id: 'openrouter',
    brand: 'openrouter',
    name: 'OpenRouter',
    description: 'Unified API gateway — access Claude and 200+ models through a single key',
    catalogProviderId: 'openrouter',
    plans: [
      {
        id: 'api',
        name: 'API',
        auth: 'api-key',
        apiKeyUrl: 'https://openrouter.ai/settings/keys',
        endpoints: [
          anthropic('https://openrouter.ai/api'),
          openaiChat('https://openrouter.ai/api/v1', {
            extraEnv: { OPENAI_BASE_URL: 'https://openrouter.ai/api/v1' },
          }),
        ],
      },
    ],
  },
  {
    id: 'modelscope',
    brand: 'modelscope',
    name: 'ModelScope',
    description: 'ModelScope 魔搭 — 阿里巴巴模型聚合平台',
    plans: [
      {
        id: 'api',
        name: 'API',
        auth: 'api-key',
        apiKeyUrl: 'https://modelscope.cn/my/myaccesstoken',
        endpoints: [
          anthropic('https://api-inference.modelscope.cn', {
            extraEnv: { ...EMPTY_AUTH_TOKEN },
            modelMapping: {
              default: { id: 'ZhipuAI/GLM-5.1', name: 'GLM-5.1' },
              opus: { id: 'ZhipuAI/GLM-5.1', name: 'GLM-5.1' },
              sonnet: { id: 'ZhipuAI/GLM-5.1', name: 'GLM-5.1' },
              haiku: { id: 'ZhipuAI/GLM-5.1', name: 'GLM-5.1' },
            },
          }),
        ],
      },
    ],
  },
  {
    id: 'siliconflow',
    brand: 'siliconcloud',
    name: 'SiliconFlow',
    description: 'SiliconFlow 硅基流动 — AI 模型聚合推理平台',
    plans: [
      {
        id: 'api',
        name: 'API',
        auth: 'api-key',
        apiKeyUrl: 'https://cloud.siliconflow.cn/account/ak',
        endpoints: [
          anthropic('https://api.siliconflow.cn', {
            extraEnv: { ...EMPTY_AUTH_TOKEN },
            modelMapping: {
              default: { id: 'Pro/MiniMaxAI/MiniMax-M2.7', name: 'MiniMax M2.7' },
              opus: { id: 'Pro/MiniMaxAI/MiniMax-M2.7', name: 'MiniMax M2.7' },
              sonnet: { id: 'Pro/MiniMaxAI/MiniMax-M2.7', name: 'MiniMax M2.7' },
              haiku: { id: 'Pro/MiniMaxAI/MiniMax-M2.7', name: 'MiniMax M2.7' },
            },
          }),
        ],
      },
    ],
  },
  {
    id: 'nvidia',
    brand: 'nvidia',
    name: 'Nvidia NIM',
    description: 'Nvidia NIM — 通过 NVIDIA 推理微服务访问 AI 模型',
    catalogProviderId: 'nvidia',
    plans: [
      {
        id: 'api',
        name: 'API',
        auth: 'api-key',
        apiKeyUrl: 'https://build.nvidia.com/settings/api-keys',
        endpoints: [
          openaiChat('https://integrate.api.nvidia.com/v1', {
            modelMapping: NVIDIA_MODELS,
            extraEnv: { [PROXY_TRANSFORMERS_ENV]: 'openai,reasoning' },
          }),
        ],
      },
    ],
  },

  // Cloud platforms
  {
    id: 'bedrock',
    brand: 'bedrock',
    name: 'AWS Bedrock',
    description: 'Amazon Bedrock — run Claude on AWS infrastructure with IAM authentication',
    plans: [
      {
        id: 'aws',
        name: 'AWS',
        auth: 'api-key',
        endpoints: [
          anthropic('https://bedrock-mantle.<your-region>.api.aws/anthropic', {
            extraEnv: {
              CLAUDE_CODE_USE_BEDROCK: '1'
            },
          }),
        ],
      },
    ],
  },
  {
    id: 'vertex',
    brand: 'vertexai',
    name: 'Google Vertex',
    description: 'Google Vertex AI — run Claude on GCP infrastructure with service account authentication',
    plans: [
      {
        id: 'gcp',
        name: 'GCP',
        auth: 'gcp',
        endpoints: [
          anthropic('', {
            extraEnv: {
              CLAUDE_CODE_USE_VERTEX: '1',
              CLOUD_ML_REGION: 'global',
              ANTHROPIC_VERTEX_PROJECT_ID: '',
            },
          }),
        ],
      },
    ],
  },

  // Media (image) providers
  {
    id: 'openai',
    brand: 'openai',
    name: 'Platform',
    description: 'OpenAI Developer Platform',
    catalogProviderId: 'openai',
    plans: [
      {
        id: 'api',
        name: 'API',
        auth: 'api-key',
        apiKeyUrl: 'https://platform.openai.com/api-keys',
        endpoints: [
          {
            id: 'openai',
            baseUrl: '',
            protocols: ['openai-responses', 'openai-images', 'openai-audio'],
          },
          {
            id: 'sora',
            baseUrl: '',
            protocols: ['openai-video'],
            models: SORA_MODELS,
          },
        ],
      },
    ],
  },
  {
    id: 'gemini',
    brand: 'gemini',
    name: 'Google Gemini',
    description: 'Google Gemini image generation (Nano Banana) + Veo video generation',
    catalogProviderId: 'google',
    plans: [
      {
        id: 'api',
        name: 'API',
        auth: 'api-key',
        apiKeyUrl: 'https://aistudio.google.com/apikey',
        endpoints: [
          {
            id: 'generative',
            baseUrl: '',
            protocols: ['google-generative'],
          },
          {
            id: 'veo',
            baseUrl: '',
            protocols: ['google-video'],
            models: VEO_MODELS,
          },
        ],
      },
    ],
  },
]
