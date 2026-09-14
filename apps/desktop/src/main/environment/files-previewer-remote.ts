/**
 * The `@native/files-previewer` resolver for a remote-node session
 * (`docs/design/inline-files-previewer.md` §2.2, §6.1).
 *
 * The agent on the node only ever names node paths. Each is one of three
 * things, and each is stat'd where it actually lives — the desktop never
 * guesses a file into the project (`session-sync-zone.md` §4.2):
 *
 *  - under the node sync zone → the desktop mirror if present, else
 *    `artifact.stat` on the node (a report nobody opened yet must not read
 *    `missing`);
 *  - inside the node project → `workspace.listDir` of the parent for size
 *    (`artifact.stat` is zone-scoped and cannot see project files);
 *  - an absolute node path outside both → `unpreviewable`, never spliced into
 *    the project.
 *
 * `absolutePath` stays the node path; the renderer resolves it through
 * `resolveSessionFile` when it reads or builds a URL.
 */
import { basename } from 'node:path'
import type { PreviewerFile } from '@superone/shared/generative-ui/native-widgets'
import type { WorkspaceEntry } from '@superone/shared/environment'
import { classifyPreviewerFile } from '../generative-ui/files-previewer-payload'
import { mirrorNodeArtifact } from './session-file-mirror'
import { nodeTwinOf, parseNodeZonePath, type NodeSyncZone } from './sync-zone-paths'
import { normalizeHostPath } from './remote-file-tree'

export interface RemotePreviewerContext {
  connectionId: string
  /** Host path of the session's project, for the project-file check. */
  hostPath: string
  /** The session's live cwd on the node; relative entries resolve against it. */
  cwd: string
  zone: NodeSyncZone | null
  artifactStat: (sessionId: string, relativePath: string) => Promise<{ exists: boolean; size: number; mtimeMs: number }>
  artifactGet: (input: { sessionId: string; relativePath: string; offset: number; maxBytes: number }) => Promise<{ chunk: string; total: number; mtimeMs: number; eof: boolean }>
  /** `workspace.listDir` of a project-relative directory. */
  listDir: (relativeDir: string) => Promise<WorkspaceEntry[]>
}

function toNodeAbsolute(entry: string, cwd: string, os: NodeSyncZone['os'] | undefined): string {
  const sep = os === 'windows' ? '\\' : '/'
  const isAbs = entry.startsWith('/') || /^[A-Za-z]:[\\/]/.test(entry)
  if (isAbs) return entry
  const base = cwd.replace(/[\\/]+$/, '')
  return `${base}${sep}${entry.replace(/^\.[\\/]/, '')}`
}

/** Project-relative form of a node absolute path under `hostPath`, or null when outside. */
function projectRelative(hostPath: string, absPath: string): string | null {
  const root = normalizeHostPath(hostPath)
  const p = absPath.replace(/\\/g, '/')
  if (root !== '/' && p === root) return '.'
  if (root !== '/' && p.startsWith(`${root}/`)) return p.slice(root.length + 1)
  return null
}

export async function resolveRemotePreviewerFile(
  entry: { path: string; note?: string },
  ctx: RemotePreviewerContext,
): Promise<PreviewerFile> {
  // The executor maps node-zone args to the desktop mirror before the tool
  // runs (§3.1), so a zone file arrives here as a desktop path. Turn it back
  // into its node twin: that is the identity the renderer and the phone
  // resolve, and the zone branch below already knows how to stat it.
  const twin = ctx.zone ? nodeTwinOf(ctx.zone, entry.path) : null
  const abs = twin ?? toNodeAbsolute(entry.path, ctx.cwd, ctx.zone?.os)
  const base: Omit<PreviewerFile, 'kind'> = {
    path: twin ?? entry.path,
    absolutePath: abs,
    name: basename(abs.replace(/[\\/]+$/, '')) || abs,
    ...(entry.note ? { note: entry.note } : {}),
  }

  const zonePath = ctx.zone ? parseNodeZonePath(ctx.zone, abs) : null
  if (zonePath) {
    // Mirror it so a text file can be sniffed and the desktop copy is ready for
    // the first read; the stat that decides the row still comes from the node.
    const outcome = await mirrorNodeArtifact(zonePath.sessionId, zonePath.relativePath, {
      connectionId: ctx.connectionId,
      stat: (input) => ctx.artifactStat(input.sessionId, input.relativePath),
      get: (input) => ctx.artifactGet(input),
    })
    if (outcome.kind !== 'local') return { ...base, kind: 'missing' }
    const { readSync, openSync, closeSync } = await import('node:fs')
    return classifyPreviewerFile(base, outcome.size, () => {
      const fd = openSync(outcome.path, 'r')
      try {
        const buf = new Uint8Array(4096)
        const n = readSync(fd, buf, 0, 4096, 0)
        return buf.subarray(0, n)
      } finally {
        closeSync(fd)
      }
    })
  }

  const rel = projectRelative(ctx.hostPath, abs)
  if (rel === null) {
    // Neither in the zone nor under the project root: the desktop has no way to
    // serve it (a media 403 or a project-splice would be a lie), so say so now.
    return { ...base, kind: 'unpreviewable', reason: 'outside_readable_roots' }
  }
  const parent = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '.'
  const name = rel.slice(rel.lastIndexOf('/') + 1)
  try {
    const entries = await ctx.listDir(parent || '.')
    const self = entries.find((e) => e.name === name)
    if (!self || self.type === 'directory') return { ...base, kind: 'missing' }
    // Project files are trusted by extension: reading head bytes over RPC to sniff
    // a mislabelled .txt is not worth a round trip; the reader returns binary if wrong.
    return classifyPreviewerFile(base, self.size ?? 0)
  } catch {
    return { ...base, kind: 'missing' }
  }
}
