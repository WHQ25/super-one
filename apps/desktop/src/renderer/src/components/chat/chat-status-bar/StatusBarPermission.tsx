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
    // Permission baseline (ask / auto / bypass) + agent session modes (effort etc.).
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
