/**
 * The composer's status row is a line of chips, and every one of them used to be
 * sized at the 44 pt touch-target minimum — so the target, not the label, set the
 * row's height. Draw them at 36 and hand the missing 8 pt back as `hitSlop`: the
 * finger still gets 44, the row gives a line of the transcript back.
 */
export const CHIP_HEIGHT = 36

export const CHIP_HIT_SLOP = { top: 4, bottom: 4, left: 0, right: 0 }

/**
 * A menu chip's background.
 *
 * `pressed` is touch feedback; `open` is what took the disclosure chevron's
 * place. The model and permission chips dropped their arrows to give the row
 * back the width — with the arrow gone, a lit background is the only thing that
 * says the chip has a menu and that the menu is currently showing.
 */
export function chipTriggerBackground(
  state: { pressed: boolean; open: boolean },
  mutedColor: string,
): string {
  return state.pressed || state.open ? mutedColor : 'transparent'
}
