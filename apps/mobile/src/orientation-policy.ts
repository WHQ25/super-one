import { TABLET_MIN_HEIGHT } from './layout-state'

/**
 * Whether the device may rotate into landscape at all.
 *
 * Chat and the rest of the shell stay portrait on a phone: a landscape phone
 * is ~390 dp tall, and once the header and a keyboard are up nothing is left
 * for the composer (Android keyboards simply cover it). Landscape is therefore
 * only offered when the *short* side of the physical screen — which becomes
 * the height in landscape — clears the tablet threshold, i.e. tablets and
 * unfolded foldables. Pass `Dimensions.get('screen')`, not the window, so the
 * answer does not depend on the current orientation.
 *
 * File preview is the exception. A picture or listing is worth turning, and
 * there is no composer to cover, so `filePreviewOpen` unlocks rotation even
 * on a phone.
 */
export function shouldAllowLandscape(
  screen: { width: number; height: number },
  filePreviewOpen = false,
): boolean {
  if (filePreviewOpen) return true
  return Math.min(screen.width, screen.height) >= TABLET_MIN_HEIGHT
}
