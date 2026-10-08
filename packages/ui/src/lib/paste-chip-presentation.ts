/** Desktop and native use the same paste text window dimensions and typography. */
export const PASTE_TEXT_DIALOG = {
  maxWidth: 896,
  maxHeightRatio: 0.9,
  editorHeightRatio: 0.6,
  viewportMargin: 16,
  radius: 10,
  headerPaddingHorizontal: 16,
  headerPaddingVertical: 10,
  titleFontSize: 14,
  titleLineHeight: 20,
  actionSize: 24,
  actionIconSize: 14,
  actionGap: 4,
  actionRadius: 6,
} as const

export const PASTE_TEXT_EDITOR = {
  padding: 16,
  fontSize: 12,
  lineHeight: 19.5,
} as const
