let closeActive: (() => void) | null = null
let createNew: (() => void) | null = null

export function setCloseActiveTerminal(fn: (() => void) | null): void {
  closeActive = fn
}

export function closeActiveTerminal(): boolean {
  if (!closeActive) return false
  closeActive()
  return true
}

export function setCreateTerminal(fn: (() => void) | null): void {
  createNew = fn
}

export function createNewTerminal(): boolean {
  if (!createNew) return false
  createNew()
  return true
}
