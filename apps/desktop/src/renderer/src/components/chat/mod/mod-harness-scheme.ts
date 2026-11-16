/**
 * A Claude mod theme is made for a light or a dark window
 * (`overrideColorScheme`). While the active session shows one, the window
 * holds that appearance on the document class only: the saved theme mode is
 * never written. A manual appearance change wins until the theme's scheme
 * changes or the theme goes.
 */

type Scheme = 'light' | 'dark'

let requested: Scheme | null = null
let dismissed: Scheme | null = null
const listeners = new Set<() => void>()

export function subscribeHarnessScheme(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** The appearance the window holds for a mod theme, or null to follow the saved mode. */
export function harnessSchemeHold(): Scheme | null {
  return requested && requested !== dismissed ? requested : null
}

function rememberScroll(): Array<[HTMLElement, number]> {
  const saved: Array<[HTMLElement, number]> = []
  for (const root of document.querySelectorAll<HTMLElement>('[data-chat-root]')) {
    const nodes = [root, ...root.querySelectorAll<HTMLElement>('*')]
    for (const el of nodes) {
      if (el.scrollTop > 0) saved.push([el, el.scrollTop])
    }
  }
  return saved
}

function restoreScroll(saved: Array<[HTMLElement, number]>): void {
  for (const [el, top] of saved) el.scrollTop = top
}

function update(next: () => void): void {
  const before = harnessSchemeHold()
  next()
  const hold = harnessSchemeHold()
  if (hold === before) return
  if (hold && typeof document !== 'undefined') {
    // Switching the class re-lays out the transcript; keep where the reader was.
    const saved = rememberScroll()
    document.documentElement.classList.toggle('dark', hold === 'dark')
    restoreScroll(saved)
    requestAnimationFrame(() => restoreScroll(saved))
  }
  for (const listener of listeners) listener()
}

/** The active session's mod theme asks for `scheme`; null when it shows none. */
export function requestHarnessScheme(scheme: Scheme | null): void {
  if (scheme === requested) return
  update(() => {
    requested = scheme
    dismissed = null
  })
}

/** The person changed the appearance: stop holding until the theme asks again. */
export function dismissHarnessScheme(): void {
  if (!requested || dismissed === requested) return
  update(() => {
    dismissed = requested
  })
}

export function resetHarnessSchemeForTests(): void {
  requested = null
  dismissed = null
  for (const listener of listeners) listener()
}
