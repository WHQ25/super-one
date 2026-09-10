import { isGrokAcpAgent } from '@superone/shared/acp-brand'
import type { HarnessId } from '@superone/shared/agent-types'

/** Exact `/recap` after trim — the desktop send interceptor's same gate. */
export function isManualRecapCommand(text: string): boolean {
  return /^\/recap$/.test(text.trim())
}

/** Host-only Grok ACP command; other ACP agents send `/recap` as a prompt. */
export function shouldInterceptGrokRecap(
  provider: HarnessId | string | undefined,
  acpAgentId: string | null | undefined,
): boolean {
  return provider === 'acp' && isGrokAcpAgent(acpAgentId)
}
