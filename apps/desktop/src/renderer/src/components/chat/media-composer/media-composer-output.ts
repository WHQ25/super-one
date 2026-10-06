import type { JSONContent } from '@tiptap/react'
import type { MediaComposerKind, MediaComposerModel, MediaComposerReference, MediaComposerResult } from '@superone/shared/media-composer'
import { validateTurnAttachments } from '@superone/shared/attachment-validation'
import { parseRemoteProjectKey } from '@superone/shared/remote-resource-key'
import { useChatStore, type SessionWriteTarget } from '@/stores/chat'
import { buildImageAttachmentFromBase64 } from '../image-compress'
import { plainTextToTiptapDoc } from '../chat-input/plainTextToTiptapDoc'
import { serializeComposerDocument } from '../chat-input/serializeComposerDocument'
import { segmentsText } from '../chat-input/segments-text'

export async function insertMediaIntoDraft(target: SessionWriteTarget, result: MediaComposerResult) {
  if (result.status !== 'succeeded' || !result.files.length) throw new Error('No completed media result')
  if (result.kind === 'video' && parseRemoteProjectKey(target.projectPath) && result.files.some(f => f.agentPath === f.path)) {
    throw new Error('remoteVideoUnavailable')
  }
  const additions = result.kind === 'image' ? await Promise.all(result.files.map(async (file, index) => {
    const image = file.base64 && await buildImageAttachmentFromBase64(file.base64, file.mediaType, file.path.split(/[\\/]/).at(-1) ?? 'image.png')
    if (!image) throw new Error('Cannot read generated image')
    return { ...image, id: `media-${result.generationId}-${index}` }
  })) : []
  // Re-read after image conversion: another pane may have edited or deleted this draft meanwhile.
  const store = useChatStore.getState()
  const session = store.projectSessions[target.projectPath]?._sessions[target.sessionId]
  if (!session) throw new Error('Media session no longer exists')
  const newImages = additions.filter(image => !session.attachments.some(existing => existing.id === image.id))
  const attachments = [...session.attachments, ...newImages]
  const links = result.kind === 'video' ? result.files.map(file => `[Video](<${file.agentPath}>)`).filter(link => !session.draftText.includes(link)).join('\n') : ''
  const draftText = [session.draftText, links].filter(Boolean).join('\n')
  validateTurnAttachments(attachments, draftText)
  const doc = (session.draftJson ?? plainTextToTiptapDoc(session.draftText)) as JSONContent
  const content = [...(doc.content ?? [])]
  if (newImages.length) content.push({ type: 'paragraph', content: newImages.map(image => ({ type: 'attachment', attrs: { id: image.id } })) })
  if (links) content.push(...plainTextToTiptapDoc(links).content!)
  for (const image of newImages) store.addAttachment(image, target)
  store.setDraftText(draftText, target)
  store.setDraftJson({ ...doc, content }, target)
}

export async function sendMediaToAgent(target: SessionWriteTarget, result: MediaComposerResult) {
  await insertMediaIntoDraft(target, result)
  const store = useChatStore.getState()
  const session = store.projectSessions[target.projectPath]?._sessions[target.sessionId]
  if (!session) throw new Error('Media session no longer exists')
  const draft = serializeComposerDocument(session.draftJson as JSONContent | null, session.draftText, session.attachments)
  const text = segmentsText(draft.segments)
  // Let the ordinary send path retain failed messages, node routing and current harness settings.
  await store.sendMessage(text, draft.segments, draft.mentions, draft.attachments, target)
  const current = useChatStore.getState().projectSessions[target.projectPath]?._sessions[target.sessionId]
  if (current?.draftJson === session.draftJson && current.draftText === session.draftText) {
    store.setDraftText('', target)
    store.setDraftJson(null, target)
  }
}

export interface MediaDelegation {
  kind: MediaComposerKind
  model?: Pick<MediaComposerModel, 'providerId' | 'providerLabel' | 'model' | 'label'>
  prompt: string
  references: MediaComposerReference[]
  aspectRatio?: string
  size?: string
  duration?: number
  resolution?: string
  seed?: number
  generateAudio?: boolean
  watermark?: boolean
  cameraFixed?: boolean
}

/** The agent-facing request: tool argument names, so the agent can call the media tool as asked. */
export function buildMediaDelegationText({ kind, model, prompt, references, aspectRatio, size, duration, resolution, seed, generateAudio, watermark, cameraFixed }: MediaDelegation): string {
  const numbered = (role: MediaComposerReference['role']) => references.flatMap((ref, index) => (ref.role ?? 'reference') === role ? [index + 1] : [])
  const images = (indexes: number[]) => indexes.length === 1 ? `attached image ${indexes[0]}` : `attached images ${indexes.join(', ')}`
  const settings: [string, string | number | boolean | undefined][] = [
    ['provider', model && `${model.providerId} (${model.providerLabel})`],
    ['model', model && `${model.model} (${model.label})`],
    ['aspect_ratio', aspectRatio],
    ...(kind === 'image'
      ? [['size', size]] as [string, string | undefined][]
      : [['duration', duration], ['resolution', resolution], ['seed', seed], ['generate_audio', generateAudio],
          ['watermark', watermark], ['camera_fixed', cameraFixed],
          ['first_frame_path', numbered('first').length ? images(numbered('first')) : undefined],
          ['last_frame_path', numbered('last').length ? images(numbered('last')) : undefined]] as [string, string | number | boolean | undefined][]),
    ['reference_image_paths', numbered('reference').length ? images(numbered('reference')) : undefined],
  ]
  const lines = settings.filter(([, value]) => value !== undefined && value !== '').map(([name, value]) => `- ${name}: ${value}`)
  return [`Generate ${kind === 'image' ? 'an image' : 'a video'} with the media_generate_${kind} tool.`, '', 'Prompt:', prompt.trim(),
    ...(lines.length ? ['', 'Settings:', ...lines] : [])].join('\n')
}

/** Sends the request as an ordinary user message, leaving the chat draft untouched. */
export async function delegateMediaToAgent(target: SessionWriteTarget, request: MediaDelegation) {
  const attachments = await Promise.all(request.references.map(async (ref, index) => {
    const image = await buildImageAttachmentFromBase64(ref.base64, ref.mediaType, ref.name)
    if (!image) throw new Error(`Cannot read reference image ${ref.name}`)
    return { ...image, id: `media-reference-${crypto.randomUUID()}-${index}` }
  }))
  validateTurnAttachments(attachments, request.prompt)
  const text = buildMediaDelegationText(request)
  await useChatStore.getState().sendMessage(text, [{ text, isPaste: false }, ...attachments.map(image => ({ attachmentId: image.id }))], [], attachments, target)
}
