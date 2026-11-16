/**
 * What each session's mod theme asks of the window around it: the tint to mix
 * into the sidebar and activity panel while the theme is painted, and the
 * light or dark window it was made for. The shell reads the active session.
 * This never writes the saved appearance.
 */

type Scheme = 'light' | 'dark'

export interface ModChrome {
  /** Empty while the theme is not painted. */
  tint: string
  /** Empty when the theme names no scheme. */
  scheme: Scheme | ''
}

const chromes = new Map<string, ModChrome>()
let snapshot = new Map<string, ModChrome>()
const listeners = new Set<() => void>()

function emit(): void {
  snapshot = new Map(chromes)
  for (const listener of listeners) listener()
}

/** Publishes one session's chrome; null or an empty chrome withdraws it. */
export function publishModChrome(sessionId: string, chrome: ModChrome | null): void {
  const id = sessionId.trim()
  if (!id) return
  const prev = chromes.get(id)
  if (chrome && (chrome.tint || chrome.scheme)) {
    if (prev && prev.tint === chrome.tint && prev.scheme === chrome.scheme) return
    chromes.set(id, { tint: chrome.tint, scheme: chrome.scheme })
  } else if (prev === undefined) {
    return
  } else {
    chromes.delete(id)
  }
  emit()
}

export function subscribeModChromeTint(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Tint for one session. Empty string when that session is not tinting the shell. */
export function getModChromeTint(sessionId: string | null | undefined): string {
  if (!sessionId) return ''
  return snapshot.get(sessionId.trim())?.tint ?? ''
}

/** Light or dark window the session's theme was made for. Empty when it did not say. */
export function getModChromeScheme(sessionId: string | null | undefined): Scheme | '' {
  if (!sessionId) return ''
  return snapshot.get(sessionId.trim())?.scheme ?? ''
}

export function resetModChromeTintForTests(): void {
  chromes.clear()
  emit()
}
