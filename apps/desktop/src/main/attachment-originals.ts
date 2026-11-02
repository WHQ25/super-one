/**
 * Full-size originals of chat image attachments. The renderer sends the agent a downscaled copy to
 * view; the original is kept here, at attach time, for file-path tools such as image generation.
 *
 * - Local session: the user's own file when the image came from disk, otherwise a file beside the
 *   turn's attachments.
 * - Remote session: a file in the session's sync zone, carried to the node by the transfer worker
 *   as a silent `attachment` delivery. The message is not sent until it has landed.
 */
import { randomUUID } from 'node:crypto'
import { existsSync, statSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { ipcMain } from 'electron'
import {
  AgentIpcChannels,
  type AttachmentOriginalStatus,
  type ChatMessage,
  type ImageAttachment,
  type StageAttachmentOriginalRequest,
} from '@superone/shared/agent-types'
import { persistAttachmentBytes, safeFileBase } from '@superone/shared/attachment-store'
import { parseRemoteProjectKey } from '@superone/shared/remote-resource-key'
import { findDeliveryByPath, retryGivenUpDeliveries } from './db-session-deliveries'
import { sealZoneFile } from './environment/zone-delivery'
import { ensureZoneDir, readZoneOwner } from './environment/zone-owner'
import { desktopMirrorPath, nodeZonePath, parseNodeZonePath, type NodeSyncZone } from './environment/sync-zone-paths'
import { assertZoneSessionId, producerDir, zoneRelativePath } from './media-output-paths'

export async function stageAttachmentOriginal(request: StageAttachmentOriginalRequest): Promise<{ path: string }> {
  const { projectPath, sessionId, name, mimeType, sourcePath, bytes } = request ?? {}
  if (typeof projectPath !== 'string' || typeof sessionId !== 'string' || typeof name !== 'string' ||
    typeof mimeType !== 'string' || !mimeType.startsWith('image/')) throw new Error('Invalid attachment original')
  if (sourcePath !== undefined && (typeof sourcePath !== 'string' || !isAbsolute(sourcePath) || !statSync(sourcePath).isFile())) {
    throw new Error('Attachment original must be a file')
  }
  if (sourcePath === undefined && !(bytes instanceof Uint8Array && bytes.byteLength > 0)) throw new Error('Attachment original is empty')

  const remote = parseRemoteProjectKey(projectPath)
  if (!remote) {
    if (sourcePath) return { path: sourcePath }
    const path = persistAttachmentBytes(bytes!, mimeType, { name })
    if (!path) throw new Error(`Could not save ${name}`)
    return { path }
  }

  assertZoneSessionId(sessionId)
  const { getEnvironmentHost } = await import('./environment/environment-host')
  const host = getEnvironmentHost()
  // The node only accepts uploads into a session it has; the renderer creates one for a draft first.
  if (!await host.getSession(remote.connectionId, sessionId)) throw new Error('Remote session does not exist')
  const data = sourcePath ? await readFile(sourcePath) : Buffer.from(bytes!)
  const dir = ensureZoneDir(producerDir(sessionId, 'attachment'), remote.connectionId)
  const path = join(dir, `${randomUUID()}-${safeFileBase(name, mimeType)}`)
  // Written and sealed in one synchronous sequence (§8.4), so no mirror sees an unrecorded file.
  writeFileSync(path, data, { flag: 'wx' })
  sealZoneFile({ sessionId, path, origin: 'attachment', connectionId: remote.connectionId, bytes: data })
  host.artifactTransfers?.wake(remote.connectionId)
  return { path }
}

export function attachmentOriginalStatus(path: string): AttachmentOriginalStatus {
  const zone = zoneRelativePath(path)
  const row = zone && findDeliveryByPath(zone.sessionId, path)
  if (!row) {
    // A local session's zone files have no delivery record (§8.4); a remote one's always do, so one
    // without is a file nothing will carry to the node.
    if (zone && typeof readZoneOwner(zone.sessionId) === 'string') return { state: 'failed', retryable: false }
    return existsSync(path) ? { state: 'ready' } : { state: 'failed', retryable: false }
  }
  if (row.outcome === 'abandoned') return { state: 'failed', retryable: false }
  if (row.outcome === 'done' || row.phase === 'uploaded' || row.phase === 'notifying') return { state: 'ready' }
  // A give-up at `committing` may already have landed; only a fresh attach is safe (E090-3).
  if (row.gaveUpAt) return { state: 'failed', retryable: row.phase !== 'committing' }
  return { state: 'uploading', progress: row.total ? row.offset / row.total : 0 }
}

async function retryAttachmentOriginal(path: string): Promise<void> {
  const zone = zoneRelativePath(path)
  const row = zone && findDeliveryByPath(zone.sessionId, path)
  if (!zone || !row) return
  retryGivenUpDeliveries(zone.sessionId)
  const { getEnvironmentHost } = await import('./environment/environment-host')
  getEnvironmentHost().artifactTransfers?.wake(row.connectionId)
}

function withoutOriginalPath(attachment: ImageAttachment): ImageAttachment {
  if (!attachment.originalPath) return attachment
  const { originalPath: _path, ...rest } = attachment
  return rest
}

/**
 * Point one window attachment at this desktop's copy of the file, or drop a
 * path this machine cannot read. The node names its own zone; the controlling
 * desktop staged the same relative path under its mirror and previews that.
 * A path that is not this session's `attachment/` file is removed so the
 * renderer never treats a foreign path as a local image.
 */
export function mirrorWindowAttachment(attachment: ImageAttachment, zone: NodeSyncZone | null, sessionId: string): ImageAttachment {
  const nodePath = attachment.originalPath
  if (!nodePath) return attachment
  const fromNode = zone ? parseNodeZonePath(zone, nodePath) : null
  const fromDesktop = !fromNode ? zoneRelativePath(nodePath) : null
  const located = fromNode ?? fromDesktop
  if (!located || located.sessionId !== sessionId || !located.relativePath.startsWith('attachment/')) return withoutOriginalPath(attachment)
  const local = desktopMirrorPath(sessionId, located.relativePath)
  if (!existsSync(local)) return withoutOriginalPath(attachment)
  return local === nodePath ? attachment : { ...attachment, originalPath: local }
}

/** {@link mirrorWindowAttachment} over a message. The same object when nothing names a zone file. */
export function mirrorWindowMessageAttachments(message: ChatMessage, zone: NodeSyncZone | null, sessionId: string): ChatMessage {
  if (!message.attachments?.some((attachment) => attachment.originalPath)) return message
  return { ...message, attachments: message.attachments.map((attachment) => mirrorWindowAttachment(attachment, zone, sessionId)) }
}

/** The node's path for a landed original; refuses one from another session or still on its way. */
export function nodeAttachmentOriginal(sessionId: string, path: string, zone: NodeSyncZone): string {
  const local = zoneRelativePath(path)
  if (!local || local.sessionId !== sessionId) throw new Error('Attachment original belongs to another session')
  if (attachmentOriginalStatus(path).state !== 'ready') throw new Error('An attachment is still uploading to the remote node')
  return nodeZonePath(zone, sessionId, local.relativePath)
}

export function registerAttachmentOriginalsIpc(): void {
  ipcMain.handle(AgentIpcChannels.STAGE_ATTACHMENT_ORIGINAL, (_event, request: StageAttachmentOriginalRequest) => stageAttachmentOriginal(request))
  ipcMain.handle(AgentIpcChannels.ATTACHMENT_ORIGINAL_STATUS, (_event, paths: unknown) => {
    if (!Array.isArray(paths) || !paths.every(path => typeof path === 'string')) throw new Error('Invalid attachment paths')
    return Object.fromEntries(paths.map(path => [path, attachmentOriginalStatus(path)]))
  })
  ipcMain.handle(AgentIpcChannels.RETRY_ATTACHMENT_ORIGINAL, (_event, path: unknown) => {
    if (typeof path !== 'string') throw new Error('Invalid attachment path')
    return retryAttachmentOriginal(path)
  })
}
