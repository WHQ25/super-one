import type { ApiProvider } from '../../shared/agent-types'
import { expandProviderModelEnv, parseProviderModelEnv } from '../../shared/agent-types'

export function buildProviderEnv(provider: ApiProvider, agentType: string = 'claude'): Record<string, string> {
  const configs = JSON.parse(provider.agent_configs || '{}')
  const ac = configs[agentType]
  if (!ac) return {}

  const extraEnv = JSON.parse(ac.extra_env || '{}') as Record<string, string>
  const modelEnv = parseProviderModelEnv(ac.model_env)
  const env: Record<string, string> = { ...extraEnv, ...expandProviderModelEnv(modelEnv) }

  if (provider.api_key) {
    env.ANTHROPIC_API_KEY = provider.api_key
    if ('ANTHROPIC_AUTH_TOKEN' in env) {
      env.ANTHROPIC_AUTH_TOKEN = provider.api_key
    }
  }
  if (ac.base_url) env.ANTHROPIC_BASE_URL = ac.base_url
  return env
}
