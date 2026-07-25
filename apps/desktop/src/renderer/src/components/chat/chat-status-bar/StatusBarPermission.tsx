import type { ChatProvider } from '@/stores/chat'
import { AcpModeSelector } from '../AcpModeSelector'
import { AcpPermissionSelector } from '../AcpPermissionSelector'
import { CodexPermissionSelector } from '../CodexPermissionSelector'
import { OpenCodePermissionSelector } from '../OpenCodePermissionSelector'
import { PermissionModeSelector } from '../PermissionModeSelector'

export function StatusBarPermission({
  activeProvider,
  compactIndicators,
}: {
  activeProvider: ChatProvider
  compactIndicators: boolean
}) {
  if (activeProvider === 'codex') {
    return <CodexPermissionSelector compact={compactIndicators} />
  }
  if (activeProvider === 'acp') {
    // Permission baseline (ask / plan / auto / always).
    // True ACP session modes (configId set) live here; Grok effort is on the model selector.
    return (
      <>
        <AcpPermissionSelector compact={compactIndicators} />
        <AcpModeSelector compact={compactIndicators} />
      </>
    )
  }
  if (activeProvider === 'opencode') {
    return <OpenCodePermissionSelector compact={compactIndicators} />
  }
  return <PermissionModeSelector compact={compactIndicators} />
}
