/**
 * The height of one row above the composer — the status chips, and the todo
 * strip's header, which sits directly on top of them and is read as the same
 * kind of line.
 *
 * Every chip used to be sized at the 44 pt touch-target minimum, so the target,
 * not the label, set the row's height. Draw them short and hand the difference
 * back as `hitSlop`: the finger still gets 44, the transcript gets the rest.
 * 32 is the midpoint the two rows were averaged to — the status row came down
 * from 36, the todo header came up from 27 — so neither reads as the taller one.
 *
 * `CHIP_HEIGHT + top + bottom` must stay at 44.
 */
export const CHIP_HEIGHT = 32

export const CHIP_HIT_SLOP = { top: 6, bottom: 6, left: 0, right: 0 }

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
