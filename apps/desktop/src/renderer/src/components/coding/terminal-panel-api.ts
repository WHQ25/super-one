let closeActive: (() => void) | null = null

export function setCloseActiveTerminal(fn: (() => void) | null): void {
  closeActive = fn
}

export function closeActiveTerminal(): boolean {
  if (!closeActive) return false
  closeActive()
  return true
}
