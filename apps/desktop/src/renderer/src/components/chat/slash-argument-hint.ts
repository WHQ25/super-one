/**
 * Ghost argument-hint for slash commands.
 *
 * Supports:
 * - Positional placeholders: `<path> [opts]`, `[channel] [bump]`
 * - Top-level alternatives (pipe with surrounding whitespace):
 *     `<name> [args] | pause|resume|stop|save [name]`
 *     `<objective> [--budget <tokens>] | status | pause | resume | clear`
 * - Choice tokens without spaces: `pause|resume|stop|save`
 * - Bracket-local choices stay one token: `[project|session]`
 *
 * Top-level alts split only on ` | ` so `pause|resume` and `[a|b]` stay intact.
 */

export type HintToken =
  | { kind: 'placeholder'; raw: string; optional: boolean }
  | { kind: 'choice'; raw: string; options: string[]; optional: boolean }
  | { kind: 'literal'; raw: string; value: string; optional: boolean }

/** Split on top-level ` | ` (pipe with spaces), not on `a|b` or `[a|b]`. */
export function splitTopLevelAlternatives(hint: string): string[] {
  const s = hint.trim()
  if (!s) return []
  const parts: string[] = []
  let buf = ''
  let angle = 0
  let square = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!
    if (c === '<' && square === 0) angle++
    else if (c === '>' && square === 0 && angle > 0) angle--
    else if (c === '[' && angle === 0) square++
    else if (c === ']' && angle === 0 && square > 0) square--
    else if (c === '|' && angle === 0 && square === 0) {
      const prev = s[i - 1]
      const next = s[i + 1]
      if (prev === ' ' && next === ' ') {
        parts.push(buf.trim())
        buf = ''
        i++ // skip space after |
        continue
      }
    }
    buf += c
  }
  const last = buf.trim()
  if (last) parts.push(last)
  return parts.length > 0 ? parts : [s]
}

/** Split a branch on whitespace while keeping `<…>` / `[…]` groups intact. */
export function splitHintSegments(branch: string): string[] {
  const s = branch.trim()
  if (!s) return []
  const segs: string[] = []
  let buf = ''
  let angle = 0
  let square = 0
  const flush = () => {
    const t = buf.trim()
    if (t) segs.push(t)
    buf = ''
  }
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!
    if (c === '<' && square === 0) {
      if (angle === 0 && square === 0 && buf.trim() && /\s$/.test(buf)) flush()
      angle++
      buf += c
      continue
    }
    if (c === '>' && square === 0 && angle > 0) {
      angle--
      buf += c
      if (angle === 0) flush()
      continue
    }
    if (c === '[' && angle === 0) {
      if (square === 0 && buf.trim() && /\s$/.test(buf)) flush()
      square++
      buf += c
      continue
    }
    if (c === ']' && angle === 0 && square > 0) {
      square--
      buf += c
      if (square === 0) flush()
      continue
    }
    if (/\s/.test(c) && angle === 0 && square === 0) {
      flush()
      continue
    }
    buf += c
  }
  flush()
  return segs
}

function isPlaceholderSegment(seg: string): boolean {
  return (
    (seg.startsWith('<') && seg.endsWith('>'))
    || (seg.startsWith('[') && seg.endsWith(']'))
  )
}

function isOptionalSegment(seg: string): boolean {
  return seg.startsWith('[') && seg.endsWith(']')
}

/** Bare `a|b|c` (no spaces) = choice token; `[a|b]` stays a placeholder. */
function isBareChoiceSegment(seg: string): boolean {
  if (isPlaceholderSegment(seg)) return false
  if (!seg.includes('|')) return false
  return !/\s/.test(seg)
}

export function tokenizeHintBranch(branch: string): HintToken[] {
  return splitHintSegments(branch).map((raw) => {
    if (isBareChoiceSegment(raw)) {
      return {
        kind: 'choice' as const,
        raw,
        options: raw.split('|').map((o) => o.trim().toLowerCase()).filter(Boolean),
        optional: false,
      }
    }
    if (isPlaceholderSegment(raw)) {
      return {
        kind: 'placeholder' as const,
        raw,
        optional: isOptionalSegment(raw),
      }
    }
    return {
      kind: 'literal' as const,
      raw,
      value: raw.toLowerCase(),
      optional: false,
    }
  })
}

