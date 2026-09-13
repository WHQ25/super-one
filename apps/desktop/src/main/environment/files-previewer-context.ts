/**
 * Build the `@native/files-previewer` context for a remote-node session
 * (`docs/design/inline-files-previewer.md` §2.2).
 *
 * The claim carries only `sessionId` + `turnId`, and the local SessionManager
 * has no entry for a node session, so the live `cwd` and the project host path
 * come from the node over RPC. `root` is the `remote:<connectionId>:<hostPath>`
 * key the renderer already understands; every file is resolved by
 * `resolveRemotePreviewerFile` where it actually lives.
 */
import { remoteProjectKey } from '@superone/shared/remote-resource-key'
import type { PreviewerBuildContext } from '../generative-ui/files-previewer-payload'
import { resolveRemotePreviewerFile, type RemotePreviewerContext } from './files-previewer-remote'

interface NodeSessionView {
  cwd?: string
  projectId?: string
}

export async function resolveRemotePreviewerContext(
  connectionId: string,
  sessionId: string,
): Promise<PreviewerBuildContext | undefined> {
  const { getEnvironmentHost } = await import('./environment-host')
  const host = getEnvironmentHost()
  let session: NodeSessionView | null = null
  try {
    session = (await host.getSession(connectionId, sessionId)) as NodeSessionView | null
  } catch {
    return undefined
  }
  if (!session) return undefined

  // Project host path: from the session's project, or its cwd as a fallback
  // (a bare-worktree session may not resolve a project).
  let hostPath = session.cwd ?? ''
  if (session.projectId) {
    try {
      const projectPath = await host.getRemoteProjectPath(connectionId, session.projectId)
      if (projectPath) hostPath = projectPath
    } catch {
      /* keep cwd */
    }
  }
  if (!hostPath) return undefined
  const projectId = session.projectId
  const cwd = session.cwd && session.cwd.trim() ? session.cwd : hostPath

  const remoteCtx: RemotePreviewerContext = {
    connectionId,
    hostPath,
    cwd,
    zone: host.getSyncZone(connectionId),
    artifactStat: (sid, rel) => host.artifactStat(connectionId, sid, rel),
    artifactGet: (input) => host.artifactGet(connectionId, input),
    listDir: (relativeDir) => (projectId ? host.remoteWorkspaceListDir(connectionId, projectId, relativeDir) : Promise.resolve([])),
  }

  return {
    root: remoteProjectKey(connectionId, hostPath),
    resolveOne: (entry) => resolveRemotePreviewerFile(entry, remoteCtx),
  }
}
