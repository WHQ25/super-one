import type { ImageGenerationInfo } from '@superone/shared/agent-types'
import { requestNative } from './bridge'

/**
 * A source the host can put on a fullscreen viewer without another transfer:
 * bytes the transcript already holds (a data URI) or a public URL.
 */
export function isPreviewableImageSource(src: unknown): src is string {
  return typeof src === 'string' && /^(data:image\/|https?:\/\/)/i.test(src)
}

export interface PreviewImageOptions {
  /** Accessible name shown in the viewer. */
  label?: string
  /** Desktop path when there is one, so the host can name the file when it is shared on. */
  path?: string
  /**
   * Generation facts for a generated image — prompt, parameters, timing — so the
   * viewer can show the same info panel the desktop viewer does.
   */
  generation?: ImageGenerationInfo
}

/**
 * Open an image the transcript is already showing in the host's fullscreen
 * viewer. This is what a tap on any rendered picture does — a tool screenshot,
 * a generated image, a user attachment, a markdown image — as opposed to
 * `previewFile`, which fetches a file the phone does not have yet and lands in
 * the receive/share sheet.
 */
export function previewImage(src: string, options: PreviewImageOptions = {}): void {
  requestNative('previewImage', {
    src,
    ...(options.label ? { label: options.label } : {}),
    ...(options.path ? { path: options.path } : {}),
    ...(options.generation ? { generation: options.generation } : {}),
  })
}
