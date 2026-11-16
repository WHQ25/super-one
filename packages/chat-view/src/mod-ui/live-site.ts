import type { ModSiteSnapshot } from './client'

/**
 * What one view knows of a session-wide site the CLI holds (Theme, Backdrop).
 * The mod that draws it owns the choice and its scope; a view only follows.
 */
export type ModLiveSite<T> =
  /** No session to ask yet, or its first answer is on the way. */
  | { kind: 'waiting' }
  /** A plugin hooks the site and has drawn nothing in this view yet. */
  | { kind: 'empty' }
  | { kind: 'active'; value: T }
  /** It was drawn in this view, then taken away. `previous` is what was taken. */
  | { kind: 'cleared'; previous: T }
  /** No plugin draws this site. */
  | { kind: 'unhooked' }

/** One answer, read on its own. */
export type ModSiteAnswer<T> = { kind: 'waiting' } | { kind: 'empty' } | { kind: 'unhooked' } | { kind: 'active'; value: T }

/** What a view remembers between answers. A session that stops answering starts over. */
export interface ModLiveMemo<T> {
  shown: T | null
  /** Site props of the answer `shown` stands for. */
  sizeKey: string
  /** An empty answer to a resized ask that `shown` was kept through. */
  held: ModSiteSnapshot | null
  cleared: T | null
}

const WAITING = { kind: 'waiting' } as const
const EMPTY = { kind: 'empty' } as const
const UNHOOKED = { kind: 'unhooked' } as const
const EMPTY_MEMO: ModLiveMemo<never> = { shown: null, sizeKey: '', held: null, cleared: null }

export function emptyModLiveMemo<T>(): ModLiveMemo<T> {
  return EMPTY_MEMO
}

export function readModSiteAnswer<T>(available: boolean, snapshot: ModSiteSnapshot, pick: (snapshot: ModSiteSnapshot) => T | null): ModSiteAnswer<T> {
  if (!available || snapshot.status === 'pending') return WAITING
  if (snapshot.status === 'off') return UNHOOKED
  const value = pick(snapshot)
  return value ? { kind: 'active', value } : EMPTY
}

function sizeKeyOf(snapshot: ModSiteSnapshot): string {
  try {
    return JSON.stringify(snapshot.props) ?? ''
  } catch {
    return ''
  }
}

/**
 * Folds one answer into a view's memory. Returns the same memo when nothing
 * changed, so a caller can store it without looping.
 *
 * An empty answer to an ask whose size changed keeps the picture: a resize is
 * not a mod taking its theme away. The next empty answer at that size is.
 */
export function stepModLiveSite<T>(
  memo: ModLiveMemo<T>,
  answer: ModSiteAnswer<T>,
  snapshot: ModSiteSnapshot,
): { memo: ModLiveMemo<T>; live: ModLiveSite<T> } {
  if (answer.kind === 'waiting') return { memo: EMPTY_MEMO, live: WAITING }
  if (answer.kind === 'active') {
    const sizeKey = sizeKeyOf(snapshot)
    const same = memo.shown === answer.value && memo.sizeKey === sizeKey && !memo.held && !memo.cleared
    return { memo: same ? memo : { shown: answer.value, sizeKey, held: null, cleared: null }, live: answer }
  }
  if (memo.shown) {
    if (snapshot === memo.held) return { memo, live: { kind: 'active', value: memo.shown } }
    const sizeKey = sizeKeyOf(snapshot)
    if (answer.kind === 'empty' && sizeKey !== memo.sizeKey) {
      return { memo: { ...memo, sizeKey, held: snapshot }, live: { kind: 'active', value: memo.shown } }
    }
    return { memo: { ...EMPTY_MEMO, cleared: memo.shown }, live: { kind: 'cleared', previous: memo.shown } }
  }
  if (memo.cleared) return { memo, live: { kind: 'cleared', previous: memo.cleared } }
  return { memo, live: answer.kind === 'empty' ? EMPTY : UNHOOKED }
}

/** What to draw: the live value; before the session answers, the remembered one. */
export function modLiveSiteValue<T>(live: ModLiveSite<T>, remembered: T | null | undefined): T | null {
  if (live.kind === 'active') return live.value
  if (live.kind === 'waiting' || live.kind === 'empty') return remembered ?? null
  return null
}
