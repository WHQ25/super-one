import posthog from 'posthog-js'

declare const __APP_VERSION__: string
declare const __POSTHOG_PROJECT_TOKEN__: string
declare const __POSTHOG_HOST__: string

const POSTHOG_KEY = __POSTHOG_PROJECT_TOKEN__
const POSTHOG_HOST = __POSTHOG_HOST__ || 'https://us.i.posthog.com'

let initialized = false

export function initAnalytics(distinctId?: string) {
  if (initialized || !POSTHOG_KEY) return
  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    persistence: 'localStorage',
    loaded: (ph) => {
      if (distinctId) ph.identify(distinctId)
      ph.capture('app_opened', {
        app_version: __APP_VERSION__,
        platform: window.app.platform,
      })
    },
  })
  initialized = true
}

export function shutdownAnalytics() {
  if (!initialized) return
  posthog.opt_out_capturing()
  posthog.reset()
  initialized = false
}

export function identifyUser(distinctId: string, properties?: Record<string, unknown>) {
  if (!initialized) return
  posthog.identify(distinctId, properties)
}

export function trackEvent(event: string, properties?: Record<string, unknown>) {
  if (!initialized) return
  posthog.capture(event, properties)
}

export function isAnalyticsInitialized() {
  return initialized
}
