/** Shared geometry for the text composer and its voice replacement. */
export const COMPOSER_HORIZONTAL_INSET = 12
export const COMPOSER_TOP_GAP = 4
export const PHONE_COMPOSER_RADIUS = 20
export const composerBottomGap = (keyboardVisible: boolean, bottomInset: number) => keyboardVisible || !bottomInset ? 8 : 0
