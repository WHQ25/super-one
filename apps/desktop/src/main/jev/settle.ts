/**
 * Settling and change-waiting for adapters that can only sample from outside.
 *
 * The browser waits inside the page: one CDP round trip installs a 30ms tick
 * that watches the observation marker and resolves when it holds still. The
 * desktop and a device have no such place to stand — every sample is a fresh
 * accessibility read across a process boundary, which costs orders of magnitude
 * more. So these poll, at a rate that reflects that cost, on a smaller budget.
 *
 * What they watch is the same thing the browser watches: the *observation* the
 * loop reacts to, not the platform's own idea of a state. A menu opening under
 * a CSS-like animation reveals elements without any single "changed" event, and
 * a whole-outline hash churns on focus flags between two reads of the same
 * window — so the signature covers exactly the fields a decision is made from.
 */

import type { SettleReport } from './loop'
import type { RawElement, RunObservation } from './observation'

/** One cross-process read each; a page can sample 5x faster for free. */
const POLL_MS = 150
/**
 * The floor for any poll. An adapter whose own observe settles is throttled by
 * that read, but the loop must not depend on it: a read that returns instantly
 * would spin, and with no delay the deadline is only reached if observe happens
 * to be slow.
 */
export const SETTLED_ADAPTER_POLL_MS = 25
/**
 * Total budget for a post-action settle. The browser allows 2s of near-free
 * sampling. Exported so an adapter can tell when the action itself already
 * outlasted it — see the computer adapter's settle.
 */
export const SETTLE_BUDGET_MS = 1500
/** Unchanged this long after an action means the action changed nothing. */
const SETTLE_GRACE_MS = 600

export interface SettleClock {
  now(): number
  sleep(ms: number, signal?: AbortSignal): Promise<void>
}

const realClock: SettleClock = {
  now: () => Date.now(),
  sleep: (ms, signal) => new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason) }, { once: true })
  }),
}

/**
 * The facts a decision is made from: the text Jev is shown, which elements are
 * there, what they say, and what state they are in. Deliberately not the
 * platform's raw tree, whose focus flags churn between two reads of one window.
 *
 * `text` has to be in it. A calculator press moves nothing but the display, and
 * the display is a static label — every element keeps its role, label and
 * value, so a signature over elements alone calls the whole calculation
 * "unchanged" and settles on a screen that is still mid-update.
 */
export function observationSignature(page: RunObservation): string {
  return JSON.stringify([
    page.title,
    page.text,
    page.elements.length,
    page.elements.map((e: RawElement) => [e.node, e.role, e.label, e.value, e.checked, e.selected, e.expanded, e.disabled]),
  ])
}

/**
 * Wait for the observation to differ from `page` and then hold still, the way
 * `settleAfter` does for a browser page.
 *
 * Returns the last observation taken so the caller can hand it to the next
 * `observe()` instead of paying for one more read.
 */
export async function settleByPolling<Page extends RunObservation>(
  page: Page,
  observe: (signal?: AbortSignal) => Promise<Page>,
  signal?: AbortSignal,
  { clock = realClock }: { clock?: SettleClock } = {},
): Promise<{ report: SettleReport; page: Page | null }> {
  const before = observationSignature(page)
  const start = clock.now()
  const deadline = start + SETTLE_BUDGET_MS
  let previous: string | null = null

  for (;;) {
    signal?.throwIfAborted()
    await clock.sleep(POLL_MS, signal)
    const latest = await observe(signal)
    const current = observationSignature(latest)

    if (current === before) {
      // Nothing yet. A settled surface that never moved means the action did
      // nothing, and waiting out the whole budget would only slow the run.
      if (!latest.loading && clock.now() - start >= SETTLE_GRACE_MS) {
        return { report: { changed: false, fields: ['unchanged'], elements: latest.elements.length }, page: latest }
      }
    } else if (current === previous && !latest.loading) {
      return { report: { changed: true, fields: ['observation'], elements: latest.elements.length }, page: latest }
    }

    previous = current
    if (clock.now() >= deadline) {
      return {
        report: { changed: current !== before, fields: ['budget'], elements: latest.elements.length },
        page: latest,
      }
    }
  }
}

/**
 * Jev asked to wait: resolve as soon as the observation differs from `page`.
 *
 * The loop has a fallback for adapters without this, but it decides by asking
 * `changed(before, after)` — and an adapter whose `changed` reads the last
 * action's verdict rather than comparing observations can never answer it, so
 * every wait would burn its whole cap.
 */
export async function waitForChangeByPolling<Page extends RunObservation>(
  page: Page,
  timeoutMs: number,
  observe: (signal?: AbortSignal) => Promise<Page>,
  signal?: AbortSignal,
  // An adapter whose own observe already settles (a device samples the screen
  // until the pixels hold still) passes SETTLED_ADAPTER_POLL_MS: waiting the
  // full interval on top of that read would spend the cap waiting twice.
  { clock = realClock, pollMs = POLL_MS }: { clock?: SettleClock; pollMs?: number } = {},
): Promise<boolean> {
  const before = observationSignature(page)
  const deadline = clock.now() + timeoutMs
  for (;;) {
    signal?.throwIfAborted()
    const next = await observe(signal)
    if (observationSignature(next) !== before) return true
    if (clock.now() >= deadline) return false
    await clock.sleep(Math.max(pollMs, SETTLED_ADAPTER_POLL_MS), signal)
  }
}

/** Machine loading signal: hold until the surface reports it is no longer moving. */
export async function waitReadyByPolling<Page extends RunObservation>(
  timeoutMs: number,
  observe: (signal?: AbortSignal) => Promise<Page>,
  signal?: AbortSignal,
  { clock = realClock, pollMs = POLL_MS }: { clock?: SettleClock; pollMs?: number } = {},
): Promise<boolean> {
  const deadline = clock.now() + timeoutMs
  for (;;) {
    signal?.throwIfAborted()
    if (!(await observe(signal)).loading) return true
    if (clock.now() >= deadline) return false
    await clock.sleep(Math.max(pollMs, SETTLED_ADAPTER_POLL_MS), signal)
  }
}
