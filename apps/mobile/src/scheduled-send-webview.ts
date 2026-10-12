import type { ScheduledSendControls } from './navigation/use-scheduled-send'

/** The document channel is validated before this runs; reject stale card actions too. */
export function handleScheduledSendAction(raw: string, controls?: ScheduledSendControls): boolean {
  let event: { type?: unknown; sessionId?: unknown; sendAt?: unknown; action?: unknown }
  try { event = JSON.parse(raw) } catch { return false }
  if (!event || event.type !== 'scheduledSendAction') return false
  const row = controls?.scheduled
  if (!controls || !row || !controls.available || controls.busy || row.source !== 'rate_limit'
    || event.sessionId !== row.sessionId || event.sendAt !== row.sendAt) return true
  const action = event.action === 'accept' && !row.armed ? controls.accept
    : event.action === 'cancel' && row.armed ? controls.cancel
      : event.action === 'dismiss' && !row.armed ? controls.dismiss : null
  if (action) void action().catch(() => {}) // The controller surfaces its rejected RPC.
  return true
}
