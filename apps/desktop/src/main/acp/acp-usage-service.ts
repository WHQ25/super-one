/**
 * Account credits for the ACP usage gauge. Only Grok reports any: its Build
 * credits, read from the Grok CLI login by the shared runtime reader (the same
 * one a node serves), so no agent process has to be running.
 */

import type { ProviderRateLimits } from '@superone/shared/agent-types'
import { isGrokAcpAgent } from '@superone/shared/acp-brand'
import { readGrokRateLimits } from '@superone/runtime/usage'
import { usageLog } from '../agent/usage-log'

export async function getAcpRateLimits(agentId: string, force = false): Promise<ProviderRateLimits | null> {
  if (!isGrokAcpAgent(agentId)) return null
  return (await readGrokRateLimits({ force, log: usageLog })).value
}
