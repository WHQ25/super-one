/**
 * Backdrop tint of each session that is currently drawing a mod theme.
 * The shell reads the active session and recolors the sidebar and activity
 * panel. This never writes the saved appearance.
 */

interface ChromeTint {
  tint: string
  scheme: 'light' | 'dark' | ''
}

const tints = new Map<string, ChromeTint>()
let snapshot = new Map<string, ChromeTint>()
const listeners = new Set<() => void>()

function emit(): void {
  snapshot = new Map(tints)
  for (const listener of listeners) listener()
}

export function publishModChromeTint(sessionId: string, tint: string | null, scheme?: 'light' | 'dark'): void {
  const id = sessionId.trim()
  if (!id) return
  const prev = tints.get(id)
  if (tint) {
    const next: ChromeTint = { tint, scheme: scheme ?? '' }
    if (prev && prev.tint === next.tint && prev.scheme === next.scheme) return
    tints.set(id, next)
  } else if (prev === undefined) {
    return
  } else {
    tints.delete(id)
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

/** Light or dark window the backdrop was made for. Empty when the backdrop did not say. */
export function getModChromeScheme(sessionId: string | null | undefined): 'light' | 'dark' | '' {
  if (!sessionId) return ''
  return snapshot.get(sessionId.trim())?.scheme ?? ''
}

export function resetModChromeTintForTests(): void {
  tints.clear()
  emit()
}
