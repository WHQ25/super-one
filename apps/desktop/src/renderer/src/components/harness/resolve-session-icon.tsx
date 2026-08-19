import type { ComponentType } from 'react'
import type { HarnessId } from '@superone/shared/agent-types'
import { isGrokAcpAgent, isOpenCodeAcpAgent } from '@superone/shared/acp-brand'
import { AcpSessionIcon } from '@superone/ui/components/harness/AcpSessionIcon'
import { ClaudeSessionIcon } from '@superone/ui/components/harness/ClaudeSessionIcon'
import { CodexSessionIcon } from '@superone/ui/components/harness/CodexSessionIcon'
import type { SessionIconProps } from '@superone/ui/components/harness/ClaudeSessionIcon'
import { GrokSessionIcon } from '@superone/ui/components/harness/GrokSessionIcon'
import { OpenCodeSessionIcon } from '@superone/ui/components/harness/OpenCodeSessionIcon'
import { CursorSessionIcon } from '@superone/ui/components/harness/CursorSessionIcon'
import { DeepseekSessionIcon } from '@superone/ui/components/harness/DeepseekSessionIcon'

export type { SessionIconProps }

/** Pick the sidebar/session brand icon for a harness (+ ACP agent). */
export function resolveSessionIcon(
  harnessId: HarnessId | string | null | undefined,
  acpAgentId?: string | null,
): ComponentType<SessionIconProps> | null {
  if (harnessId === 'claude') return ClaudeSessionIcon
  if (harnessId === 'codex') return CodexSessionIcon
  if (harnessId === 'opencode') return OpenCodeSessionIcon
  if (harnessId === 'cursor') return CursorSessionIcon
  if (harnessId === 'dsh') return DeepseekSessionIcon
  if (harnessId === 'acp') {
    if (isGrokAcpAgent(acpAgentId)) return GrokSessionIcon
    if (isOpenCodeAcpAgent(acpAgentId)) return OpenCodeSessionIcon
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
  if (brandKey === 'opencode' || brandKey === 'acp-opencode') return OpenCodeSessionIcon
  if (brandKey === 'cursor') return CursorSessionIcon
  // `dsh` is what resolveHarnessBrandKey actually emits (brandKey defaults to the
  // harness id for everything non-ACP); `deepseek` is kept as a display alias.
  if (brandKey === 'dsh' || brandKey === 'deepseek') return DeepseekSessionIcon
  if (brandKey === 'acp-grok' || brandKey.includes('grok')) return GrokSessionIcon
  if (brandKey === 'acp' || brandKey.startsWith('acp')) return AcpSessionIcon
  return null
}
