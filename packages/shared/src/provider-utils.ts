import {
  parseProviderModelEnv,
  type AgentProviderConfig,
  type ApiProvider,
  type EffortLevel,
  type RemoteActiveProvider,
} from './agent-types'

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
  'bailian': 'bailian',
  'bedrock': 'bedrock',
  'vertex': 'google',
  'deepseek': 'deepseek',
  'doubao-seed': 'doubao',
  'xiaomi-mimo': 'xiaomimimo',
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

export function resolveProviderKey(provider: ApiProvider): string | null {
  let configs: Record<string, AgentProviderConfig> = {}
  try {
    configs = JSON.parse(provider.agent_configs || '{}') as Record<string, AgentProviderConfig>
  } catch { /* ignore */ }
  const claudeUrl = (configs.claude?.base_url ?? '').toLowerCase()
  const codexUrl = (configs.codex?.base_url ?? '').toLowerCase()
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

function parseForcedEffort(extraEnvJson: string | undefined): EffortLevel | 'auto' | null {
  try {
    const env = JSON.parse(extraEnvJson || '{}') as Record<string, string>
    const raw = (env.CLAUDE_CODE_EFFORT_LEVEL ?? '').toLowerCase().trim()
    if (!raw) return null
    if (raw === 'auto') return 'auto'
    if (raw === 'low' || raw === 'medium' || raw === 'high' || raw === 'xhigh' || raw === 'max') return raw
    return null
  } catch {
    return null
  }
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
  let configs: Record<string, AgentProviderConfig> = {}
  try {
    configs = JSON.parse(provider.agent_configs || '{}') as Record<string, AgentProviderConfig>
  } catch { /* ignore */ }
  const harnessConfig = configs[harnessId]
  const modelEnv = parseProviderModelEnv(harnessConfig?.model_env)
  const forcedEffort = harnessId === 'claude' ? parseForcedEffort(harnessConfig?.extra_env) : null
  return {
    id: provider.id,
    name: provider.name,
    presetKey: resolveProviderKey(provider),
    modelEnv,
    forcedEffort,
  }
}
