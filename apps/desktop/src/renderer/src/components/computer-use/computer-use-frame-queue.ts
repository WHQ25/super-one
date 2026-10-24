/**
 * Serial decoder for Computer Use picture-in-picture frames.
 *
 * The helper emits a JPEG about eight times a second. Pointing an `<img>` at each
 * new data URL aborts the decode that is already in flight, and Chromium clears the
 * element until the next one finishes. During a turn the renderer is busy enough
 * that none of those decodes commit, so the preview stays on its black plate even
 * though every JPEG is a real window capture.
 *
 * This queue lets the decode that already started finish and paint, remembers only
 * the newest frame that arrived meanwhile, and never cancels a decode to keep up.
 */
export function createComputerUseFrameQueue(
  decode: (data: string) => Promise<void>,
): { push: (data: string) => void; close: () => void } {
  let pending: string | null = null
  let hasPending = false
  let busy = false
  let closed = false

  function pump(): void {
    if (closed || busy || !hasPending) return
    const data = pending ?? ''
    pending = null
    hasPending = false
    if (!data) return
    busy = true
    void decode(data).then(() => {
      busy = false
      pump()
    }, () => {
      busy = false
      pump()
    })
  }

  return {
    push(data: string) {
      if (closed || !data) return
      pending = data
      hasPending = true
      pump()
    },
    close() {
      closed = true
    },
  }
}
