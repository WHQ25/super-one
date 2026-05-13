/* eslint-disable no-undef */
// Headless service: runs in a Node worker_thread spawned per tool call.
// `globalThis.superone` is injected by the platform bootstrap.

const KEY = 'counter'

superone.tools.handle('increment', async ({ by }) => {
  const amount = typeof by === 'number' && Number.isFinite(by) ? by : 1
  const current = (await superone.kv.get(KEY)) ?? 0
  const next = current + amount
  await superone.kv.set(KEY, next)
  superone.peer.emit('count-changed', { value: next, delta: amount, at: Date.now() })
  return { ok: true, previous: current, value: next }
})

superone.tools.handle('read_counter', async () => {
  const value = (await superone.kv.get(KEY)) ?? 0
  return { value }
})

superone.tools.handle('reset', async () => {
  await superone.kv.set(KEY, 0)
  superone.peer.emit('count-changed', { value: 0, delta: 0, reset: true, at: Date.now() })
  return { ok: true, value: 0 }
})

superone.tools.handle('show_counter', async () => {
  // Stub for the panel-bound tool. The platform will throw before reaching this
  // because show_counter is registered as a non-headless tool (headless=false).
  // Including a placeholder here is safe — bootstrap dispatcher won't call it
  // unless the dispatcher routes here, which it won't for headless=false.
  return { ok: false, message: 'show_counter should be served by the panel UI handler' }
})
