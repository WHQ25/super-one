/**
 * A Claude theme can show the other appearance without writing the saved
 * theme mode. Preview still uses setTheme. Apply only holds the document
 * class, and a manual appearance change clears the hold.
 */

type Scheme = 'light' | 'dark'

let hold: Scheme | null = null
let suppress = 0
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

export function subscribeHarnessScheme(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function harnessSchemeHold(): Scheme | null {
  return hold
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

export function holdHarnessScheme(scheme: Scheme | null): void {
  hold = scheme
  const saved = rememberScroll()
  if (scheme) document.documentElement.classList.toggle('dark', scheme === 'dark')
  restoreScroll(saved)
  requestAnimationFrame(() => restoreScroll(saved))
  emit()
}

/** The next theme-change event is one we caused by restoring the saved mode. */
export function suppressNextThemeChange(): void {
  suppress += 1
}

export function takeSuppressedThemeChange(): boolean {
  if (suppress === 0) return false
  suppress -= 1
  return true
}

export function resetHarnessSchemeForTests(): void {
  hold = null
  suppress = 0
  emit()
}
