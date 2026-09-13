/**
 * `resolveSessionFile(root, path)` — the one place every desktop reader of a
 * session file goes through (`docs/design/session-sync-zone.md` §4.2).
 *
 *   remote root + path under the node zone   → desktop mirror (fetched / refreshed via artifact.*)
 *   remote root + path under the desktop zone → that path (a desktop-produced file)
 *   remote root + anything else               → a node project file (workspace.readFile)
 *   local root                                → the path itself
 *
 * A node project file is not a zone artifact and never lands in the zone; a
 * phone that needs real bytes for one gets a transient copy under the OS temp
 * directory instead (`materializeRemoteProjectFile`), validated by the size
 * and mtime `workspace.listDir` reports.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, renameSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join } from 'node:path'
import type { ArtifactGetRequest, ArtifactGetResult, ArtifactStatResult } from '@superone/shared/environment'
import { parseRemoteProjectKey } from '@superone/shared/remote-resource-key'
import type { EnvironmentHost } from './environment-host'
import { isUnderSyncZone } from '../media-output-paths'
import { mirrorNodeArtifact } from './session-file-mirror'
import { parseNodeZonePath, type NodeSyncZone } from './sync-zone-paths'

export type SessionFileResolution =
  | { kind: 'local'; path: string }
  | { kind: 'remote-project'; connectionId: string; folderPath: string; relativePath: string }
  | { kind: 'missing' }

export interface SessionFileResolverDeps {
  getSyncZone: (connectionId: string) => NodeSyncZone | null
  artifactStat: (connectionId: string, sessionId: string, relativePath: string) => Promise<ArtifactStatResult>
  artifactGet: (connectionId: string, input: ArtifactGetRequest) => Promise<ArtifactGetResult>
}

/** The resolver's view of an EnvironmentHost (structural, so test fakes need only what they use). */
export type SessionFileHost = Pick<EnvironmentHost, 'getSyncZone' | 'artifactStat' | 'artifactGet'>

export function resolverDepsFor(host: Partial<SessionFileHost>): SessionFileResolverDeps {
  return {
    getSyncZone: (connectionId) => host.getSyncZone?.(connectionId) ?? null,
    artifactStat: (connectionId, sessionId, relativePath) => {
      if (!host.artifactStat) throw new Error('artifact.stat unavailable')
      return host.artifactStat(connectionId, sessionId, relativePath)
    },
    artifactGet: (connectionId, input) => {
      if (!host.artifactGet) throw new Error('artifact.get unavailable')
      return host.artifactGet(connectionId, input)
    },
  }
}

async function defaultDeps(): Promise<SessionFileResolverDeps> {
  const { getEnvironmentHost } = await import('./environment-host')
  return resolverDepsFor(getEnvironmentHost())
}

/** Project-relative form of `path` under the remote project `hostPath` (same rule as remote-file-tree). */
function remoteRelative(hostPath: string, path: string): string {
  const p = path.replace(/\\/g, '/')
  const root = hostPath.replace(/\\/g, '/').replace(/\/+$/, '') || '/'
  if (root !== '/' && p.startsWith(`${root}/`)) return p.slice(root.length + 1)
  return p.replace(/^\/+/, '')
}

export async function resolveSessionFile(
  root: string | undefined,
  path: string,
  deps?: SessionFileResolverDeps,
): Promise<SessionFileResolution> {
  const remote = root ? parseRemoteProjectKey(root) : null
  if (!remote) {
    const abs = isAbsolute(path) || /^[A-Za-z]:[\\/]/.test(path) ? path : join(root ?? '', path)
    return { kind: 'local', path: abs }
  }
  const resolved = deps ?? await defaultDeps()
  const zone = resolved.getSyncZone(remote.connectionId)
  const parsed = zone ? parseNodeZonePath(zone, path) : null
  if (parsed) {
    const outcome = await mirrorNodeArtifact(parsed.sessionId, parsed.relativePath, {
      stat: (input) => resolved.artifactStat(remote.connectionId, input.sessionId, input.relativePath),
      get: (input) => resolved.artifactGet(remote.connectionId, input),
    })
    return outcome.kind === 'local' ? { kind: 'local', path: outcome.path } : { kind: 'missing' }
  }
  // A desktop path in a remote session: produced here (older node, or handed
  // out before the zone existed) and read here.
  if ((isAbsolute(path) || /^[A-Za-z]:[\\/]/.test(path)) && isUnderSyncZone(path)) return { kind: 'local', path }
  return { kind: 'remote-project', connectionId: remote.connectionId, folderPath: root!, relativePath: remoteRelative(remote.path, path) }
}

/** Where node project files are staged for the phone; transient by design. */
export function remoteProjectCacheRoot(): string {
  return join(tmpdir(), 'super-one-remote-project-cache')
}

export interface RemoteProjectFileSource {
  /** `size` / `mtimeMs` of the file as the node reports it, or null when it does not exist. */
  stat: (relativePath: string) => Promise<{ size: number; mtimeMs: number } | null>
  read: (relativePath: string) => Promise<Buffer>
}

/**
 * Copy one node project file to a local cache path and return it, reusing the
 * cached copy while the node's size and mtime still match. Returns null when
 * the node has no such file.
 */
export async function materializeRemoteProjectFile(
  connectionId: string,
  folderPath: string,
  relativePath: string,
  source: RemoteProjectFileSource,
): Promise<string | null> {
  const remote = await source.stat(relativePath)
  if (!remote) return null
  const key = createHash('sha1').update(`${folderPath}\0${relativePath}`).digest('hex').slice(0, 16)
  const localPath = join(remoteProjectCacheRoot(), connectionId, key, basename(relativePath))
  try {
    const st = statSync(localPath)
    if (st.isFile() && st.size === remote.size && Math.floor(st.mtimeMs) === Math.floor(remote.mtimeMs)) return localPath
  } catch {
    /* not cached */
  }
  const bytes = await source.read(relativePath)
  mkdirSync(dirname(localPath), { recursive: true })
  const part = `${localPath}.part.${process.pid}`
  writeFileSync(part, bytes)
  renameSync(part, localPath)
  try {
    utimesSync(localPath, remote.mtimeMs / 1000, remote.mtimeMs / 1000)
  } catch {
    /* re-fetched next time */
  }
  return localPath
}
