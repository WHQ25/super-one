import { app } from 'electron'
import { readAppSettings } from './app-settings-service'
import { getInstallId } from './install-id'
import { variantId } from './variant'
import log from './logger'

declare const __POSTHOG_PROJECT_TOKEN__: string
declare const __POSTHOG_HOST__: string

/**
 * Release health for the main process.
 *
 * The renderer reports through posthog-js, but the failures that matter most
 * for a release -- a main-process uncaught exception, a renderer or GPU
 * process dying -- happen where no renderer is available to report them. This
 * posts straight to PostHog's capture endpoint from main, under the same
 * install id and opt-in as the renderer, so one `app_version` breakdown covers
 * both sides.
 *
 * Nothing here can be allowed to fail the caller: the reporter runs inside the
 * crash handlers themselves.
 */

/** A crash loop must not turn into an event flood. Per process lifetime. */
const MAX_EVENTS_PER_RUN = 20
const SEND_TIMEOUT_MS = 5_000

let sent = 0

function telemetryEnabled(): boolean {
  if (!__POSTHOG_PROJECT_TOKEN__) return false
  try {
    return readAppSettings().analyticsEnabled === true
  } catch {
    return false
  }
}

function baseProps(): Record<string, unknown> {
  return {
    app_version: app.getVersion(),
    variant: variantId(),
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
  }
}

async function send(event: string, properties: Record<string, unknown>): Promise<void> {
  if (!telemetryEnabled()) return
  if (sent >= MAX_EVENTS_PER_RUN) return
  sent += 1
  const host = __POSTHOG_HOST__ || 'https://us.i.posthog.com'
  try {
    await fetch(`${host}/i/v0/e/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        api_key: __POSTHOG_PROJECT_TOKEN__,
        event,
        distinct_id: getInstallId(),
        timestamp: new Date().toISOString(),
        properties: { ...baseProps(), ...properties },
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    })
  } catch (err) {
    log.warn('[crash-telemetry] send failed:', err instanceof Error ? err.message : String(err))
  }
}

export type MainExceptionKind = 'uncaught_exception' | 'unhandled_rejection'

/**
 * A main-process JavaScript failure, shaped as PostHog's `$exception` so it
 * lands in Error Tracking next to the renderer's autocaptured exceptions.
 */
export function reportMainException(kind: MainExceptionKind, err: unknown): Promise<void> {
  const e = (err ?? {}) as Partial<Error> & { code?: string }
  return send('$exception', {
    $exception_list: [
      {
        type: e.name ?? 'Error',
        value: e.message ?? String(err),
        mechanism: { handled: false, type: kind },
      },
    ],
    process: 'main',
    kind,
    code: e.code,
    stack: e.stack,
  })
}

export interface ProcessGoneDetails {
  reason: string
  exitCode: number
  serviceName?: string
}

/**
 * A Chromium process died: renderer, GPU, utility. Not a JavaScript exception,
 * so it is its own event. `clean-exit` is how utility processes normally end
 * and is not reported.
 */
export function reportProcessGone(
  processType: string,
  details: ProcessGoneDetails,
  extra: Record<string, unknown> = {},
): Promise<void> {
  if (details.reason === 'clean-exit') return Promise.resolve()
  return send('process_gone', {
    process: processType,
    reason: details.reason,
    exit_code: details.exitCode,
    service: details.serviceName,
    ...extra,
  })
}

/** Test seam: the per-run cap is module state. */
export function _resetCrashTelemetryForTests(): void {
  sent = 0
}
