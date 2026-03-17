import log from '../logger'
import { trace } from '../agent/event-trace'

interface GateEntry {
  resolve?: () => void
  startMs: number
  ready: boolean
}

const gates = new Map<string, GateEntry>()

export function waitForWidgetReady(widgetId: string): Promise<void> {
  const existing = gates.get(widgetId)
  if (existing?.ready) {
    const elapsed = Date.now() - existing.startMs
    log.info(`[widget-gate] wait title="${widgetId}" — already ready (${elapsed}ms)`)
    trace('widget.gate', 'wait_already_ready', { title: widgetId, elapsed })
    gates.delete(widgetId)
    return Promise.resolve()
  }
  const startMs = existing?.startMs ?? Date.now()
  log.info(`[widget-gate] wait title="${widgetId}"`)
  trace('widget.gate', 'wait', { title: widgetId })
  return new Promise<void>((resolve) => {
    gates.set(widgetId, { resolve, startMs, ready: false })
  })
}

export function clearAllGates(): void {
  for (const [id, entry] of gates) {
    log.info(`[widget-gate] clearing title="${id}"`)
    entry.resolve?.()
  }
  gates.clear()
}

export function notifyWidgetReady(widgetId: string): void {
  const entry = gates.get(widgetId)
  if (entry?.resolve) {
    const elapsed = Date.now() - entry.startMs
    log.info(`[widget-gate] ready title="${widgetId}" after ${elapsed}ms`)
    trace('widget.gate', 'ready', { title: widgetId, elapsed })
    gates.delete(widgetId)
    entry.resolve()
  } else {
    log.info(`[widget-gate] notify title="${widgetId}" — early (wait not yet called)`)
    trace('widget.gate', 'notify_early', { title: widgetId })
    gates.set(widgetId, { startMs: Date.now(), ready: true })
  }
}
