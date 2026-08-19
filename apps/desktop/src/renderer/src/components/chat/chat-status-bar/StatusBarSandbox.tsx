import type { ChatProvider } from '@/stores/chat'
import { harnessSupportsSandbox, SandboxModeSelector } from '../SandboxModeSelector'
import { StatusBarDerivedSandbox } from './StatusBarDerivedSandbox'

/**
 * Sandbox chip — shown for every harness. Claude + Cursor get the interactive
 * selector; the rest get read-only state (`StatusBarDerivedSandbox`).
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
  return (
    <>
      {showDivider && <div className="h-3 w-px bg-border" />}
      {harnessSupportsSandbox(activeProvider)
        ? <SandboxModeSelector compact={compactIndicators} />
        : <StatusBarDerivedSandbox activeProvider={activeProvider} compactIndicators={compactIndicators} />}
    </>
  )
}
