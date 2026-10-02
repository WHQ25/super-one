import { useEffect, useState } from 'react'
import type { PreviewerFile, PreviewerFileKind } from '@superone/shared/generative-ui/native-widgets'
import { fitPreviewerStageHeight, probeImageSize, type MediaSize } from '@superone/shared/generative-ui/previewer-stage-height'
import { resolvePreviewerMediaUrl } from './use-previewer-file'

/** Kinds whose card slide is as tall as the media it shows, scaled to the stage width. */
const PROBED_KINDS: ReadonlySet<PreviewerFileKind> = new Set(['image', 'video'])
/** Kinds that need no more than the stage floor: the audio bar and the verdict card. */
const FLOOR_KINDS: ReadonlySet<PreviewerFileKind> = new Set(['audio', 'missing', 'unpreviewable'])

/** Fits the error card (icon, name, verdict, size, retry) and the nav arrows. */
export const PREVIEWER_STAGE_MIN_HEIGHT = 200

function probeVideo(url: string): { promise: Promise<MediaSize | null>; cancel: () => void } {
  const video = document.createElement('video')
  video.preload = 'metadata'
  video.muted = true
  const promise = new Promise<MediaSize | null>((resolve) => {
    video.onloadedmetadata = () => resolve(video.videoWidth > 0 ? { width: video.videoWidth, height: video.videoHeight } : null)
    video.onerror = () => resolve(null)
  })
  video.src = url
  return {
    promise,
    cancel: () => {
      video.onloadedmetadata = null
      video.onerror = null
      video.removeAttribute('src')
      video.load()
    },
  }
}

/**
 * The card stage's height in px: the tallest slide at `width`, so paging never
 * reflows the transcript, or `null` when the card should keep its fixed height
 * — some slide fills whatever it gets (text, PDF, model), the probes are still
 * out, or the width is not measured yet.
 */
export function useStageContentHeight(root: string, files: PreviewerFile[], width: number): number | null {
  const fits = files.every((f) => PROBED_KINDS.has(f.kind) || FLOOR_KINDS.has(f.kind))
  const probed = fits ? files.filter((f) => PROBED_KINDS.has(f.kind)) : []
  const key = probed.map((f) => `${f.kind}\0${f.absolutePath}`).join('\n')
  const [sizes, setSizes] = useState<{ key: string; sizes: (MediaSize | null)[] } | null>(null)

  useEffect(() => {
    if (!fits) return
    let cancelled = false
    const cancels: (() => void)[] = []
    void Promise.all(probed.map(async (file) => {
      const url = await resolvePreviewerMediaUrl(root, file).catch(() => null)
      if (!url || cancelled) return null
      const probe = file.kind === 'video' ? probeVideo(url) : probeImageSize(url)
      cancels.push(probe.cancel)
      return probe.promise
    })).then((result) => { if (!cancelled) setSizes({ key, sizes: result }) })
    return () => { cancelled = true; cancels.forEach((cancel) => cancel()) }
    // `key` folds every probed path and kind; `probed` is derived from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, key, fits])

  if (!fits || width <= 0 || sizes?.key !== key) return null
  return fitPreviewerStageHeight(sizes.sizes, width, PREVIEWER_STAGE_MIN_HEIGHT)
}
