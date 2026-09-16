/**
 * Grok Auto under Generic (`clientIdentifier=superone`) auto-denies classifier
 * blocks instead of prompting. Toast once per renderer lifetime so selecting
 * Auto is not silent fail-closed.
 */
let toasted = false

export function resetAcpAutoFailClosedToastForTests(): void {
  toasted = false
}

export function noteAcpAutoFailClosed(show: (message: string) => void, message: string): void {
  if (toasted) return
  toasted = true
  show(message)
}
