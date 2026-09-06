import type { ComponentType } from 'react'
import type { HarnessId } from '@superone/shared/agent-types'
import { isGrokAcpAgent, isOpenCodeAcpAgent } from '@superone/shared/acp-brand'
import { AcpSessionIcon } from './AcpSessionIcon'
import { ClaudeSessionIcon } from './ClaudeSessionIcon'
import { CodexSessionIcon } from './CodexSessionIcon'
import type { SessionIconProps } from './ClaudeSessionIcon'
import { GrokSessionIcon } from './GrokSessionIcon'
import { OpenCodeSessionIcon } from './OpenCodeSessionIcon'
import { CursorSessionIcon } from './CursorSessionIcon'
import { DeepseekSessionIcon } from './DeepseekSessionIcon'
import { withSessionIconGround } from './SessionIconGround'

export type { SessionIconProps }

/* Every mark resolved here is brand-coloured, and in light mode a selected row is
   filled with that same brand hue — so they all get the same dark ground under
   them (see `.session-icon-ground`). Grounding once at the resolve seam is what
   keeps the four call sites (sidebar rows, pinned rows, session switcher, chat
   banners) from each having to remember. */
const Claude = withSessionIconGround(ClaudeSessionIcon)
const Codex = withSessionIconGround(CodexSessionIcon)
const OpenCode = withSessionIconGround(OpenCodeSessionIcon)
const Cursor = withSessionIconGround(CursorSessionIcon)
const Deepseek = withSessionIconGround(DeepseekSessionIcon)
const Grok = withSessionIconGround(GrokSessionIcon)
const Acp = withSessionIconGround(AcpSessionIcon)

/** Pick the sidebar/session brand icon for a harness (+ ACP agent). */
export function resolveSessionIcon(
  harnessId: HarnessId | string | null | undefined,
  acpAgentId?: string | null,
): ComponentType<SessionIconProps> | null {
  if (harnessId === 'claude') return Claude
  if (harnessId === 'codex') return Codex
  if (harnessId === 'opencode') return OpenCode
  if (harnessId === 'cursor') return Cursor
  if (harnessId === 'dsh') return Deepseek
  if (harnessId === 'acp') {
    if (isGrokAcpAgent(acpAgentId)) return Grok
    if (isOpenCodeAcpAgent(acpAgentId)) return OpenCode
    return Acp
  }
  return null
}

/** Resolve icon from profile brandKey (`claude`, `codex`, `acp-grok`, `acp`, …). */
export function resolveSessionIconFromBrandKey(
  brandKey: string | null | undefined,
): ComponentType<SessionIconProps> | null {
  if (!brandKey) return null
  if (brandKey === 'claude') return Claude
  if (brandKey === 'codex') return Codex
  if (brandKey === 'opencode' || brandKey === 'acp-opencode') return OpenCode
  if (brandKey === 'cursor') return Cursor
  // `dsh` is what resolveHarnessBrandKey actually emits (brandKey defaults to the
  // harness id for everything non-ACP); `deepseek` is kept as a display alias.
  if (brandKey === 'dsh' || brandKey === 'deepseek') return Deepseek
  if (brandKey === 'acp-grok' || brandKey.includes('grok')) return Grok
  if (brandKey === 'acp' || brandKey.startsWith('acp')) return Acp
  return null
}
