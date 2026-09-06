import type { HarnessId } from '@superone/shared/agent-types'
import data from './permission-modes.generated.json'

export type PermissionPresentation = { id: string; label: string; description: string; icon: string; triggerIcon: string; light: string; dark: string }
export function permissionPresentation(harness: HarnessId, mode: string): PermissionPresentation {
  const id = harness === 'codex'
    ? mode === 'auto' ? 'auto-review' : mode === 'bypassPermissions' || mode === 'acceptEdits' ? 'full-access' : mode
    : harness === 'cursor' && mode === 'auto' ? 'agent' : mode
  const catalog: PermissionPresentation[] = data[harness]
  return catalog.find((entry) => entry.id === id) ?? {
    id, label: mode, description: 'Permission mode provided by the connected agent.', icon: 'Shield', triggerIcon: 'Shield', light: '$mutedForeground', dark: '$mutedForeground',
  }
}

export function permissionModeLabel(mode: string, harness: HarnessId = 'claude'): string {
  return permissionPresentation(harness, mode).label
}

export function orderedPermissionModes(harness: HarnessId, available: string[]): string[] {
  const catalog: PermissionPresentation[] = data[harness]
  const order = (mode: string) => {
    const index = catalog.findIndex((item) => item.id === permissionPresentation(harness, mode).id)
    return index === -1 ? catalog.length : index
  }
  return [...new Set(available)].sort((a, b) => order(a) - order(b))
}
