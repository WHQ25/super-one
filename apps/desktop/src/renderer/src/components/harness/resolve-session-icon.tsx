import type { ComponentType } from 'react'
import type { HarnessId } from '@superone/shared/agent-types'
import { isGrokAcpAgent } from '@superone/shared/acp-brand'
import { AcpSessionIcon } from '@superone/ui/components/harness/AcpSessionIcon'
import { ClaudeSessionIcon } from '@superone/ui/components/harness/ClaudeSessionIcon'
import { CodexSessionIcon } from '@superone/ui/components/harness/CodexSessionIcon'
import type { SessionIconProps } from '@superone/ui/components/harness/ClaudeSessionIcon'
import { GrokSessionIcon } from '@superone/ui/components/harness/GrokSessionIcon'

export type { SessionIconProps }

/** Pick the sidebar/session brand icon for a harness (+ ACP agent). */
export function resolveSessionIcon(
  harnessId: HarnessId | string | null | undefined,
  acpAgentId?: string | null,
): ComponentType<SessionIconProps> | null {
  if (harnessId === 'claude') return ClaudeSessionIcon
  if (harnessId === 'codex') return CodexSessionIcon
  if (harnessId === 'acp' || harnessId === 'opencode') {
    if (isGrokAcpAgent(acpAgentId)) return GrokSessionIcon
    return AcpSessionIcon
  }
  return null
}

/** Resolve icon from profile brandKey (`claude`, `codex`, `acp-grok`, `acp`, …). */
export function resolveSessionIconFromBrandKey(
  brandKey: string | null | undefined,
): ComponentType<SessionIconProps> | null {
  if (!brandKey) return null
  if (brandKey === 'claude') return ClaudeSessionIcon
  if (brandKey === 'codex') return CodexSessionIcon
  if (brandKey === 'acp-grok' || brandKey.includes('grok')) return GrokSessionIcon
  if (brandKey === 'opencode' || brandKey === 'acp' || brandKey.startsWith('acp')) return AcpSessionIcon
  return null
}
