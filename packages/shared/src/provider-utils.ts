import {
  findChatCapability,
  parseProviderCapabilities,
  parseProviderModelEnv,
  type AgentProviderConfig,
  type ApiProvider,
  type CapabilityProtocol,
  type EffortLevel,
  type ProviderCapability,
  type ProviderModelEnv,
  type RemoteActiveProvider,
} from './agent-types'

export const MEDIA_KIND_TO_CAPABILITY_PROTOCOL: Record<string, CapabilityProtocol> = {
  openai: 'openai-image',
  'openai-compatible': 'openai-compatible-image',
  google: 'google-image',
}

export const IMAGE_PROTOCOL_TO_MEDIA_KIND: Record<string, string> = {
  'openai-image': 'openai',
  'openai-compatible-image': 'openai-compatible',
  'google-image': 'google',
}

/** First enabled image capability of a provider (image caps live only in `capabilities`, never legacy agent_configs). */
export function imageCapabilityFor(provider: Pick<ApiProvider, 'capabilities'>): ProviderCapability | undefined {
  return parseProviderCapabilities(provider.capabilities).find((c) => c.task === 'image' && c.enabled !== false)
}

/** Pure: turn a provider's legacy `agent_configs` JSON into unified chat capabilities (one per harness entry). */
export function agentConfigsToCapabilities(agentConfigsJson: string | undefined): ProviderCapability[] {
  let configs: Record<string, AgentProviderConfig> = {}
  try {
    configs = JSON.parse(agentConfigsJson || '{}') as Record<string, AgentProviderConfig>
  } catch {
    return []
  }
  const capabilities: ProviderCapability[] = []
  for (const [harness, ac] of Object.entries(configs)) {
    if (!ac || typeof ac !== 'object') continue
    const protocol: CapabilityProtocol = ac.api_format === 'openai_chat' ? 'openai-chat' : 'anthropic-messages'
    const modelMapping: ProviderModelEnv = parseProviderModelEnv(ac.model_env)
    let extraEnv: Record<string, string> = {}
    try {
      extraEnv = JSON.parse(ac.extra_env || '{}') as Record<string, string>
    } catch {
      extraEnv = {}
    }
    capabilities.push({
      id: `chat-${harness}`,
      task: 'chat',
      protocol,
      enabled: true,
      baseUrl: ac.base_url || undefined,
      extraEnv: Object.keys(extraEnv).length > 0 ? extraEnv : undefined,
      modelMapping: Object.keys(modelMapping).length > 0 ? modelMapping : undefined,
      harnesses: [harness as 'claude' | 'codex'],
    })
  }
  return capabilities
}

/** Prefer the stored unified capabilities; fall back to deriving them from legacy agent_configs (for not-yet-migrated rows). */
export function effectiveCapabilities(provider: Pick<ApiProvider, 'capabilities' | 'agent_configs'>): ProviderCapability[] {
  const caps = parseProviderCapabilities(provider.capabilities)
  return caps.length > 0 ? caps : agentConfigsToCapabilities(provider.agent_configs)
}

/** Resolve the chat capability that drives a given harness for a provider (capabilities-first, agent_configs fallback). */
export function chatCapabilityFor(
  provider: Pick<ApiProvider, 'capabilities' | 'agent_configs'>,
  harness: 'claude' | 'codex',
): ProviderCapability | undefined {
  return findChatCapability(effectiveCapabilities(provider), harness)
}

export const PRESET_PROVIDER_KEY: Record<string, string> = {
  'default-claude': 'claude',
  'default-codex': 'chatgpt',
  'anthropic-official': 'anthropic',
  'openrouter': 'openrouter',
  'glm-cn': 'zhipu',
  'glm-global': 'zhipu',
  'kimi': 'kimi',
  'minimax-cn': 'minimax',
  'minimax-global': 'minimax',
  'volcengine': 'volcengine',
  'volcengine-api': 'volcengine',
  'bailian': 'bailian',
  'bailian-api': 'bailian',
  'bedrock': 'bedrock',
  'vertex': 'google',
  'deepseek': 'deepseek',
  'doubao-seed': 'doubao',
  'xiaomi-mimo': 'xiaomimimo',
  'xiaomi-token-plan': 'xiaomimimo',
  'longcat': 'longcat',
  'kat-coder': 'kwaikat',
  'modelscope': 'modelscope',
  'siliconflow': 'siliconcloud',
  'nvidia-nim': 'nvidia',
  'codex-official': 'openai',
  'dmxapi': '',
  'packycode': '',
  'custom-api': '',
}

