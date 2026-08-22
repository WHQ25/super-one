import type { MiniAppManifest } from '@superone/shared/miniapp-types'

// Single source of truth for "what does the user approve at install".
// Every approvable capability must be reflected here AND given a key — a
// background-only app must not slip through as "no special permissions".
export function hasAnyPermission(manifest: MiniAppManifest | null | undefined): boolean {
  // Every app executes trusted Node.js code in a MiniApp Host, so installation
  // always requires an explicit trust decision even without declarative APIs.
  return !!manifest
}

export function permissionApprovalKeys(manifest: MiniAppManifest | null | undefined): string[] {
  if (!manifest) return []
  const p = manifest?.permissions
  return [
    'miniapp-host',
    ...(p?.network ?? []).map((e) => `net:${e.domain}`),
    ...(p?.media ?? []).map((e) => `media:${e.kind}`),
  ]
}
