import type { PostHog } from 'posthog-js'

declare const __APP_VERSION__: string
declare const __POSTHOG_PROJECT_TOKEN__: string
declare const __POSTHOG_HOST__: string

const POSTHOG_KEY = __POSTHOG_PROJECT_TOKEN__
const POSTHOG_HOST = __POSTHOG_HOST__ || 'https://us.i.posthog.com'

let ph: PostHog | null = null

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
    loaded: (p) => {
      if (distinctId) p.identify(distinctId)
      p.capture('app_opened', {
        app_version: __APP_VERSION__,
        platform: window.app.platform,
      })
    },
  })
}

export function shutdownAnalytics() {
  if (!ph) return
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
