import type { TermInstance } from '@/stores/terminal'
import { applyTerminalEvent, createBaseXterm, disposeTermInstance } from '@/components/coding/term-instance'

// Activity-panel terminals keep their own instance registry, fully decoupled
// from the bottom terminal panel (which keys off useTerminalStore.instances).
// window.terminal.onTerminalEvent is a global broadcast and each track only
// writes to xterms it owns, so a terminalId living here is invisible to the
// bottom panel's listener — the two tracks never double-write the same buffer.
const activityInstances = new Map<string, TermInstance>()

export function getActivityTermInstance(terminalId: string): TermInstance | undefined {
  return activityInstances.get(terminalId)
}

export function ensureActivityTermInstance(terminalId: string): TermInstance {
  const existing = activityInstances.get(terminalId)
  if (existing) return existing
  const { xterm, fit, search } = createBaseXterm()
  xterm.onData((data) => {
    if (activityInstances.get(terminalId)?.writable === false) return
    void window.terminal.write(terminalId, data)
  })
  const inst: TermInstance = { xterm, fit, search, lastSeq: 0, writable: true, chunks: new Map() }
  activityInstances.set(terminalId, inst)
  return inst
}

export function feedActivityTerminal(terminalId: string, event: Parameters<typeof applyTerminalEvent>[1]): void {
  const inst = activityInstances.get(terminalId)
  if (inst) applyTerminalEvent(inst, event)
}

export function disposeActivityTermInstance(terminalId: string): void {
  const inst = activityInstances.get(terminalId)
  if (!inst) return
  disposeTermInstance(inst)
  activityInstances.delete(terminalId)
}
