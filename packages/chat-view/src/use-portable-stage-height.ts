import { useEffect, useState } from 'react'
import type { PreviewerFile } from '@superone/shared/generative-ui/native-widgets'
import { fitPreviewerStageHeight, probeImageSize, type MediaSize } from '@superone/shared/generative-ui/previewer-stage-height'
import { isInlinePreviewCandidate } from '@superone/shared/file-preview'
import { loadHostImage } from './PortableHostImage'
import { loadHostVideoPoster } from './PortableHostVideo'

/** Fits the chip (icon, name, hint) and the relay's Load button under it. */
export const PORTABLE_PREVIEWER_STAGE_MIN_HEIGHT = 120

/** A slide that scrolls inside whatever it gets: the inline text and Markdown stage. */
function fillsStage(file: PreviewerFile): boolean {
  return (file.kind === 'text' || file.kind === 'markdown') && isInlinePreviewCandidate(file.name, file.size ?? Number.POSITIVE_INFINITY)
}

/** A slide whose size is unknown until the user acts: the stage keeps its full height. */
const UNKNOWN = 'unknown'

/**
 * Asks the same memoised loaders the slides use, so measuring a file is the
 * slide's own fetch made early, never a second transfer. `null` is a slide
 * that shows a chip; an image the relay holds back for a Load tap is
 * `unknown`, since the picture it becomes after the tap has no size yet.
 */
async function measure(root: string, file: PreviewerFile): Promise<MediaSize | null | typeof UNKNOWN> {
  if (file.kind === 'video') {
    const phase = await loadHostVideoPoster(root, file.absolutePath)
    return phase.kind === 'ready' ? { width: phase.poster.width, height: phase.poster.height } : null
  }
  const phase = await loadHostImage(root, file.absolutePath, false)
  if (phase.kind === 'confirm') return UNKNOWN
  return phase.kind === 'ready' ? probeImageSize(phase.dataUri).promise : null
}

/**
 * The phone stage's height in px: the tallest slide at `width`, capped at
 * `max`, or `null` while it is unknown — some slide is inline text or an
 * image waiting on a Load tap, the measurements are still out, or the width
 * is not measured yet. Every other kind is a chip, which the floor fits.
 */
export function usePortableStageHeight(root: string, files: PreviewerFile[], width: number, max: number): number | null {
  const fits = !files.some(fillsStage)
  const measured = fits ? files.filter((f) => f.kind === 'image' || f.kind === 'video') : []
  const key = measured.map((f) => `${f.kind}\0${f.absolutePath}`).join('\n')
  const [sizes, setSizes] = useState<{ key: string; sizes: (MediaSize | null | typeof UNKNOWN)[] } | null>(null)

  useEffect(() => {
    if (!fits) return
    let live = true
    void Promise.all(measured.map((file) => measure(root, file).catch(() => null)))
      .then((result) => { if (live) setSizes({ key, sizes: result }) })
    return () => { live = false }
    // `key` folds every measured path and kind; `measured` is derived from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, key, fits])

  if (!fits || width <= 0 || sizes?.key !== key) return null
  const known = sizes.sizes.filter((size) => size !== UNKNOWN)
  if (known.length < sizes.sizes.length) return null
  return Math.min(max, fitPreviewerStageHeight(known, width, PORTABLE_PREVIEWER_STAGE_MIN_HEIGHT))
}
