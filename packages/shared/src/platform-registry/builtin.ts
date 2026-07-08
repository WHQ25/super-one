import type { ProviderModelEnv } from '../agent-types'
import type { Platform, ServiceEndpoint } from './types'

// --- endpoint helpers ---------------------------------------------------------

function anthropic(
  baseUrl: string,
  opts: { extraEnv?: Record<string, string>; modelMapping?: ProviderModelEnv; id?: string } = {},
): ServiceEndpoint {
  const defaults =
    opts.extraEnv || opts.modelMapping ? { extraEnv: opts.extraEnv, modelMapping: opts.modelMapping } : undefined
  return { id: opts.id ?? 'anthropic', protocol: 'anthropic-messages', baseUrl, defaults }
}

function openaiChat(baseUrl: string, extraEnv?: Record<string, string>, id = 'openai'): ServiceEndpoint {
  return { id, protocol: 'openai-chat', baseUrl, defaults: extraEnv ? { extraEnv } : undefined }
}

// --- shared model mappings ----------------------------------------------------

const XIAOMI_MODELS: ProviderModelEnv = {
  default: { id: 'mimo-v2.5-pro', name: 'MiMo V2.5 Pro' },
  opus: { id: 'mimo-v2.5-pro', name: 'MiMo V2.5 Pro' },
  sonnet: { id: 'mimo-v2.5-pro', name: 'MiMo V2.5 Pro' },
  haiku: { id: 'mimo-v2.5-pro', name: 'MiMo V2.5 Pro' },
}

const BAILIAN_MODELS: ProviderModelEnv = {
  default: { id: 'qwen3.5-plus', name: 'Qwen 3.5 Plus' },
  opus: { id: 'qwen3.5-plus', name: 'Qwen 3.5 Plus' },
  sonnet: { id: 'qwen3.5-plus', name: 'Qwen 3.5 Plus' },
  haiku: { id: 'qwen3-coder-next', name: 'Qwen 3 Coder Next' },
}

const GLM_MODELS: ProviderModelEnv = {
  default: { id: 'glm-5.2[1m]', name: 'GLM-5.2 (1M)' },
  opus: { id: 'glm-5.2[1m]', name: 'GLM-5.2 (1M)' },
  sonnet: { id: 'glm-5.2[1m]', name: 'GLM-5.2 (1M)' },
  haiku: { id: 'glm-4.5-air', name: 'GLM-4.5 Air' },
}

const MINIMAX_MODELS: ProviderModelEnv = {
  default: { id: 'MiniMax-M2.7', name: 'MiniMax M2.7' },
  opus: { id: 'MiniMax-M2.7', name: 'MiniMax M2.7' },
  sonnet: { id: 'MiniMax-M2.7', name: 'MiniMax M2.7' },
  haiku: { id: 'MiniMax-M2.7', name: 'MiniMax M2.7' },
}

const DOUBAO_MODELS: ProviderModelEnv = {
  default: { id: 'doubao-seed-2-0-code-preview-latest', name: 'Doubao Seed 2.0 Code' },
  opus: { id: 'doubao-seed-2-0-code-preview-latest', name: 'Doubao Seed 2.0 Code' },
  sonnet: { id: 'doubao-seed-2-0-code-preview-latest', name: 'Doubao Seed 2.0 Code' },
  haiku: { id: 'doubao-seed-2-0-code-preview-latest', name: 'Doubao Seed 2.0 Code' },
}

