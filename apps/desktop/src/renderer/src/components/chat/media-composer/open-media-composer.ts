import type { MediaComposerKind, MediaComposerReference } from '@superone/shared/media-composer'
import { useChatStore, type SessionWriteTarget } from '@/stores/chat'
import { composerForSession, registerComposer } from '../composer-slot/composer-registry'
import type { OpenComposerOptions } from '../composer-slot/composer-stack'
import { prepareMediaTarget } from './prepare-media-target'

let registration: Promise<void> | undefined
export function ensureMediaComposers() {
  return registration ??= import('./MediaComposer').then(({ ImageComposer, VideoComposer }) => {
    registerComposer('superone.image', ImageComposer)
    registerComposer('superone.video', VideoComposer)
  }).catch(error => { registration = undefined; throw error })
}

export async function openMediaComposer(target: SessionWriteTarget, kind: MediaComposerKind,
  options: OpenComposerOptions & { prompt?: string; references?: MediaComposerReference[]; output?: 'caller' | 'agent' } = {}) {
  const captured = { ...target }
  const references = options.references ?? useChatStore.getState().projectSessions[captured.projectPath]?._sessions[captured.sessionId]?.attachments
    .filter(attachment => ['image/png', 'image/jpeg', 'image/webp'].includes(attachment.mimeType))
    .map(attachment => ({ name: attachment.name, mediaType: attachment.mimeType, base64: attachment.base64 }))
  await ensureMediaComposers()
  const owner = await prepareMediaTarget(captured, options.signal)
  if (!owner) return null
  return composerForSession(owner).open(`superone.${kind}`, {
    ...options, lifetime: options.lifetime ?? 'sticky',
    prefill: { ...options.prefill, ...(options.prompt !== undefined ? { prompt: options.prompt } : {}),
      ...(references ? { references } : {}), output: options.output ?? 'caller' },
  })
}
