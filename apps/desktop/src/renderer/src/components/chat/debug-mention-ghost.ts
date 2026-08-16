/**
 * After a @debug chip, show a ghost asking the user to describe the bug.
 * Hide as soon as they type (or drop another chip / attachment) after it.
 */

export type DebugGhostPiece =
  | { type: 'mention'; kind: string }
  | { type: 'text'; text: string }
  | { type: 'hardBreak' }
  | { type: 'other' }

export type DebugGhostPrefix = ' ' | ''

/**
 * Leading space for the ghost, or null when it should stay hidden.
 * Only the first visual line is considered (stop at hardBreak).
 */
export function debugMentionGhostPrefix(pieces: readonly DebugGhostPiece[]): DebugGhostPrefix | null {
  let sawDebug = false
  let trailing = ''
  let blocked = false

  for (const piece of pieces) {
    if (piece.type === 'hardBreak') break
    if (piece.type === 'mention' && piece.kind === 'debug') {
      sawDebug = true
      trailing = ''
      blocked = false
      continue
    }
    if (!sawDebug) continue
    if (piece.type === 'text') {
      trailing += piece.text
      continue
    }
    blocked = true
    break
  }

  if (!sawDebug || blocked || trailing.trim().length > 0) return null
  return trailing.length > 0 ? '' : ' '
}
