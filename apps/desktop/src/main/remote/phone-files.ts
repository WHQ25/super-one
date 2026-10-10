import type { RemoteControlService } from '../remote-control-service'
import { authorizeAndStat, FileBridgeError, readPreferInline, type AuthorizedFile } from '../file-bridge'
import { videoPosterService } from './video-poster'
import log from '../logger'

export interface PhoneFileInput {
  path: string
  root?: string
  sessionId?: string
  maxBytes?: number
  statOnly?: boolean
  preferInline?: boolean
}
export interface PhoneFileSource { deviceId: string; transport: 'lan' | 'relay' }

type Failure = { ok: false; error: string; message: string }
const failure = (error: string, cause: unknown): Failure => ({ ok: false, error, message: cause instanceof Error ? cause.message : String(cause) })
const metadata = (file: AuthorizedFile) => ({ mimeType: file.mimeType, name: file.name, size: file.size, modifiedAt: file.modifiedAt })

/** Paired phones may read host files, subject to the shared sensitive-file gate. */
async function authorize(input: PhoneFileInput): Promise<AuthorizedFile | Failure> {
  try {
    const localPath = input.root ? await resolvePhoneFile(input.root, input.path) : input.path
    if (localPath === null) return failure('not_found', 'file does not exist')
    return await authorizeAndStat(localPath, { allowedRoots: [] }, { maxBytes: input.maxBytes, skipRootCheck: true })
  } catch (error) {
    return failure(error instanceof FileBridgeError ? error.code : 'internal_error', error)
  }
}

/** Resolve node artifacts from their mirror and materialize node project files before authorization. */
async function resolvePhoneFile(root: string, path: string): Promise<string | null> {
  const { getEnvironmentHost } = await import('../environment/environment-host')
  const host = getEnvironmentHost()
  const { resolveSessionFile, resolverDepsFor, materializeRemoteProjectFile } = await import('../environment/session-file-resolver')
  const resolution = await resolveSessionFile(root, path, resolverDepsFor(host))
  if (resolution.kind === 'local') return resolution.path
  if (resolution.kind === 'missing') return null
  const { resolveRemoteProjectContext } = await import('../environment/remote-file-tree')
  const ctx = await resolveRemoteProjectContext(host, resolution.folderPath)
  if (!ctx) return null
  const ref = { environmentId: ctx.environmentId, projectId: ctx.projectId }
  return materializeRemoteProjectFile(resolution.connectionId, resolution.folderPath, resolution.relativePath, {
    stat: async rel => {
      const parent = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '.'
      const entries = await host.workspace().listDir({ project: ref, relativePath: parent || '.' })
      const file = entries.find(entry => entry.name === rel.slice(rel.lastIndexOf('/') + 1))
      return file?.type === 'file' ? { size: file.size ?? 0, mtimeMs: file.mtimeMs ?? 0 } : null
    },
    read: async rel => {
      const raw = await host.workspace().readFile({ project: ref, relativePath: rel })
      return typeof raw.content === 'string' ? Buffer.from(raw.content, 'utf8') : Buffer.from(raw.content)
    },
  })
}

export async function readPhoneVideoPoster(input: PhoneFileInput): Promise<unknown> {
  const file = await authorize({ ...input, maxBytes: Number.MAX_SAFE_INTEGER })
  if ('ok' in file) return file
  try {
    const poster = file.mimeType.startsWith('video/') ? await videoPosterService().posterFor(file) : null
    return { ok: true, ...metadata(file), poster }
  } catch (error) { return failure('internal_error', error) }
}

/** Small files return inline; larger files use the authenticated LAN or encrypted relay transfer. */
export async function readPhoneFile(input: PhoneFileInput, source: PhoneFileSource, remote?: Pick<RemoteControlService, 'signLanFileUrl' | 'uploadFileToRelay'>): Promise<unknown> {
  const file = await authorize(input)
  if ('ok' in file) return file
  try {
    const inline = await readPreferInline(file, { preferInline: input.preferInline, statOnly: input.statOnly, transport: source.transport })
    if (inline.kind === 'text') return { ok: true, inline: true, text: inline.text, ...metadata(file) }
    if (inline.kind === 'bytes') return { ok: true, inline: true, base64: inline.bytes.toString('base64'), ...metadata(file) }
  } catch (error) { return failure('internal_error', error) }
  if (input.statOnly) return { ok: true, statOnly: true, ...metadata(file) }
  if (!remote) return failure('no_transport', 'remote control unavailable')
  try {
    if (source.transport === 'lan') {
      const url = await remote.signLanFileUrl(file.realPath, { ttlMs: 60_000 })
      if (!url) return failure('no_transport', 'LAN file bridge unavailable')
      return { ok: true, url, ...metadata(file), expiresAt: Date.now() + 60_000 }
    }
    if (!source.deviceId) return failure('no_transport', 'relay file needs the requesting device')
    const result = await remote.uploadFileToRelay(file.realPath, { mimeType: file.mimeType, size: file.size }, input.sessionId ?? 'no-session', source.deviceId)
    return { ok: true, url: result.downloadUrl, ...metadata(file), expiresAt: result.expiresAt, ...(result.encryption ? { encryption: result.encryption } : {}) }
  } catch (error) {
    log.error('[phone-files] transfer failed:', error)
    return failure('upload_failed', error)
  }
}
