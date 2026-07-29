/**
 * Bridges the helper's status-menu Stop action back into session control.
 *
 * The helper cannot interrupt anything itself — it only draws overlays. If Stop
 * merely hid the overlay locally, the user would believe control had stopped
 * while the agent kept clicking, which is worse than having no Stop at all. So
 * the helper emits an event and the interrupt happens here, on the host.
 */
import type { HelperEvent } from './platform/helper-protocol'
import { getSharedHelperClient } from './platform/macos-helper-client'

export type InterruptSession = (sessionId: string) => void

let unsubscribe: (() => void) | null = null

/** Exported for tests: routes one event to the interrupt callback. */
export function handleHelperStopEvent(event: HelperEvent, interrupt: InterruptSession): void {
  if (event.event !== 'computer_use_stop_requested') return
  const raw = (event as { sessionIds?: unknown }).sessionIds
  const ids = Array.isArray(raw) ? raw : []
  const seen = new Set<string>()
  for (const id of ids) {
    if (typeof id !== 'string' || !id || seen.has(id)) continue
    seen.add(id)
    interrupt(id)
  }
}

/**
 * Subscribe to helper stop events. Safe to call repeatedly — the previous
 * subscription is dropped so a re-init cannot double-interrupt.
 */
export function wireComputerUseStopBridge(interrupt: InterruptSession): void {
  unsubscribe?.()
  unsubscribe = getSharedHelperClient().onEvent((event) => {
    handleHelperStopEvent(event, interrupt)
  })
}

export function unwireComputerUseStopBridge(): void {
  unsubscribe?.()
  unsubscribe = null
}
