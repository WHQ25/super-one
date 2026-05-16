# superone Background Worker — `superone.worker` & `superone.self`

A **background worker** is a headless, offscreen page that keeps running after the panel is closed. Use it for work that must outlive the UI: long downloads, polling, queued uploads, scheduled compute.

The worker is a separate sandboxed process with **no DOM the user ever sees**. It has the full `superone` API (`fs`, `kv`, `git`, `fetch`, …) with the **same permissions as the panel**. There are two sides:

- **Panel side** — `superone.worker.*`: start/stop the worker and message it.
- **Worker side** — `superone.self.*`: receive/send messages, set a status label, hold the worker alive.

## Prerequisites (manifest)

A worker requires **both** a background entry file and the background permission:

```json
{
  "background": { "entry": "background.html" },
  "permissions": {
    "background": { "reason": "Finish the download even when the panel is closed" }
  }
}
```

- `background.entry` — relative path to the worker's HTML file (`^[a-z0-9][a-z0-9_./-]*\.html$`). The bridge is auto-injected; inside it `superone.self` is available.
- `permissions.background.reason` — shown to the user at install. Without it, `worker.start()` rejects.

The worker also inherits the app's `permissions.fs` / `permissions.network` / `permissions.storage` / `permissions.media`, so declare those normally if the worker needs them.

> **React/Vite template:** `background.entry` is a **separate Vite entry**, not part of your React SPA, and the worker is pure logic — **do not import React into it**. Add it to `rollupOptions.input` and point `background.entry` at the built HTML. See the "React / Vite — Multi-Page Entries" section in the `manifest` topic. (Vanilla template: just author `background.html` directly.)

## Panel side — `superone.worker`

```js
const status = await superone.worker.start()   // { running: true, since: <ms> }
await superone.worker.status()                  // { running, since?, statusText? }
await superone.worker.stop()                    // { running: false }

superone.worker.postMessage({ type: 'download', src: url })
const off = superone.worker.onMessage((msg) => {
  if (msg.type === 'progress') render(msg.percent)
})
// off() to stop listening
```

| Method | Returns | Description |
|--------|---------|-------------|
| `start()` | `Promise<{ running, since? }>` | Spawn the worker (idempotent — returns the existing one if already running). Rejects if `background.entry` or `permissions.background` is missing. |
| `stop()` | `Promise<{ running: false }>` | Terminate the worker immediately. |
| `status()` | `Promise<{ running, since?, statusText? }>` | Current state. `statusText` is whatever the worker last set via `self.setStatus`. |
| `postMessage(msg)` | `void` | Fire-and-forget message to the worker. Structured-clonable payload. |
| `onMessage(cb)` | `() => void` | Subscribe to messages from the worker. Returns an unsubscribe function. |

The worker is **not auto-started** — call `start()` explicitly (e.g. when the user kicks off a job). It is a singleton per (project, app).

## Worker side — `superone.self`

Inside `background.entry`:

```js
superone.self.onMessage((msg) => {
  if (msg.type === 'download') runDownload(msg.src)
})

function emit(type, data) {
  superone.self.postMessage(Object.assign({ type }, data))
}

async function runDownload(src) {
  const lease = superone.self.keepAlive('download')   // block idle reclaim
  try {
    // … long-running work; use superone.fs / superone.kv / fetch …
    superone.self.setStatus('Downloading 42%')
    emit('progress', { percent: 42 })
  } finally {
    lease.release()                                    // allow idle reclaim
  }
}

emit('ready', {})   // tell the panel the worker is up
```

| Method | Description |
|--------|-------------|
| `onMessage(cb)` | Receive messages sent by the panel via `worker.postMessage`. Returns an unsubscribe function. |
| `postMessage(msg)` | Send a message to the panel's `worker.onMessage`. |
| `setStatus(text)` | Set a short status label (≤120 chars) shown in the sidebar's worker group. Pass `''` to clear. |
| `keepAlive(label)` | Take a lease that prevents idle reclaim. Returns `{ release() }` — **always release it in a `finally`**. |

## Lifecycle & Reclaim

The worker is reclaimed automatically — you do not need to babysit it, but you **must** use `keepAlive` while doing real work:

| Trigger | Effect |
|---------|--------|
| Panel closed / panel↔canvas switch / app closed | Worker **keeps running** (it is a separate process). |
| **Idle 30s** with no active `keepAlive` lease | Worker auto-stops. |
| Active `keepAlive` lease | Idle timer is suspended until every lease is released. |
| **Runaway guard: 6h** | Hard cap — worker is reclaimed even with leases held. Re-`start()` and resume from a checkpoint for longer jobs. |
| App quit with a live worker | User gets a confirmation prompt; on quit, all workers stop. |

**Rule:** wrap every unit of background work in `keepAlive(label) … finally lease.release()`. Without a lease, a worker that's mid-task can be reclaimed after 30s.

## Messaging Guarantees

- Messages are buffered when the other side isn't ready yet (worker still booting, or no `onMessage` listener attached): up to **100 messages / 256 KB / 60 s TTL**, oldest dropped first.
- Have the worker `emit('ready', {})` on boot, and the panel send a `{ type: 'query' }` so a freshly opened panel can re-sync current progress from a worker that's already running.
- Payloads must be structured-clonable (no functions/DOM nodes).

## Resumable Work (checkpoint with `superone.kv`)

The 6h runaway cap and user-initiated stops mean long jobs should checkpoint so a re-`start()` resumes instead of restarting:

```js
async function runDownload(src, dest) {
  const lease = superone.self.keepAlive('download ' + dest)
  try {
    const ckptKey = 'dl:' + dest
    const ckpt = (await superone.kv.get(ckptKey)) || { received: 0 }
    const res = await fetch(src)
    const reader = res.body.getReader()
    let received = ckpt.received
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      await superone.fs.writeFile(dest, value, { append: received > 0 })
      received += value.byteLength
      await superone.kv.set(ckptKey, { received })
      superone.self.setStatus('Downloading ' + received + ' bytes')
      superone.self.postMessage({ type: 'progress', received })
    }
    await superone.kv.delete(ckptKey)
    superone.self.setStatus('')
    superone.self.postMessage({ type: 'done', path: dest, bytes: received })
  } finally {
    lease.release()
  }
}
```

A full working example ships in the `hello` demo app (`background.html`). See the `recipes` topic for the panel↔worker wiring pattern.

## Related Topics

- `manifest` — `background.entry` field
- `permissions` — `permissions.background`
- `api-fs` — file read/write from the worker
- `recipes` — background-download end-to-end pattern
