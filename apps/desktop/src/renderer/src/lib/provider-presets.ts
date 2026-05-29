import type { ProviderModelEnv } from '@superone/shared/agent-types'

export type ProviderCategory = 'model_provider' | 'cloud_platform' | 'aggregator' | 'proxy_service' | 'custom'
export type AgentType = 'claude' | 'codex'

export interface TemplateValueConfig {
  label: string
  placeholder: string
  defaultValue?: string
}

export interface AgentPresetConfig {
  base_url: string
  extra_env: string
  model_env?: ProviderModelEnv
  api_format?: string
}

export interface QuickPreset {
  key: string
  name: string
  description: string
  provider_type: string
  category: ProviderCategory
  supported_agents: AgentType[]
  agent_configs: {
    claude?: AgentPresetConfig
    codex?: AgentPresetConfig
  }
  fields: Array<'name' | 'api_key'>
  templateValues?: Record<string, TemplateValueConfig>
  endpointCandidates?: string[]
}

export const PRESETS: QuickPreset[] = [
  {
    key: 'anthropic-official',
    name: 'Anthropic',
    description: 'Direct access to Claude models via the official Anthropic API',
    provider_type: 'anthropic',
    category: 'model_provider',
    supported_agents: ['claude'],
    agent_configs: {
      claude: { base_url: 'https://api.anthropic.com', extra_env: '{}' },
    },
    fields: ['api_key'],
  },
  {
    key: 'glm-cn',
    name: 'GLM (CN)',
    description: '智谱 GLM 编程套餐 — 中国区，支持 Claude 协议兼容调用',
    provider_type: 'custom',
    category: 'model_provider',
    supported_agents: ['claude'],
    agent_configs: {
      claude: {
        base_url: 'https://open.bigmodel.cn/api/anthropic',
        extra_env: '{"API_TIMEOUT_MS":"3000000","CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC":"1","ANTHROPIC_AUTH_TOKEN":""}',
        model_env: {
          default: { id: 'glm-5-turbo', name: 'GLM-5 Turbo' },
          opus: { id: 'glm-5.1', name: 'GLM-5.1' },
          sonnet: { id: 'glm-5-turbo', name: 'GLM-5 Turbo' },
          haiku: { id: 'glm-4.5-air', name: 'GLM-4.5 Air' },
        },
      },
    },
    fields: ['api_key'],
  },
  {
    key: 'glm-global',
    name: 'GLM (Global)',
    description: 'Zhipu GLM Code Plan — Global endpoint for international users',
    provider_type: 'custom',
    category: 'model_provider',
    supported_agents: ['claude'],
    agent_configs: {
      claude: {
        base_url: 'https://api.z.ai/api/anthropic',
        extra_env: '{"API_TIMEOUT_MS":"3000000","CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC":"1","ANTHROPIC_AUTH_TOKEN":""}',
        model_env: {
          default: { id: 'glm-5-turbo', name: 'GLM-5 Turbo' },
          opus: { id: 'glm-5.1', name: 'GLM-5.1' },
          sonnet: { id: 'glm-5-turbo', name: 'GLM-5 Turbo' },
          haiku: { id: 'glm-4.5-air', name: 'GLM-4.5 Air' },
        },
      },
    },
    fields: ['api_key'],
  },
  {
    key: 'kimi',
    name: 'Kimi',
    description: 'Kimi 编程套餐 — 月之暗面旗下代码智能助手',
    provider_type: 'custom',
    category: 'model_provider',
    supported_agents: ['claude'],
    agent_configs: {
      claude: {
        base_url: 'https://api.kimi.com/coding/',
        extra_env: '{}',
        model_env: {
          default: { id: 'kimi-k2.6', name: 'Kimi K2.6' },
          opus: { id: 'kimi-k2.6', name: 'Kimi K2.6' },
          sonnet: { id: 'kimi-k2.6', name: 'Kimi K2.6' },
          haiku: { id: 'kimi-k2.6', name: 'Kimi K2.6' },
        },
      },
    },
    fields: ['api_key'],
  },
  {
    key: 'minimax-cn',
    name: 'MiniMax (CN)',
    description: 'MiniMax 编程套餐 — 中国区，海螺 AI 代码模型',
    provider_type: 'custom',
    category: 'model_provider',
    supported_agents: ['claude'],
    agent_configs: {
      claude: {
        base_url: 'https://api.minimaxi.com/anthropic',
        extra_env: '{"API_TIMEOUT_MS":"3000000","CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC":"1","ANTHROPIC_AUTH_TOKEN":""}',
        model_env: {
          default: { id: 'MiniMax-M2.7', name: 'MiniMax M2.7' },
          opus: { id: 'MiniMax-M2.7', name: 'MiniMax M2.7' },
          sonnet: { id: 'MiniMax-M2.7', name: 'MiniMax M2.7' },
          haiku: { id: 'MiniMax-M2.7', name: 'MiniMax M2.7' },
        },
      },
    },
    fields: ['api_key'],
  },
  {
    key: 'minimax-global',
    name: 'MiniMax (Global)',
    description: 'MiniMax Code Plan — Global endpoint for international users',
    provider_type: 'custom',
    category: 'model_provider',
    supported_agents: ['claude'],
    agent_configs: {
      claude: {
        base_url: 'https://api.minimax.io/anthropic',
        extra_env: '{"API_TIMEOUT_MS":"3000000","CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC":"1","ANTHROPIC_AUTH_TOKEN":""}',
        model_env: {
          default: { id: 'MiniMax-M2.7', name: 'MiniMax M2.7' },
          opus: { id: 'MiniMax-M2.7', name: 'MiniMax M2.7' },
          sonnet: { id: 'MiniMax-M2.7', name: 'MiniMax M2.7' },
          haiku: { id: 'MiniMax-M2.7', name: 'MiniMax M2.7' },
        },
      },
    },
    fields: ['api_key'],
  },
  {
    key: 'deepseek',
    name: 'DeepSeek',
    description: 'DeepSeek — 深度求索，支持 Claude 协议兼容调用',
    provider_type: 'custom',
    category: 'model_provider',
    supported_agents: ['claude'],
    agent_configs: {
      claude: {
        base_url: 'https://api.deepseek.com/anthropic',
        extra_env: '{"ANTHROPIC_AUTH_TOKEN":"","CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC":"1","CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK":"1","CLAUDE_CODE_EFFORT_LEVEL":"max"}',
        model_env: {
          default: { id: 'deepseek-v4-pro[1m]', name: 'DeepSeek V4 Pro 1M' },
          opus: { id: 'deepseek-v4-pro[1m]', name: 'DeepSeek V4 Pro 1M' },
          sonnet: { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
          haiku: { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
          subagent: { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
        },
      },
    },
    fields: ['api_key'],
  },
  {
    key: 'doubao-seed',
    name: 'DouBaoSeed',
    description: '豆包 Seed — 字节跳动旗下 AI 编程模型',
    provider_type: 'custom',
    category: 'model_provider',
    supported_agents: ['claude'],
    agent_configs: {
      claude: {
        base_url: 'https://ark.cn-beijing.volces.com/api/coding',
        extra_env: '{"API_TIMEOUT_MS":"3000000","ANTHROPIC_AUTH_TOKEN":""}',
        model_env: {
          default: { id: 'doubao-seed-2-0-code-preview-latest', name: 'Doubao Seed 2.0 Code' },
          opus: { id: 'doubao-seed-2-0-code-preview-latest', name: 'Doubao Seed 2.0 Code' },
          sonnet: { id: 'doubao-seed-2-0-code-preview-latest', name: 'Doubao Seed 2.0 Code' },
          haiku: { id: 'doubao-seed-2-0-code-preview-latest', name: 'Doubao Seed 2.0 Code' },
        },
      },
    },
    fields: ['api_key'],
  },
  {
    key: 'xiaomi-mimo',
    name: 'Xiaomi MiMo',
    description: '小米 MiMo — 小米旗下 AI 编程模型',
    provider_type: 'custom',
    category: 'model_provider',
    supported_agents: ['claude'],
    agent_configs: {
      claude: {
        base_url: 'https://api.xiaomimimo.com/anthropic',
        extra_env: '{"ANTHROPIC_AUTH_TOKEN":""}',
        model_env: {
          default: { id: 'mimo-v2.5-pro', name: 'MiMo V2.5 Pro' },
          opus: { id: 'mimo-v2.5-pro', name: 'MiMo V2.5 Pro' },
          sonnet: { id: 'mimo-v2.5-pro', name: 'MiMo V2.5 Pro' },
          haiku: { id: 'mimo-v2.5-pro', name: 'MiMo V2.5 Pro' },
        },
      },
    },
    fields: ['api_key'],
  },
  {
    key: 'longcat',
    name: 'Longcat',
    description: 'Longcat — 长猫 AI 编程助手',
    provider_type: 'custom',
    category: 'model_provider',
    supported_agents: ['claude'],
    agent_configs: {
      claude: {
        base_url: 'https://api.longcat.chat/anthropic',
        extra_env: '{"ANTHROPIC_AUTH_TOKEN":"","CLAUDE_CODE_MAX_OUTPUT_TOKENS":"6000","CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC":"1"}',
        model_env: {
          default: { id: 'LongCat-Flash-Chat', name: 'LongCat Flash Chat' },
          opus: { id: 'LongCat-Flash-Chat', name: 'LongCat Flash Chat' },
          sonnet: { id: 'LongCat-Flash-Chat', name: 'LongCat Flash Chat' },
          haiku: { id: 'LongCat-Flash-Chat', name: 'LongCat Flash Chat' },
        },
      },
    },
    fields: ['api_key'],
  },
  {
    key: 'kat-coder',
    name: 'KAT-Coder',
    description: 'KAT-Coder — 快手旗下 AI 编程模型',
    provider_type: 'custom',
    category: 'model_provider',
    supported_agents: ['claude'],
    agent_configs: {
      claude: {
        base_url: 'https://vanchin.streamlake.ai/api/gateway/v1/endpoints/${ENDPOINT_ID}/claude-code-proxy',
        extra_env: '{"ANTHROPIC_AUTH_TOKEN":""}',
        model_env: {
          default: { id: 'kat-coder-pro-v2', name: 'KAT-Coder Pro V2' },
          opus: { id: 'kat-coder-pro-v2', name: 'KAT-Coder Pro V2' },
          sonnet: { id: 'kat-coder-pro-v2', name: 'KAT-Coder Pro V2' },
          haiku: { id: 'KAT-Coder-Air V1', name: 'KAT-Coder Air V1' },
        },
      },
    },
    fields: ['api_key'],
    templateValues: {
      ENDPOINT_ID: { label: 'Vanchin Endpoint ID', placeholder: 'ep-xxx-xxx' },
    },
  },
  {
    key: 'bedrock',
    name: 'AWS Bedrock',
    description: 'Amazon Bedrock — run Claude on AWS infrastructure with IAM authentication',
    provider_type: 'bedrock',
    category: 'cloud_platform',
    supported_agents: ['claude'],
    agent_configs: {
      claude: {
        base_url: '',
        extra_env: '{"CLAUDE_CODE_USE_BEDROCK":"1","AWS_REGION":"${AWS_REGION}","AWS_ACCESS_KEY_ID":"${AWS_ACCESS_KEY_ID}","AWS_SECRET_ACCESS_KEY":"${AWS_SECRET_ACCESS_KEY}"}',
      },
    },
    fields: [],
    templateValues: {
      AWS_REGION: { label: 'AWS Region', placeholder: 'us-east-1', defaultValue: 'us-east-1' },
      AWS_ACCESS_KEY_ID: { label: 'Access Key ID', placeholder: 'AKIA...' },
      AWS_SECRET_ACCESS_KEY: { label: 'Secret Access Key', placeholder: 'your-secret-key' },
    },
  },
  {
    key: 'vertex',
    name: 'Google Vertex',
    description: 'Google Vertex AI — run Claude on GCP infrastructure with service account authentication',
    provider_type: 'vertex',
    category: 'cloud_platform',
    supported_agents: ['claude'],
    agent_configs: {
      claude: {
        base_url: '',
        extra_env: '{"CLAUDE_CODE_USE_VERTEX":"1","CLOUD_ML_REGION":"global","ANTHROPIC_VERTEX_PROJECT_ID":""}',
      },
    },
    fields: [],
  },
  {
    key: 'openrouter',
    name: 'OpenRouter',
    description: 'Unified API gateway — access Claude and 200+ models through a single key',
    provider_type: 'openrouter',
    category: 'aggregator',
    supported_agents: ['claude', 'codex'],
    agent_configs: {
      claude: {
        base_url: 'https://openrouter.ai/api',
        extra_env: '{}',
      },
      codex: {
        base_url: 'https://openrouter.ai/api/v1',
        extra_env: '{"OPENAI_BASE_URL":"https://openrouter.ai/api/v1"}',
        api_format: 'openai_chat',
      },
    },
    fields: ['api_key'],
  },
  {
    key: 'volcengine',
    name: 'Volcengine Ark',
    description: '火山引擎方舟平台 — 聚合豆包、GLM、DeepSeek、Kimi 等多模型',
    provider_type: 'custom',
    category: 'aggregator',
    supported_agents: ['claude'],
    agent_configs: {
      claude: {
        base_url: 'https://ark.cn-beijing.volces.com/api/coding',
        extra_env: '{"API_TIMEOUT_MS":"3000000","ANTHROPIC_AUTH_TOKEN":""}',
        model_env: {
          default: { id: 'ark-code-latest', name: 'Ark Code Latest' },
          opus: { id: 'ark-code-latest', name: 'Ark Code Latest' },
          sonnet: { id: 'ark-code-latest', name: 'Ark Code Latest' },
          haiku: { id: 'ark-code-latest', name: 'Ark Code Latest' },
        },
      },
    },
    fields: ['api_key'],
  },
  {
    key: 'bailian',
    name: 'Aliyun Bailian',
    description: '阿里云百炼平台 — 聚合通义千问、GLM、Kimi、MiniMax 等多模型',
    provider_type: 'custom',
    category: 'aggregator',
    supported_agents: ['claude'],
    agent_configs: {
      claude: {
        base_url: 'https://coding.dashscope.aliyuncs.com/apps/anthropic',
        extra_env: '{"ANTHROPIC_AUTH_TOKEN":""}',
        model_env: {
          default: { id: 'qwen3.5-plus', name: 'Qwen 3.5 Plus' },
          opus: { id: 'qwen3.5-plus', name: 'Qwen 3.5 Plus' },
          sonnet: { id: 'qwen3.5-plus', name: 'Qwen 3.5 Plus' },
          haiku: { id: 'qwen3-coder-next', name: 'Qwen 3 Coder Next' },
        },
      },
    },
    fields: ['api_key'],
  },
  {
    key: 'modelscope',
    name: 'ModelScope',
    description: 'ModelScope 魔搭 — 阿里巴巴模型聚合平台',
    provider_type: 'custom',
    category: 'aggregator',
    supported_agents: ['claude'],
    agent_configs: {
      claude: {
        base_url: 'https://api-inference.modelscope.cn',
        extra_env: '{"ANTHROPIC_AUTH_TOKEN":""}',
        model_env: {
          default: { id: 'ZhipuAI/GLM-5.1', name: 'GLM-5.1' },
          opus: { id: 'ZhipuAI/GLM-5.1', name: 'GLM-5.1' },
          sonnet: { id: 'ZhipuAI/GLM-5.1', name: 'GLM-5.1' },
          haiku: { id: 'ZhipuAI/GLM-5.1', name: 'GLM-5.1' },
        },
      },
    },
    fields: ['api_key'],
  },
  {
    key: 'siliconflow',
    name: 'SiliconFlow',
    description: 'SiliconFlow 硅基流动 — AI 模型聚合推理平台',
    provider_type: 'custom',
    category: 'aggregator',
    supported_agents: ['claude'],
    agent_configs: {
      claude: {
        base_url: 'https://api.siliconflow.cn',
        extra_env: '{"ANTHROPIC_AUTH_TOKEN":""}',
        model_env: {
          default: { id: 'Pro/MiniMaxAI/MiniMax-M2.7', name: 'MiniMax M2.7' },
          opus: { id: 'Pro/MiniMaxAI/MiniMax-M2.7', name: 'MiniMax M2.7' },
          sonnet: { id: 'Pro/MiniMaxAI/MiniMax-M2.7', name: 'MiniMax M2.7' },
          haiku: { id: 'Pro/MiniMaxAI/MiniMax-M2.7', name: 'MiniMax M2.7' },
        },
      },
    },
    fields: ['api_key'],
  },
  {
    key: 'nvidia-nim',
    name: 'Nvidia NIM',
    description: 'Nvidia NIM — 通过 NVIDIA 推理微服务访问 AI 模型',
    provider_type: 'custom',
    category: 'aggregator',
    supported_agents: ['claude'],
    agent_configs: {
      claude: {
        base_url: 'https://integrate.api.nvidia.com',
        extra_env: '{"ANTHROPIC_AUTH_TOKEN":""}',
        model_env: {
          default: { id: 'moonshotai/kimi-k2.6', name: 'Kimi K2.6' },
          opus: { id: 'moonshotai/kimi-k2.6', name: 'Kimi K2.6' },
          sonnet: { id: 'moonshotai/kimi-k2.6', name: 'Kimi K2.6' },
          haiku: { id: 'moonshotai/kimi-k2.6', name: 'Kimi K2.6' },
        },
        api_format: 'openai_chat',
      },
    },
    fields: ['api_key'],
  },
  {
    key: 'dmxapi',
    name: 'DMXAPI',
    description: 'DMXAPI — AI 模型聚合 API 服务',
    provider_type: 'custom',
    category: 'proxy_service',
    supported_agents: ['claude', 'codex'],
    agent_configs: {
      claude: {
        base_url: 'https://www.dmxapi.cn',
        extra_env: '{"ANTHROPIC_AUTH_TOKEN":""}',
      },
      codex: {
        base_url: 'https://www.dmxapi.cn/v1',
        extra_env: '{"OPENAI_BASE_URL":"https://www.dmxapi.cn/v1"}',
        api_format: 'openai_chat',
      },
    },
    fields: ['api_key'],
    endpointCandidates: ['https://www.dmxapi.cn', 'https://api.dmxapi.cn'],
  },
  {
    key: 'packycode',
    name: 'PackyCode',
    description: 'PackyCode — AI 编程 API 转发服务',
    provider_type: 'custom',
    category: 'proxy_service',
    supported_agents: ['claude', 'codex'],
    agent_configs: {
      claude: {
        base_url: 'https://www.packyapi.com',
        extra_env: '{"ANTHROPIC_AUTH_TOKEN":""}',
      },
      codex: {
        base_url: 'https://www.packyapi.com/v1',
        extra_env: '{"OPENAI_BASE_URL":"https://www.packyapi.com/v1"}',
        api_format: 'openai_chat',
      },
    },
    fields: ['api_key'],
    endpointCandidates: ['https://www.packyapi.com', 'https://api-slb.packyapi.com'],
  },
  {
    key: 'litellm',
    name: 'LiteLLM',
    description: 'LiteLLM proxy — route requests through a local or remote LiteLLM gateway',
    provider_type: 'custom',
    category: 'proxy_service',
    supported_agents: ['claude'],
    agent_configs: {
      claude: { base_url: 'http://localhost:4000', extra_env: '{}' },
    },
    fields: ['api_key'],
  },
  {
    key: 'custom-api',
    name: 'Custom API',
    description: 'Connect any API endpoint with custom base URL and credentials',
    provider_type: 'custom',
    category: 'custom',
    supported_agents: ['claude', 'codex'],
    agent_configs: {
      claude: { base_url: '', extra_env: '{}' },
      codex: { base_url: '', extra_env: '{}', api_format: 'openai_chat' },
    },
    fields: ['name', 'api_key'],
  },
]

export const CATEGORY_LABELS: Record<ProviderCategory, string> = {
  model_provider: 'Model Providers',
  cloud_platform: 'Cloud Platforms',
  aggregator: 'Aggregators',
  proxy_service: 'Proxy Services',
  custom: 'Custom',
}

export const CATEGORY_ORDER: ProviderCategory[] = [
  'model_provider', 'cloud_platform', 'aggregator', 'proxy_service', 'custom',
]

export function getPresetsByCategory(presets: QuickPreset[]): Map<ProviderCategory, QuickPreset[]> {
  const map = new Map<ProviderCategory, QuickPreset[]>()
  for (const cat of CATEGORY_ORDER) {
    const items = presets.filter((p) => p.category === cat)
    if (items.length > 0) map.set(cat, items)
  }
  return map
}

export function resolveTemplateValues(template: string, values: Record<string, string>): string {
  return template.replace(/\$\{(\w+)\}/g, (_, key) => values[key] ?? '')
}
