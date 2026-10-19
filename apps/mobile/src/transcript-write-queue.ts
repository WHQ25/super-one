type Job = () => void

const pending = new Map<string, Job>()
let coverHolds = 0
let scheduled = false

/**
 * One latest write per session. The blob is stringified when the JS thread is
 * idle after every transcript cover drops, or immediately when the app
 * backgrounds. A later enqueue for the same key replaces the earlier snapshot.
 *
 * @returns this hold's release. It drops the hold once, however often it is called.
 */
export function holdTranscriptCover(): () => void {
  coverHolds += 1
  let held = true
  return () => {
    if (!held) return
    held = false
    coverHolds -= 1
    if (coverHolds === 0) scheduleTranscriptWrites()
  }
}

export function enqueueTranscriptWrite(key: string, job: Job): void {
  pending.set(key, job)
  scheduleTranscriptWrites()
}

/** Run every pending write now. Backgrounding cannot wait for idle. */
export function flushTranscriptWrites(): void {
  scheduled = false
  const jobs = [...pending.values()]
  pending.clear()
  if (!jobs.length) return
  const started = performance.now()
  for (const job of jobs) {
    try { job() }
    catch { /* persistence is best-effort; the host remains authoritative */ }
  }
  console.info('[TranscriptWrite]', { writes: jobs.length, ms: performance.now() - started })
}

function scheduleTranscriptWrites(): void {
  if (coverHolds > 0 || scheduled || pending.size === 0) return
  scheduled = true
  const run = () => {
    scheduled = false
    if (coverHolds > 0) return
    flushTranscriptWrites()
  }
  const ric = (globalThis as { requestIdleCallback?: (callback: () => void) => number }).requestIdleCallback
  if (typeof ric === 'function') ric(run)
  else setTimeout(run, 0)
}
