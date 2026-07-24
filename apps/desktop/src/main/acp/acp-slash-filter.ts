/** Slash commands superseded by SuperOne's ACP permission-mode selector. */
const HIDDEN_ACP_PERMISSION_SLASH = new Set([
  'always-approve',
  'always_approve',
  'alwaysapprove',
])

export function isHiddenAcpPermissionSlashCommand(name: string): boolean {
  const normalized = name.replace(/^\//, '').trim().toLowerCase()
  return HIDDEN_ACP_PERMISSION_SLASH.has(normalized)
}
