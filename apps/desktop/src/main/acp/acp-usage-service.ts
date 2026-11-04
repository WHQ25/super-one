import type { ProviderRateLimits } from '@superone/shared/agent-types'
import { isAntigravityAcpAgent, isGrokAcpAgent } from '@superone/shared/acp-brand'
import { readGrokRateLimits } from '@superone/runtime/usage'
import { usageLog } from '../agent/usage-log'
import { readAntigravityRateLimits } from './antigravity-usage'

export async function getAcpRateLimits(agentId: string, force = false): Promise<ProviderRateLimits | null> {
  if (isGrokAcpAgent(agentId)) {
    return (await readGrokRateLimits({ force, log: usageLog })).value
  }
  if (isAntigravityAcpAgent(agentId)) {
    return readAntigravityRateLimits(force)
  }
  return null
}
