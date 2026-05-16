import type { MiniAppManifest } from '@superone/shared/miniapp-types'

// Single source of truth for "what does the user approve at install".
// Every approvable capability must be reflected here AND given a key — a
// background-only app must not slip through as "no special permissions".
export function hasAnyPermission(manifest: MiniAppManifest | null | undefined): boolean {
  const p = manifest?.permissions
  if (!p) return false
  return (
    (p.fs?.length ?? 0) > 0 ||
    (p.network?.length ?? 0) > 0 ||
    (p.media?.length ?? 0) > 0 ||
    !!p.storage ||
    !!p.background
  )
}

export function permissionApprovalKeys(manifest: MiniAppManifest | null | undefined): string[] {
  const p = manifest?.permissions
  if (!p) return []
  return [
    ...(p.fs ?? []).map((_, i) => `fs:${i}`),
    ...(p.network ?? []).map((e) => `net:${e.domain}`),
    ...(p.media ?? []).map((e) => `media:${e.kind}`),
    ...(p.storage ? ['storage'] : []),
    ...(p.background ? ['background'] : []),
  ]
}
