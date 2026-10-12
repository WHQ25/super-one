import type { ChatProvider } from '@/stores/chat'
import { HARNESS_CONTROLS } from '@/harness-ui/controls'

export function StatusBarPermission({
  activeProvider,
  compactIndicators,
}: {
  activeProvider: ChatProvider
  compactIndicators: boolean
}) {
  const { PermissionControl } = HARNESS_CONTROLS[activeProvider]
  return <PermissionControl compact={compactIndicators} />
}
