/** Terminal and non-terminal states a generation task can be observed in, normalised across vendors. */
export type VideoTaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

export interface VideoTask {
  id: string
  status: VideoTaskStatus
  videoUrl?: string
  error?: string
}

interface ArkTaskResponse {
  id?: string
  status?: string
  content?: { video_url?: string }
  error?: { message?: string; code?: string }
}

/**
 * Normalise Ark's task payload.
 *
 * Anything that is not a known non-terminal state resolves to a terminal one — an unrecognised
 * status must not read as "still running", or the poller would spin until it times out.
 */
export function parseArkVideoTask(raw: ArkTaskResponse): VideoTask {
  const id = raw.id ?? ''
  const message = raw.error?.message

  switch (raw.status) {
    case 'queued':
    case 'running':
      return { id, status: raw.status, videoUrl: undefined, error: undefined }
    case 'succeeded': {
      const videoUrl = raw.content?.video_url
      if (!videoUrl) {
        return { id, status: 'failed', error: 'Ark reported success but returned no video url.' }
      }
      return { id, status: 'succeeded', videoUrl, error: undefined }
    }
    case 'cancelled':
      return { id, status: 'cancelled', error: message }
    case 'failed':
      return { id, status: 'failed', error: message || 'Ark video generation failed without a message.' }
    case 'expired':
      return {
        id,
        status: 'failed',
        error: message || 'The Ark task expired before its result was retrieved.',
      }
    default:
      return { id, status: 'failed', error: `Ark returned an unrecognised task status: ${raw.status}` }
  }
}
