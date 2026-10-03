/** How long typed digits wait for another digit when a longer number could follow. */
export const NUMBERED_PICK_WAIT_MS = 700

/**
 * What the digits typed so far mean for a list numbered 1…`count`: a number no
 * longer one can extend picks at once ("5" of 23); one that could still grow
 * waits, holding its own option as the fallback ("2" of 23 → 2, or 20–23).
 */
export type NumberedPick =
  | { kind: 'pick'; index: number }
  | { kind: 'wait'; index: number }
  | { kind: 'none' }

export function readNumberedPick(digits: string, count: number): NumberedPick {
  if (!/^[1-9]\d*$/.test(digits)) return { kind: 'none' }
  const number = Number(digits)
  if (number > count) return { kind: 'none' }
  return number * 10 <= count ? { kind: 'wait', index: number - 1 } : { kind: 'pick', index: number - 1 }
}

/** The digits after pressing `key`; a digit that cannot continue them starts a new number. */
export function typeNumberedPick(digits: string, key: string, count: number): { digits: string; read: NumberedPick } {
  const read = readNumberedPick(digits + key, count)
  if (read.kind !== 'none' || !digits) return { digits: read.kind === 'wait' ? digits + key : '', read }
  return typeNumberedPick('', key, count)
}
