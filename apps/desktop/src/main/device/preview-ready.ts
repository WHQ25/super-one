import type { DeviceFrame } from '@superone/shared/device'

const FIRST_FRAME_TIMEOUT_MS = 20_000

/** Wait for a drawable frame, ignoring codec configuration packets. */
export function waitForFirstDeviceFrame(
  subscribe: (listener: (frame: DeviceFrame) => void) => () => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let unsubscribe: (() => void) | null = null
    let settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      unsubscribe?.()
      error ? reject(error) : resolve()
    }
    const onAbort = () => finish(new Error('Cancelled.'))
    const timer = setTimeout(
      () => finish(new Error('The device preview did not produce a frame in time.')),
      FIRST_FRAME_TIMEOUT_MS,
    )
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) {
      onAbort()
      return
    }
    try {
      const stop = subscribe((frame) => {
        // A delta frame only proves bytes are moving; a newly configured decoder
        // still cannot paint it. PNG is whole by definition, while H.264 must reach
        // a keyframe before the request is genuinely safe to confirm.
        if (frame.mimeType === 'image/png' || (!frame.codecConfig && frame.keyframe)) finish()
      })
      unsubscribe = stop
      // A cached PNG can be delivered synchronously by a provider.
      if (settled) stop()
    } catch (cause) {
      finish(cause instanceof Error ? cause : new Error(String(cause)))
    }
  })
}
