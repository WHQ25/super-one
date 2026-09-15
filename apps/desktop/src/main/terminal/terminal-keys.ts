/**
 * Named keys for `terminal_act` → the bytes a terminal emulator would send.
 *
 * Cursor keys honour DECCKM (application cursor mode): full-screen programs
 * such as vim and less switch it on and then expect `ESC O A`, not `ESC [ A`.
 */

const ESC = '\x1b'

const FIXED_KEYS: Record<string, string> = {
  enter: '\r',
  return: '\r',
  tab: '\t',
  escape: ESC,
  esc: ESC,
  backspace: '\x7f',
  delete: `${ESC}[3~`,
  insert: `${ESC}[2~`,
  pageup: `${ESC}[5~`,
  pagedown: `${ESC}[6~`,
  space: ' ',
  f1: `${ESC}OP`,
  f2: `${ESC}OQ`,
  f3: `${ESC}OR`,
  f4: `${ESC}OS`,
  f5: `${ESC}[15~`,
  f6: `${ESC}[17~`,
  f7: `${ESC}[18~`,
  f8: `${ESC}[19~`,
  f9: `${ESC}[20~`,
  f10: `${ESC}[21~`,
  f11: `${ESC}[23~`,
  f12: `${ESC}[24~`,
}

const CURSOR_KEYS: Record<string, string> = {
  up: 'A',
  down: 'B',
  right: 'C',
  left: 'D',
  home: 'H',
  end: 'F',
}

export const NAMED_TERMINAL_KEYS = [
  ...Object.keys(FIXED_KEYS),
  ...Object.keys(CURSOR_KEYS),
  'ctrl+<letter>',
  'alt+<key>',
] as const

/**
 * Returns the byte sequence for a key name such as `Enter`, `Ctrl+C`, `Alt+Left`,
 * or `null` when the name is unknown. Case-insensitive.
 */
export function terminalKeySequence(key: string, opts: { applicationCursor?: boolean } = {}): string | null {
  const name = key.trim().toLowerCase()
  if (!name) return null

  const alt = name.startsWith('alt+')
  const base = alt ? name.slice(4) : name
  if (alt) {
    const inner = base.length === 1 ? base : terminalKeySequence(base, opts)
    return inner === null ? null : `${ESC}${inner}`
  }

  if (base.startsWith('ctrl+')) {
    const target = base.slice(5)
    if (target.length !== 1) return null
    const code = target.charCodeAt(0)
    if (code >= 97 && code <= 122) return String.fromCharCode(code - 96) // a–z → 0x01–0x1a
    if (target === '[') return ESC
    if (target === '\\') return '\x1c'
    if (target === ']') return '\x1d'
    if (target === '^') return '\x1e'
    if (target === '_') return '\x1f'
    if (target === ' ' || target === '@') return '\x00'
    return null
  }

  if (base in FIXED_KEYS) return FIXED_KEYS[base]
  if (base in CURSOR_KEYS) return `${ESC}${opts.applicationCursor ? 'O' : '['}${CURSOR_KEYS[base]}`
  return null
}
