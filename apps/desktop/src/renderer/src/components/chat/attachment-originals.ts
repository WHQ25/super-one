import { create } from 'zustand'
import type { AttachmentOriginalStatus, ImageAttachment } from '@superone/shared/agent-types'
import { parseRemoteProjectKey } from '@superone/shared/remote-resource-key'
import { toast } from 'sonner'
import i18n from 'i18next'
import { useChatStore, type SessionWriteTarget } from '@/stores/chat'
import { resolveWriteScope } from '@/stores/chat-store/helpers/store-helpers'
import { base64ToFile, downscaleImage } from './image-compress'
import { prepareMediaTarget } from './media-composer/prepare-media-target'

const POLL_MS = 1000

interface OriginalUploads {
  statuses: Record<string, AttachmentOriginalStatus>
}

/** Where each staged original stands. A remote one uploads in the background; a local one is ready. */
export const useOriginalUploads = create<OriginalUploads>(() => ({ statuses: {} }))

const watched = new Set<string>()
let timer: ReturnType<typeof setTimeout> | null = null

async function poll(): Promise<void> {
  timer = null
  const paths = [...watched]
  if (!paths.length) return
  try {
    const statuses = await window.app.attachmentOriginalStatus(paths)
    useOriginalUploads.setState(state => ({ statuses: { ...state.statuses, ...statuses } }))
    for (const [path, status] of Object.entries(statuses)) if (status.state !== 'uploading') watched.delete(path)
  } catch {
    // Retried on the next tick; the chips keep their last known state meanwhile.
  }
  if (watched.size && !timer) timer = setTimeout(() => void poll(), POLL_MS)
}

/** Follows these originals until each is ready or has failed. */
export function watchOriginals(paths: readonly string[]): void {
  const known = useOriginalUploads.getState().statuses
  let added = false
  for (const path of paths) {
    if (watched.has(path) || (known[path] && known[path].state !== 'uploading')) continue
    watched.add(path)
    added = true
  }
  if (added && !timer) timer = setTimeout(() => void poll(), 0)
}

export async function retryOriginal(path: string): Promise<void> {
  await window.app.retryAttachmentOriginal(path)
  useOriginalUploads.setState(state => ({ statuses: { ...state.statuses, [path]: { state: 'uploading', progress: 0 } } }))
  watched.add(path)
  if (!timer) timer = setTimeout(() => void poll(), POLL_MS)
}

/** True while an attachment's original is not yet where the agent's tools can read it. */
export function originalPending(attachment: ImageAttachment, statuses: Record<string, AttachmentOriginalStatus>): boolean {
  return !!attachment.originalPath && statuses[attachment.originalPath]?.state !== 'ready'
}

export interface ChatImage {
  attachment: ImageAttachment
  /** The session the attachment belongs to; a remote draft gains a node session id here. */
  target: SessionWriteTarget | undefined
}

/**
 * The attachment the agent views, plus its full-size original for file-path tools when the view
 * copy was downscaled. `sourcePath` names the file on disk when there is one, so it is not re-read.
 * Null when the image cannot be read or its original cannot be kept.
 */
export async function buildChatImage(file: File, target?: SessionWriteTarget, sourcePath?: string): Promise<ChatImage | null> {
  const built = await downscaleImage(file)
  if (!built) return null
  if (!built.downscaled) return { attachment: built.attachment, target }
  const scope = resolveWriteScope(useChatStore.getState(), target)
  if (!scope.projectPath || !scope.sessionId) return { attachment: built.attachment, target }
  try {
    // A remote draft needs its node session before anything can be uploaded into it.
    const owner = parseRemoteProjectKey(scope.projectPath)
      ? await prepareMediaTarget({ projectPath: scope.projectPath, sessionId: scope.sessionId })
      : { projectPath: scope.projectPath, sessionId: scope.sessionId }
    if (!owner) return null
    const path = sourcePath || window.app.getPathForFile(file) || undefined
    const staged = await window.app.stageAttachmentOriginal({ ...owner, name: file.name, mimeType: file.type,
      ...(path ? { sourcePath: path } : { bytes: new Uint8Array(await file.arrayBuffer()) }) })
    // A remote original starts uploading now; a local one reports ready on the first poll.
    if (parseRemoteProjectKey(owner.projectPath)) {
      useOriginalUploads.setState(state => ({ statuses: { ...state.statuses, [staged.path]: { state: 'uploading', progress: 0 } } }))
    }
    watchOriginals([staged.path])
    return { attachment: { ...built.attachment, originalPath: staged.path }, target: target && owner }
  } catch (error) {
    // Not attached at all: a message must not go out without the full-size file it names.
    toast.error(i18n.t('chat.attachmentOriginal.stageFailed', { name: file.name }), { description: (error as Error).message })
    return null
  }
}

/** `buildChatImage` for bytes in hand (pasted, fetched or generated images). */
export function buildChatImageFromBase64(base64: string, mimeType: string, name: string, target?: SessionWriteTarget): Promise<ChatImage | null> {
  return buildChatImage(base64ToFile(base64, mimeType, name), target)
}

/** Resolves once every original has reached its agent; a failed upload rejects. */
export async function waitForOriginals(paths: readonly string[]): Promise<void> {
  if (!paths.length) return
  watchOriginals(paths)
  await new Promise<void>((resolve, reject) => {
    const check = ({ statuses }: OriginalUploads) => {
      if (paths.some(path => statuses[path]?.state === 'failed')) { stop(); reject(new Error(i18n.t('chat.attachmentOriginal.failed'))) }
      else if (paths.every(path => statuses[path]?.state === 'ready')) { stop(); resolve() }
    }
    const stop = useOriginalUploads.subscribe(check)
    check(useOriginalUploads.getState())
  })
}
