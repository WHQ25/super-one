import type { PostHog } from 'posthog-js'

declare const __APP_VERSION__: string
declare const __POSTHOG_PROJECT_TOKEN__: string
declare const __POSTHOG_HOST__: string

const POSTHOG_KEY = __POSTHOG_PROJECT_TOKEN__
const POSTHOG_HOST = __POSTHOG_HOST__ || 'https://us.i.posthog.com'

/** Local-only accumulation tick. Never hits the network. */
const TICK_MS = 15_000
/** How often the accumulated active time is turned into one `app_usage` event. */
const FLUSH_MS = 60 * 60_000
/** Windows shorter than this are noise; drop them instead of paying for an event. */
const MIN_REPORT_MS = 60_000
const ACTIVE_MS_KEY = 'superone.analytics.active_ms'
const LAST_VERSION_KEY = 'superone.analytics.last_version'

let ph: PostHog | null = null
let activeMs = 0
let tickTimer: ReturnType<typeof setInterval> | null = null
let flushTimer: ReturnType<typeof setInterval> | null = null

function baseProps(): Record<string, unknown> {
  return { app_version: __APP_VERSION__, platform: window.app.platform }
}

function isActive(): boolean {
  return document.visibilityState === 'visible' && document.hasFocus()
}

function captureUsage(ms: number, recovered: boolean) {
  if (ms < MIN_REPORT_MS) return
  ph?.capture('app_usage', {
    active_seconds: Math.round(ms / 1000),
    recovered,
    ...baseProps(),
  })
}

function tick() {
  if (!isActive()) return
  activeMs += TICK_MS
  // Persist every tick so a crash / force-quit loses at most one tick, which is
  // what lets FLUSH_MS stay this long without risking a whole hour of data.
  window.localStorage.setItem(ACTIVE_MS_KEY, String(activeMs))
}

function flushUsage() {
  const ms = activeMs
  activeMs = 0
  window.localStorage.removeItem(ACTIVE_MS_KEY)
  captureUsage(ms, false)
}

/** Report the window a previous run left behind when it died before flushing. */
function reportRecoveredUsage() {
  const raw = window.localStorage.getItem(ACTIVE_MS_KEY)
  window.localStorage.removeItem(ACTIVE_MS_KEY)
  const ms = raw ? Number(raw) : 0
  if (!Number.isFinite(ms) || ms <= 0) return
  captureUsage(ms, true)
}

/**
 * One `app_updated` per install per version change. Together with
 * `app_opened` this gives update adoption over time and the lag between a
 * release and its installs; `from_version` says which release people leave.
 */
function reportVersionChange(p: Pick<PostHog, 'capture'>) {
  const previous = window.localStorage.getItem(LAST_VERSION_KEY)
  window.localStorage.setItem(LAST_VERSION_KEY, __APP_VERSION__)
  if (previous && previous !== __APP_VERSION__) {
    p.capture('app_updated', { from_version: previous, ...baseProps() })
  }
}

function startUsageTracking() {
  reportRecoveredUsage()
  tickTimer = setInterval(tick, TICK_MS)
  flushTimer = setInterval(flushUsage, FLUSH_MS)
  window.addEventListener('beforeunload', flushUsage)
}

function stopUsageTracking() {
  if (tickTimer) clearInterval(tickTimer)
  if (flushTimer) clearInterval(flushTimer)
  tickTimer = null
  flushTimer = null
  window.removeEventListener('beforeunload', flushUsage)
}

export async function initAnalytics(distinctId?: string) {
  if (ph || !POSTHOG_KEY) return
  const posthog = (await import('posthog-js')).default
  if (ph) return
  ph = posthog
  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    persistence: 'localStorage',
    // window.onerror / unhandledrejection in the renderer become `$exception`
    // events; the main process reports its own through crash-telemetry.ts.
    capture_exceptions: true,
    loaded: (p) => {
      if (distinctId) p.identify(distinctId)
      const props = baseProps()
      // Super properties ride on every event, including autocaptured
      // exceptions, so crash-free rate can be broken down by version.
      p.register(props)
      // `$set` mirrors these onto the person, so a version/platform breakdown
      // buckets each user once by their current value instead of once per
      // version they happened to launch during the reporting window.
      p.capture('app_opened', { ...props, $set: props })
      reportVersionChange(p)
      startUsageTracking()
    },
  })
}

/**
 * Preferred entry point: resolves the persistent install id first so users are
 * counted per installation rather than per localStorage lifetime. Falls back to
 * PostHog's anonymous id if the main process cannot supply one.
 */
export async function startAnalytics() {
  const distinctId = await window.app.getInstallId().catch(() => undefined)
  await initAnalytics(distinctId)
}

export function shutdownAnalytics() {
  if (!ph) return
  stopUsageTracking()
  // Opting out mid-window: discard the pending time rather than sending it.
  activeMs = 0
  window.localStorage.removeItem(ACTIVE_MS_KEY)
  ph.opt_out_capturing()
  ph.reset()
  ph = null
}

export function identifyUser(distinctId: string, properties?: Record<string, unknown>) {
  ph?.identify(distinctId, properties)
}

export function trackEvent(event: string, properties?: Record<string, unknown>) {
  ph?.capture(event, properties)
}

export function isAnalyticsInitialized() {
  return ph !== null
}
