/// <reference path="./superone.d.ts" />
// Background worker entry. This file must stay React-free — it runs in a
// headless offscreen page (`superone.self`), not in the panel SPA.

type Progress = { received: number; total: number; percent: number }

const self_ = window.superone.self!
let current: Progress | null = null

function emit(type: string, data: Record<string, unknown> = {}): void {
  self_.postMessage({ type, ...data })
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function runDownload(src: string, dest: string): Promise<void> {
  // keepAlive prevents the 30s idle reclaim while real work is in flight.
  const lease = self_.keepAlive('download ' + dest)
  try {
    const ckptKey = 'dl:' + dest
    const ckpt = ((await window.superone.kv.get<{ received: number }>(ckptKey)) || {
      received: 0,
    }) as { received: number }

    const res = await fetch(src)
    const total = Number(res.headers.get('content-length') || 0)
    const reader = res.body!.getReader()
    let received = 0
    let first = true

    for (;;) {
      const step = await reader.read()
      if (step.done) break
      const chunk = step.value
      await window.superone.fs.writeFile(dest, chunk, {
        append: !first || ckpt.received > 0,
      })
      first = false
      received += chunk.byteLength
      current = {
        received,
        total,
        percent: total ? Math.floor((received / total) * 100) : 0,
      }
      await window.superone.kv.set(ckptKey, { received })
      self_.setStatus('Downloading ' + current.percent + '%')
      emit('progress', current)
      // Artificial pacing so the progress bar is visible in the demo.
      await delay(450)
    }

    await window.superone.kv.delete(ckptKey)
    current = null
    self_.setStatus('')
    emit('done', { path: dest, bytes: received })
  } finally {
    lease.release()
  }
}

self_.onMessage((raw) => {
  const msg = raw as { type?: string; src?: string; dest?: string }
  if (!msg) return
  if (msg.type === 'query') {
    if (current) emit('progress', current)
    return
  }
  if (msg.type === 'download') {
    runDownload(msg.src || 'logo.png', msg.dest || 'downloads/logo-copy.png').catch((e) =>
      emit('error', { error: String(e) }),
    )
  }
})

emit('ready')
