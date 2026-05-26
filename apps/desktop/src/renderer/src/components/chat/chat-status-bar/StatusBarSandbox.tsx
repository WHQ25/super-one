import type { ChatProvider } from '@/stores/chat'
import { SandboxModeSelector } from '../SandboxModeSelector'

/**
 * Sandbox-mode chip. Claude only — Codex does not expose a sandbox mode
 * (its permission preset already covers that axis).
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
  if (activeProvider === 'codex') return null
  return (
    <>
      {showDivider && <div className="h-3 w-px bg-border" />}
      <SandboxModeSelector compact={compactIndicators} />
    </>
  )
}