function argMatchesToken(arg: string, token: HintToken): boolean {
  const lower = arg.toLowerCase()
  switch (token.kind) {
    case 'placeholder':
      return arg.length > 0
    case 'choice':
      return token.options.includes(lower)
    case 'literal':
      return token.value === lower
  }
}

export interface BranchMatch {
  remaining: string[]
  /** Higher = more specific (choice/literal beats placeholder). */
  score: number
}

/**
 * Walk tokens against filled args.
 * Returns null if the branch cannot explain the typed args.
 */
export function remainingTokensForBranch(
  tokens: HintToken[],
  filledArgs: string[],
): BranchMatch | null {
  if (tokens.length === 0) {
    return filledArgs.length === 0 ? { remaining: [], score: 0 } : null
  }

  // Manage form: `op [name]` OR `name op` when first token is a required choice.
  if (
    tokens[0]?.kind === 'choice'
    && !tokens[0].optional
    && filledArgs.length >= 1
  ) {
    const choice = tokens[0]
    const rest = tokens.slice(1)
    const a0 = filledArgs[0]!.toLowerCase()
    if (choice.options.includes(a0)) {
      const rem = remainingTokensForBranch(rest, filledArgs.slice(1))
      if (!rem) return null
      return { remaining: rem.remaining, score: rem.score + 10 }
    }
    // name-first: `/workflow review-changes pause`
    // The leading name already fills the optional `[name]` that usually follows the op,
    // so do not re-offer it as ghost text.
    if (filledArgs.length >= 2 && choice.options.includes(filledArgs[1]!.toLowerCase())) {
      return { remaining: [], score: 10 + 1 }
    }
    return null
  }

  let j = 0
  let score = 0
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!
    if (j >= filledArgs.length) {
      return {
        remaining: tokens.slice(i).map((t) => t.raw),
        score,
      }
    }
    const arg = filledArgs[j]!
    if (argMatchesToken(arg, token)) {
      j++
      if (token.kind === 'choice' || token.kind === 'literal') score += 10
      else score += 1
      continue
    }
    if (token.optional) {
      // skip optional without consuming
      continue
    }
    return null
  }
  // Extra args beyond tokens: still ok (freeform trailing); nothing left to hint
  return { remaining: [], score }
}

function isSimplePositionalOnly(alts: string[]): boolean {
  if (alts.length !== 1) return false
  const tokens = tokenizeHintBranch(alts[0]!)
  return tokens.every((t) => t.kind === 'placeholder')
}

/**
 * Ghost text after the user's current args (without leading space).
 * Returns null when there is nothing left to show.
 */
export function remainingSlashArgumentHint(
  argumentHint: string,
  filledArgs: string[],
): string | null {
  const hint = argumentHint.trim()
  if (!hint) return null

  const alts = splitTopLevelAlternatives(hint)

  // Classic positional: only `<…>` / `[…]` tokens, no top-level alternatives.
  if (isSimplePositionalOnly(alts)) {
    const tokens = tokenizeHintBranch(alts[0]!)
    const remaining = tokens.slice(filledArgs.length).map((t) => t.raw)
    return remaining.length > 0 ? remaining.join(' ') : null
  }

  // Grammar / alternatives: show full hint until the user types an argument.
  if (filledArgs.length === 0) {
    return hint
  }

  let best: BranchMatch | null = null
  for (const alt of alts) {
    const tokens = tokenizeHintBranch(alt)
    const match = remainingTokensForBranch(tokens, filledArgs)
    if (!match) continue
    if (
      !best
      || match.score > best.score
      || (match.score === best.score && match.remaining.length < best.remaining.length)
    ) {
      best = match
    }
  }

  if (!best) {
    // No branch matched (e.g. mid-typing freeform) — stop ghosting rather than show junk.
    return null
  }
  return best.remaining.length > 0 ? best.remaining.join(' ') : null
}
