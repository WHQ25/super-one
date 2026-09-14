/**
 * Build the `@native/files-previewer` context for a remote-node session
 * (`docs/design/inline-files-previewer.md` §2.2).
 *
 * The claim carries only `sessionId` + `turnId`, and the local SessionManager
 * has no entry for a node session, so the live `cwd` and the project host path
 * come from the node over RPC. `root` is the `remote:<connectionId>:<hostPath>`
 * key the renderer already understands; every file is resolved by
 * `resolveRemotePreviewerFile` where it actually lives.
 *
 * The card's Retry comes back with only that `root` and the file's absolute
 * path (`statPreviewerFileForRoot`): the same resolver, with the project root
 * standing in for the live cwd — which is fine, because an absolute path
 * never consults it.
 */
import { remoteProjectKey, parseRemoteProjectKey } from '@superone/shared/remote-resource-key'
import type { PreviewerFile } from '@superone/shared/generative-ui/native-widgets'
import type { WorkspaceEntry } from '@superone/shared/environment'
import type { PreviewerBuildContext } from '../generative-ui/files-previewer-payload'
import { resolveRemotePreviewerFile, type RemotePreviewerContext } from './files-previewer-remote'
import type { EnvironmentOs } from '@superone/shared/environment'

interface NodeSessionView {
  cwd?: string
  projectId?: string
}

/** The slice of `EnvironmentHost` the previewer needs; tests hand in a fake. */
export interface PreviewerHost {
  getSession(connectionId: string, sessionId: string): Promise<unknown>
  getRemoteProjectPath(connectionId: string, projectId: string): Promise<string | null>
  getSyncZone(connectionId: string): { syncRoot: string; os: EnvironmentOs } | null
  artifactStat(connectionId: string, sessionId: string, relativePath: string): Promise<{ exists: boolean; size: number; mtimeMs: number }>
  artifactGet(connectionId: string, input: { sessionId: string; relativePath: string; offset: number; maxBytes: number }): Promise<{ chunk: string; total: number; mtimeMs: number; eof: boolean }>
  remoteWorkspaceListDir(connectionId: string, projectId: string, relativeDir: string): Promise<WorkspaceEntry[]>
}

function remoteContext(
  host: PreviewerHost,
  input: { connectionId: string; hostPath: string; cwd: string; projectId: string | undefined },
): RemotePreviewerContext {
  const { connectionId, projectId } = input
  return {
    connectionId,
    hostPath: input.hostPath,
    cwd: input.cwd,
    zone: host.getSyncZone(connectionId),
    artifactStat: (sid, rel) => host.artifactStat(connectionId, sid, rel),
    artifactGet: (input) => host.artifactGet(connectionId, input),
    listDir: (relativeDir) => (projectId ? host.remoteWorkspaceListDir(connectionId, projectId, relativeDir) : Promise.resolve([])),
  }
}

export async function resolveRemotePreviewerContext(
  connectionId: string,
  sessionId: string,
  host?: PreviewerHost,
): Promise<PreviewerBuildContext | undefined> {
  const resolvedHost = host ?? (await import('./environment-host')).getEnvironmentHost()
  let session: NodeSessionView | null = null
  try {
    session = (await resolvedHost.getSession(connectionId, sessionId)) as NodeSessionView | null
  } catch {
    return undefined
  }
  if (!session) return undefined

  // Project host path: from the session's project, or its cwd as a fallback
  // (a bare-worktree session may not resolve a project).
  let hostPath = session.cwd ?? ''
  if (session.projectId) {
    try {
      const projectPath = await resolvedHost.getRemoteProjectPath(connectionId, session.projectId)
      if (projectPath) hostPath = projectPath
    } catch {
      /* keep cwd */
    }
  }
  if (!hostPath) return undefined
  const cwd = session.cwd && session.cwd.trim() ? session.cwd : hostPath
  const remoteCtx = remoteContext(resolvedHost, { connectionId, hostPath, cwd, projectId: session.projectId })
  return {
    root: remoteProjectKey(connectionId, hostPath),
    resolveOne: (entry) => resolveRemotePreviewerFile(entry, remoteCtx),
  }
}

/**
 * Re-stat one previewer file for the card's Retry. `root` is the payload's
 * `remote:` key and `absolutePath` the node path the builder reported; the
 * project is looked up by host path (never registered as a side effect).
 * Returns undefined for a local root so the caller takes the local path.
 */
export async function statPreviewerFileForRoot(
  root: string,
  absolutePath: string,
  deps?: { host: PreviewerHost; projectIdFor: (root: string) => Promise<string | undefined> },
): Promise<PreviewerFile | undefined> {
  const remote = parseRemoteProjectKey(root)
  if (!remote) return undefined
  const host = deps?.host ?? (await import('./environment-host')).getEnvironmentHost()
  const projectId = deps
    ? await deps.projectIdFor(root)
    : await (async () => {
        const { resolveRemoteProjectContext } = await import('./remote-file-tree')
        const ctx = await resolveRemoteProjectContext(host as never, root, { registerIfMissing: false })
        return ctx?.projectId
      })()
  const remoteCtx = remoteContext(host, { connectionId: remote.connectionId, hostPath: remote.path, cwd: remote.path, projectId })
  return resolveRemotePreviewerFile({ path: absolutePath }, remoteCtx)
}
