import log from '../logger'
import { trace } from '../agent/event-trace'

interface Waiter {
  resolve: () => void
  startMs: number
}

interface GateEntry {
  waiters: Waiter[]
  ready: number
}

const gates = new Map<string, GateEntry>()

function entryFor(widgetId: string): GateEntry {
  const existing = gates.get(widgetId)
  if (existing) return existing
  const created: GateEntry = { waiters: [], ready: 0 }
  gates.set(widgetId, created)
  return created
}

function dropIfIdle(widgetId: string, entry: GateEntry): void {
  if (entry.waiters.length === 0 && entry.ready === 0) gates.delete(widgetId)
}

export function waitForWidgetReady(widgetId: string): Promise<void> {
  const entry = entryFor(widgetId)
  if (entry.ready > 0) {
    entry.ready--
    log.info(`[widget-gate] wait title="${widgetId}" — already ready`)
    trace('widget.gate', 'wait_already_ready', { title: widgetId })
    dropIfIdle(widgetId, entry)
    return Promise.resolve()
  }
  log.info(`[widget-gate] wait title="${widgetId}"`)
  trace('widget.gate', 'wait', { title: widgetId })
  return new Promise<void>((resolve) => {
    entry.waiters.push({ resolve, startMs: Date.now() })
  })
}

export function clearAllGates(): void {
  for (const [id, entry] of gates) {
    for (const waiter of entry.waiters) {
      log.info(`[widget-gate] clearing title="${id}"`)
      waiter.resolve()
    }
  }
  gates.clear()
}

export function notifyWidgetReady(widgetId: string): void {
  const entry = entryFor(widgetId)
  const waiter = entry.waiters.shift()
  if (waiter) {
    const elapsed = Date.now() - waiter.startMs
    log.info(`[widget-gate] ready title="${widgetId}" after ${elapsed}ms`)
    trace('widget.gate', 'ready', { title: widgetId, elapsed })
    waiter.resolve()
    dropIfIdle(widgetId, entry)
    return
  }
  entry.ready++
  log.info(`[widget-gate] notify title="${widgetId}" — early (wait not yet called)`)
  trace('widget.gate', 'notify_early', { title: widgetId })
}
