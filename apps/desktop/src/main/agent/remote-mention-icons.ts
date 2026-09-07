import { createHash } from 'node:crypto'

/**
 * Content-addressed icons for remote mention rows.
 *
 * A phone re-runs `search_mentions` on every keystroke, and the icons are the
 * bulk of the answer: up to a dozen desktop apps and a dozen mini-apps, each a
 * PNG data URI. Sending an id instead lets the device keep the bytes and ask
 * only for what it has never seen — and because the id is a hash of the bytes,
 * a cached icon stays valid exactly as long as the artwork does.
 *
 * The registry is per process and bounded: it exists so an id the client asks
 * about can be answered, not as a second copy of the icon caches upstream.
 */
const MAX_REGISTERED_ICONS = 256

const icons = new Map<string, string>()

export function mentionIconId(dataUri: string): string {
  return createHash('sha256').update(dataUri).digest('hex').slice(0, 16)
}

/** Register an icon and return the id that fetches it back. */
export function registerMentionIcon(dataUri: string | undefined): string | undefined {
  if (!dataUri) return undefined
  const id = mentionIconId(dataUri)
  // Re-insert so the most recently offered ids are the last to be evicted.
  icons.delete(id)
  icons.set(id, dataUri)
  while (icons.size > MAX_REGISTERED_ICONS) {
    const oldest = icons.keys().next()
    if (oldest.done) break
    icons.delete(oldest.value)
  }
  return id
}

/**
 * Look up icons by id.
 *
 * An id this process no longer holds is simply absent from the result rather
 * than an error: the client falls back to a generic glyph, which is what it
 * would have shown anyway.
 */
export function lookupMentionIcons(ids: readonly string[]): Record<string, string> {
  const found: Record<string, string> = {}
  for (const id of ids) {
    const uri = icons.get(id)
    if (uri) found[id] = uri
  }
  return found
}

/** Test seam: the registry is process-wide and would otherwise leak between cases. */
export function resetMentionIconRegistry(): void {
  icons.clear()
}
