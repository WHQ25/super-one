import type { ChatProvider } from '@/stores/chat'
import { CodexPermissionSelector } from '../CodexPermissionSelector'
import { PermissionModeSelector } from '../PermissionModeSelector'

/**
 * Permission selector router. Codex shows its preset-based selector, Claude
 * shows the four-mode mode selector.
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
  return <PermissionModeSelector compact={compactIndicators} />
}
