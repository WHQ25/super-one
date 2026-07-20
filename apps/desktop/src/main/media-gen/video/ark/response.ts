/** Terminal and non-terminal states a generation task can be observed in, normalised across vendors. */
export type VideoTaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

export interface VideoTask {
  id: string
  status: VideoTaskStatus
  videoUrl?: string
  error?: string
  /**
   * The vendor's own status string, kept only when it did not map onto a known `VideoTaskStatus`.
   * Such a status is treated as non-terminal (see `unrecognisedStatus`), so this is what makes a
   * subsequent timeout say "still unknown" instead of the misleading "still running".
   */
  rawStatus?: string
}

/**
 * How every provider must handle a status string it does not recognise: keep polling.
 *
 * Mapping the unknown onto `failed` is tempting but wrong — a terminal status stops `pollUntilDone`
 * immediately and `history.ts` writes that outcome to `media_generations` permanently, so one
 * unrecognised string kills a task that was merely still starting up. That is exactly what New API
 * does: a freshly created task sits in `NOT_START`, which its OpenAI-compatible view renders as
 * `"unknown"` (`model/task.go#ToVideoStatus` has no `NOT_START` case and falls through to its
 * default) before the relay's worker dispatches it upstream.
 *
 * Treating it as running instead costs at most one poll timeout in the genuinely-broken case, and
 * relays report real failures with a real failure status anyway. Prefer the recoverable error.
 */
export function unrecognisedStatus(id: string, status: string | undefined): VideoTask {
  return { id, status: 'running', rawStatus: status ?? 'missing' }
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
      return unrecognisedStatus(id, raw.status)
  }
}
