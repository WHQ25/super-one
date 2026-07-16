import type { ChatProvider } from '@/stores/chat'
import { SandboxModeSelector } from '../SandboxModeSelector'

/**
 * Sandbox-mode chip. Claude only — Codex covers this via permission presets;
 * ACP has no sandbox protocol surface.
 */
export function StatusBarSandbox({
  activeProvider,
  compactIndicators,
  showDivider,
}: {
  activeProvider: ChatProvider
  compactIndicators: boolean
  showDivider: boolean
}) {
  if (activeProvider === 'codex' || activeProvider === 'acp') return null
  return (
    <>
      {showDivider && <div className="h-3 w-px bg-border" />}
      <SandboxModeSelector compact={compactIndicators} />
    </>
  )
}
