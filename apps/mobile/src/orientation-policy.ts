import { TABLET_MIN_HEIGHT } from './layout-state'

/**
 * Whether the device may rotate into landscape at all.
 *
 * A phone on its side is ~390 dp tall; once the header and a keyboard are up
 * nothing is left for the composer, and Android keyboards simply cover it
 * (fullscreen and floating IMEs cannot be pushed out of the way). Landscape is
 * therefore only offered when the *short* side of the physical screen — which
 * becomes the height in landscape — clears the tablet threshold, i.e. tablets
 * and unfolded foldables. Pass `Dimensions.get('screen')`, not the window, so
 * the answer does not depend on the current orientation.
 */
export function shouldAllowLandscape(screen: { width: number; height: number }): boolean {
  return Math.min(screen.width, screen.height) >= TABLET_MIN_HEIGHT
}
