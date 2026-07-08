import type { ApiProvider } from '@superone/shared/agent-types'
import { expandProviderModelEnv, findChatCapability, parseProviderCapabilities } from '@superone/shared/agent-types'
import { agentConfigsToCapabilities } from '@superone/shared/provider-utils'

export function buildProviderEnv(provider: ApiProvider, agentType: string = 'claude'): Record<string, string> {
  const caps = parseProviderCapabilities(provider.capabilities)
  const effective = caps.length > 0 ? caps : agentConfigsToCapabilities(provider.agent_configs)
  const cap = findChatCapability(effective, agentType === 'codex' ? 'codex' : 'claude')
  if (!cap) return {}

  const env: Record<string, string> = { ...(cap.extraEnv ?? {}), ...expandProviderModelEnv(cap.modelMapping ?? {}) }

  if (provider.api_key) {
    env.ANTHROPIC_API_KEY = provider.api_key
    if ('ANTHROPIC_AUTH_TOKEN' in env) {
      env.ANTHROPIC_AUTH_TOKEN = provider.api_key
    }
  }
  if (cap.baseUrl) env.ANTHROPIC_BASE_URL = cap.baseUrl
  return env
}
