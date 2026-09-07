export const IME_SETTLE_MS = 120

export function shouldSubmitFromKeyboard(opts: {
  hasContent: boolean
  lastTextChangeAt: number
  now: number
}): boolean {
  return opts.hasContent && opts.now - opts.lastTextChangeAt >= IME_SETTLE_MS
}