const CODING_TIMEOUT = { API_TIMEOUT_MS: '3000000' }
const DISABLE_NONESSENTIAL = { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' }
const EMPTY_AUTH_TOKEN = { ANTHROPIC_AUTH_TOKEN: '' }

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
        endpoints: [{ id: 'responses', protocol: 'openai-responses', baseUrl: '' }],
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
        ],
      },
    ],
  },
  {
    id: 'kimi',
    brand: 'kimi',
    name: 'Kimi',
    description: 'Kimi 编程套餐 — 月之暗面旗下代码智能助手',
    catalogProviderId: 'moonshotai',
    plans: [
      {
        id: 'coding',
        name: 'Coding Plan',
        auth: 'api-key',
        apiKeyUrl: 'https://www.kimi.com/code/console',
        endpoints: [
          anthropic('https://api.kimi.com/coding/', {
            modelMapping: {
              default: { id: 'kimi-k2.6', name: 'Kimi K2.6' },
              opus: { id: 'kimi-k2.6', name: 'Kimi K2.6' },
              sonnet: { id: 'kimi-k2.6', name: 'Kimi K2.6' },
              haiku: { id: 'kimi-k2.6', name: 'Kimi K2.6' },
            },
          }),
        ],
      },
    ],
  },
  {
    id: 'minimax-cn',
    brand: 'minimax',
    name: 'MiniMax (CN)',
    description: 'MiniMax 编程套餐 — 中国区，海螺 AI 代码模型',
    plans: [
      {
        id: 'coding',
        name: 'Coding Plan',
        auth: 'api-key',
        apiKeyUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
        endpoints: [
          anthropic('https://api.minimaxi.com/anthropic', {
            extraEnv: { ...CODING_TIMEOUT, ...DISABLE_NONESSENTIAL, ...EMPTY_AUTH_TOKEN },
            modelMapping: MINIMAX_MODELS,
          }),
        ],
      },
    ],
  },
  {
    id: 'minimax-global',
    brand: 'minimax',
    name: 'MiniMax (Global)',
    description: 'MiniMax Code Plan — Global endpoint for international users',
    plans: [
      {
        id: 'coding',
        name: 'Coding Plan',
        auth: 'api-key',
        apiKeyUrl: 'https://platform.minimax.io/user-center/basic-information/interface-key',
        endpoints: [
          anthropic('https://api.minimax.io/anthropic', {
            extraEnv: { ...CODING_TIMEOUT, ...DISABLE_NONESSENTIAL, ...EMPTY_AUTH_TOKEN },
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
    plans: [
      {
        id: 'coding',
        name: 'Coding Plan',
        auth: 'api-key',
        apiKeyUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey',
        endpoints: [
          anthropic('https://ark.cn-beijing.volces.com/api/coding', {
            extraEnv: { ...CODING_TIMEOUT, ...EMPTY_AUTH_TOKEN },
            modelMapping: {
              default: { id: 'ark-code-latest', name: 'Ark Code Latest' },
              opus: { id: 'ark-code-latest', name: 'Ark Code Latest' },
              sonnet: { id: 'ark-code-latest', name: 'Ark Code Latest' },
              haiku: { id: 'ark-code-latest', name: 'Ark Code Latest' },
            },
          }),
        ],
      },
      {
        id: 'api',
        name: 'API',
        auth: 'api-key',
        apiKeyUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey',
        endpoints: [
          anthropic('https://ark.cn-beijing.volces.com/api/compatible', {
            extraEnv: { ...CODING_TIMEOUT, ...EMPTY_AUTH_TOKEN },
            modelMapping: DOUBAO_MODELS,
          }),
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
            modelMapping: BAILIAN_MODELS,
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
            modelMapping: BAILIAN_MODELS,
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
            modelMapping: BAILIAN_MODELS,
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
          anthropic('https://api.deepseek.com/anthropic', {
            extraEnv: {
              ...EMPTY_AUTH_TOKEN,
              ...DISABLE_NONESSENTIAL,
              CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK: '1',
              CLAUDE_CODE_EFFORT_LEVEL: 'max',
            },
            modelMapping: {
              default: { id: 'deepseek-v4-pro[1m]', name: 'DeepSeek V4 Pro 1M' },
              opus: { id: 'deepseek-v4-pro[1m]', name: 'DeepSeek V4 Pro 1M' },
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
          openaiChat('https://openrouter.ai/api/v1', { OPENAI_BASE_URL: 'https://openrouter.ai/api/v1' }),
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
    plans: [
      {
        id: 'api',
        name: 'API',
        auth: 'api-key',
        apiKeyUrl: 'https://build.nvidia.com/settings/api-keys',
        endpoints: [
          anthropic('https://integrate.api.nvidia.com', {
            extraEnv: { ...EMPTY_AUTH_TOKEN },
            modelMapping: {
              default: { id: 'moonshotai/kimi-k2.6', name: 'Kimi K2.6' },
              opus: { id: 'moonshotai/kimi-k2.6', name: 'Kimi K2.6' },
              sonnet: { id: 'moonshotai/kimi-k2.6', name: 'Kimi K2.6' },
              haiku: { id: 'moonshotai/kimi-k2.6', name: 'Kimi K2.6' },
            },
          }),
        ],
      },
    ],
  },

  // Cloud platforms (IAM / service-account auth, no api key)
  {
    id: 'bedrock',
    brand: 'bedrock',
    name: 'AWS Bedrock',
    description: 'Amazon Bedrock — run Claude on AWS infrastructure with IAM authentication',
    plans: [
      {
        id: 'aws',
        name: 'AWS',
        auth: 'aws',
        endpoints: [
          anthropic('', {
            extraEnv: {
              CLAUDE_CODE_USE_BEDROCK: '1',
              AWS_REGION: '${AWS_REGION}',
              AWS_ACCESS_KEY_ID: '${AWS_ACCESS_KEY_ID}',
              AWS_SECRET_ACCESS_KEY: '${AWS_SECRET_ACCESS_KEY}',
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
    name: 'OpenAI',
    description: 'OpenAI image generation (GPT Image)',
    catalogProviderId: 'openai',
    plans: [
      {
        id: 'api',
        name: 'API',
        auth: 'api-key',
        apiKeyUrl: 'https://platform.openai.com/api-keys',
        endpoints: [
          {
            id: 'images',
            protocol: 'openai-images',
            baseUrl: '',
            tasks: ['image'],
            models: [{ id: 'gpt-image-2', name: 'GPT Image 2', tasks: ['image'] }],
          },
        ],
      },
    ],
  },
  {
    id: 'gemini',
    brand: 'gemini',
    name: 'Google Gemini',
    description: 'Google Gemini image generation (Nano Banana)',
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
            protocol: 'google-generative',
            baseUrl: '',
            tasks: ['image'],
            models: [
              { id: 'gemini-3.1-flash-lite-image', name: 'Nano Banana 2 Lite' },
              { id: 'gemini-3.1-flash-image', name: 'Nano Banana 2' },
              { id: 'gemini-3-pro-image', name: 'Nano Banana Pro' },
            ],
          },
        ],
      },
    ],
  },
]
