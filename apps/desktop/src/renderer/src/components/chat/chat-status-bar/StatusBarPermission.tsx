import type { ChatProvider } from '@/stores/chat'
import { AcpModeSelector } from '../AcpModeSelector'
import { CodexPermissionSelector } from '../CodexPermissionSelector'
import { PermissionModeSelector } from '../PermissionModeSelector'

/**
 * Permission / session-mode selector router.
 * - Codex: permission presets
 * - ACP: agent-declared configOptions category=mode (hidden when agent has none)
 * - Claude: permission modes
 */
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
    return <AcpModeSelector compact={compactIndicators} />
  }
  return <PermissionModeSelector compact={compactIndicators} />
}
