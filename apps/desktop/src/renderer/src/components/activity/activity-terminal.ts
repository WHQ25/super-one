import { useEffect, useState } from 'react'
import type { TerminalAgentControl } from '@superone/shared/agent-types'
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

/**
 * Whether an agent currently drives this tab's command. Seeds from the PTY list
 * (the tab may mount after the grant) and then follows `terminal_control_changed`.
 */
export function useTerminalAgentControl(terminalId: string): TerminalAgentControl | null {
  const [control, setControl] = useState<TerminalAgentControl | null>(null)
  useEffect(() => {
    let cancelled = false
    void window.terminal.list().then((items) => {
      if (cancelled) return
      setControl(items.find((item) => item.terminalId === terminalId)?.agentControl ?? null)
    })
    const off = window.terminal.onTerminalEvent((event) => {
      if (event.type === 'terminal_control_changed' && event.terminalId === terminalId) setControl(event.control)
    })
    return () => {
      cancelled = true
      off()
    }
  }, [terminalId])
  return control
}
