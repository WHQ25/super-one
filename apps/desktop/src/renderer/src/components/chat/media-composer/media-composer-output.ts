import type { JSONContent } from '@tiptap/react'
import type { MediaComposerResult } from '@superone/shared/media-composer'
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