const BRAND_PROVIDER_TYPES = new Set(Object.values(PRESET_PROVIDER_KEY).filter(Boolean))

export function resolveProviderKey(provider: ApiProvider): string | null {
  if (BRAND_PROVIDER_TYPES.has(provider.provider_type)) return provider.provider_type
  const caps = effectiveCapabilities(provider)
  const claudeUrl = (findChatCapability(caps, 'claude')?.baseUrl ?? '').toLowerCase()
  const codexUrl = (findChatCapability(caps, 'codex')?.baseUrl ?? '').toLowerCase()
  const url = claudeUrl || codexUrl
  const name = provider.name.toLowerCase()
  if (url.includes('anthropic.com') || name.includes('anthropic')) return 'anthropic'
  if (url.includes('openrouter') || name.includes('openrouter')) return 'openrouter'
  if (url.includes('bigmodel.cn') || url.includes('z.ai') || name.includes('glm') || name.includes('zhipu')) return 'zhipu'
  if (url.includes('kimi') || name.includes('kimi')) return 'kimi'
  if (url.includes('minimax') || name.includes('minimax')) return 'minimax'
  if (url.includes('volces.com') || url.includes('volcengine') || name.includes('volcengine') || name.includes('ark')) return 'volcengine'
  if (url.includes('dashscope') || url.includes('bailian') || name.includes('bailian')) return 'bailian'
  if (provider.provider_type === 'bedrock' || name.includes('bedrock')) return 'bedrock'
  if (provider.provider_type === 'vertex' || name.includes('vertex')) return 'google'
  if (url.includes('deepseek') || name.includes('deepseek')) return 'deepseek'
  if (url.includes('doubao') || name.includes('doubao')) return 'doubao'
  if (url.includes('xiaomimimo') || name.includes('mimo')) return 'xiaomimimo'
  if (url.includes('longcat') || name.includes('longcat')) return 'longcat'
  if (url.includes('streamlake') || name.includes('kat')) return 'kwaikat'
  if (url.includes('modelscope') || name.includes('modelscope')) return 'modelscope'
  if (url.includes('siliconflow') || name.includes('siliconflow')) return 'siliconcloud'
  if (url.includes('nvidia') || name.includes('nvidia')) return 'nvidia'
  if (url.includes('dmxapi') || name.includes('dmxapi')) return null
  if (url.includes('packy') || name.includes('packy')) return null
  return null
}

function parseForcedEffort(extraEnv: Record<string, string> | undefined): EffortLevel | 'auto' | null {
  const raw = (extraEnv?.CLAUDE_CODE_EFFORT_LEVEL ?? '').toLowerCase().trim()
  if (!raw) return null
  if (raw === 'auto') return 'auto'
  if (raw === 'low' || raw === 'medium' || raw === 'high' || raw === 'xhigh' || raw === 'max') return raw
  return null
}

export function providerSupportsHarness(
  provider: Pick<ApiProvider, 'supported_agents'>,
  harness: 'claude' | 'codex',
): boolean {
  try {
    const supported = JSON.parse(provider.supported_agents || '["claude"]') as string[]
    return Array.isArray(supported) && supported.includes(harness)
  } catch {
    return harness === 'claude'
  }
}

export function buildRemoteActiveProvider(
  provider: ApiProvider | null | undefined,
  harnessId: 'claude' | 'codex' = 'claude',
): RemoteActiveProvider | null {
  if (!provider) return null
  const cap = findChatCapability(effectiveCapabilities(provider), harnessId)
  const modelEnv = cap?.modelMapping ?? {}
  const forcedEffort = harnessId === 'claude' ? parseForcedEffort(cap?.extraEnv) : null
  return {
    id: provider.id,
    name: provider.name,
    presetKey: resolveProviderKey(provider),
    modelEnv,
    forcedEffort,
  }
}
