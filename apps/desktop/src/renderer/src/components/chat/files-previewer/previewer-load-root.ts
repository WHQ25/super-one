import { normalizeHostPath, parseRemoteProjectKey } from '@superone/shared/remote-resource-key'

/**
 * True when `child` is `parent` or a path inside it. Comparison is lexical
 * (`normalizeHostPath`), the same standard the remote file root uses.
 */
function containsHostPath(parent: string, child: string): boolean {
  const host = normalizeHostPath(parent)
  const root = normalizeHostPath(child)
  if (!host || host === '.' || !root || root === '.') return false
  return root === host || root.startsWith(host === '/' ? '/' : `${host}/`)
}

/**
 * Root the card uses to read bytes.
 *
 * A CLI node builds this payload with `remote:<connectionId>:<hostPath>`
 * already. A desktop node runs `widget_show` in its own session, so the stored
 * root is that machine's host path. The controller keeps the stored result and
 * loads through the pane's remote project key — the same key the header file
 * chip opens with. A local pane keeps the payload root, a path on this machine.
 *
 * When the pane has an active worktree on the same connection and the payload
 * root lies under it, that worktree key wins: it is the directory the chip reads.
 */
export function previewerLoadRoot(
  payloadRoot: string,
  sessionProject: string | null | undefined,
  effectiveRoot?: string | null,
): string {
  if (!payloadRoot || parseRemoteProjectKey(payloadRoot)) return payloadRoot
  const session = sessionProject ? parseRemoteProjectKey(sessionProject) : null
  if (!session) return payloadRoot

  const effectiveRemote = effectiveRoot ? parseRemoteProjectKey(effectiveRoot) : null
  const sameConnection = effectiveRemote?.connectionId === session.connectionId ? effectiveRoot! : null
  if (sameConnection && effectiveRemote && containsHostPath(effectiveRemote.path, payloadRoot)) return sameConnection
  if (containsHostPath(session.path, payloadRoot)) return sessionProject!
  return sameConnection ?? sessionProject!
}
