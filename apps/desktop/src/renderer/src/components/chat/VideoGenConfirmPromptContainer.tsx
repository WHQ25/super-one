import { useEffect, useState } from 'react'
import { useChatStore } from '@/stores/chat'
import { VIDEO_GEN_PARAMS_FIELD, type PermissionRequest, type VideoGenParams, type VideoGenReferenceImage } from '@superone/shared/agent-types'
import { VideoGenConfirmPrompt } from './VideoGenConfirmPrompt'

/**
 * Bridges a `video_gen_confirm` PermissionRequest to the self-contained
 * VideoGenConfirmPrompt: loads reference-image thumbnails over IPC (the payload
 * carries paths only, no bytes) and wires Confirm/Reject to the shared
 * PERMISSION_RESPONSE channel via the chat store's respondToPermission.
 *
 * Response packing (flat record, resolved by resolveVideoConfirm in media-tools):
 * - confirm → allow=true,  formAnswers={ [VIDEO_GEN_PARAMS_FIELD]: JSON.stringify(editedParams) }
 * - reject  → allow=false, formAnswers={ feedback }
 */
export function VideoGenConfirmPromptContainer({ request }: { request: PermissionRequest }) {
  const respondToPermission = useChatStore((s) => s.respondToPermission)
  const payload = request.videoGenConfirm
  const [referenceImages, setReferenceImages] = useState<VideoGenReferenceImage[]>([])

  const refs = payload?.referenceImages ?? []
  useEffect(() => {
    let cancelled = false
    if (refs.length === 0) {
      setReferenceImages([])
      return
    }
    void Promise.all(
      refs.map(async (ref): Promise<VideoGenReferenceImage | null> => {
        try {
          const result = await window.app.readFileAsDataUri(ref.path)
          return result.ok ? { path: ref.path, dataUri: result.dataUri, role: ref.role } : null
        } catch {
          return null
        }
      }),
    ).then((loaded) => {
      if (!cancelled) setReferenceImages(loaded.filter((img): img is VideoGenReferenceImage => img !== null))
    })
    return () => { cancelled = true }
  }, [refs])

  if (!payload) return null

  const handleConfirm = (params: VideoGenParams): void => {
    void respondToPermission(
      request.requestId,
      true,
      undefined,
      undefined,
      undefined,
      undefined,
      { [VIDEO_GEN_PARAMS_FIELD]: JSON.stringify(params) },
    )
  }

  const handleReject = (feedback: string): void => {
    void respondToPermission(
      request.requestId,
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      { feedback },
    )
  }

  return (
    <VideoGenConfirmPrompt
      params={payload.params}
      providers={payload.providers}
      referenceImages={referenceImages}
      onConfirm={handleConfirm}
      onReject={handleReject}
    />
  )
}
