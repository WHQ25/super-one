/** Shared geometry for the text composer and its voice replacement. */
export const COMPOSER_HORIZONTAL_INSET = 12
export const COMPOSER_TOP_GAP = 4
export const PHONE_COMPOSER_RADIUS = 20
export const composerBottomGap = (keyboardVisible: boolean, bottomInset: number) => keyboardVisible || !bottomInset ? 8 : 0

/**
 * Collapsed phone, with a turn still running: Stop already occupies a column
 * outside the field, and Send sits inside it. A draft that needs a second line
 * at that narrower width moves the delivery cluster under Stop. One line keeps
 * Send inside. The keyboard-up action row is a different layout (`collapsed`
 * false) and never stacks.
 *
 * `measuredLines` must be taken at the width the field has while Send is still
 * inside. Judging the wider stacked field would fit the same draft on one line
 * and bounce the button back and forth.
 */
export function collapsedPhoneStacksDelivery(input: {
  collapsed: boolean
  hasStop: boolean
  hasDelivery: boolean
  draft: string
  measuredWidth: number
  measuredLines: number
}): boolean {
  if (!input.collapsed || !input.hasStop || !input.hasDelivery) return false
  if (input.draft.includes('\n')) return true
  return input.measuredWidth > 0 && input.measuredLines > 1
}
