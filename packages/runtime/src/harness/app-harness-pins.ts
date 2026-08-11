/**
 * Per-app-version harness pin manifest.
 *
 * Published next to desktop releases so an older running app can pre-fetch the
 * *target* runtime pins before Restart (strict atomic update).
 *
 * Layout (CDN):
 *   https://dl.super-one.dev/app/harness-pins/<version>.json
 *
 * Example:
 *   {
 *     "version": "0.12.0-alpha.3",
 *     "pins": { "claude": "0.3.226", "codex": "0.146.1" }
 *   }
 */

import { HARNESS_CDN_BASE } from './cdn'
import { managedPackagePins } from './managed-tarball-installer'
import type { ManagedHarnessId } from './managed-release'

export type AppHarnessPinMap = Partial<Record<ManagedHarnessId, string>>

export type AppHarnessPins = {
  version: string
  pins: AppHarnessPinMap
}

export function appHarnessPinsObjectKey(appVersion: string): string {
  const ver = appVersion.trim()
  if (!ver || ver.includes('..') || ver.includes('/') || ver.includes('\\')) {
    throw new Error(`unsafe app version for harness pins key: ${appVersion}`)
  }
  return `app/harness-pins/${ver}.json`
}

export function appHarnessPinsUrl(appVersion: string, base = HARNESS_CDN_BASE): string {
  return `${base.replace(/\/+$/, '')}/${appHarnessPinsObjectKey(appVersion)}`
}

export function parseAppHarnessPins(raw: unknown): AppHarnessPins {
  if (!raw || typeof raw !== 'object') throw new Error('harness pins: expected object')
  const o = raw as Record<string, unknown>
  const version = typeof o.version === 'string' ? o.version.trim() : ''
  if (!version) throw new Error('harness pins: missing version')
  const pinsRaw = o.pins
  if (!pinsRaw || typeof pinsRaw !== 'object') throw new Error('harness pins: missing pins')
  const pins: AppHarnessPinMap = {}
  for (const id of ['claude', 'codex'] as const) {
    const v = (pinsRaw as Record<string, unknown>)[id]
    if (typeof v === 'string' && v.trim()) pins[id] = v.trim()
  }
  return { version, pins }
}

/** Pins baked into the *currently running* process (package constants / env). */
export function currentProcessAppHarnessPins(appVersion: string): AppHarnessPins {
  return {
    version: appVersion,
    pins: {
      claude: managedPackagePins('claude').runtimeVersion,
      codex: managedPackagePins('codex').runtimeVersion,
    },
  }
}

export async function fetchAppHarnessPins(opts: {
  appVersion: string
  baseUrl?: string
  fetchJson?: (url: string) => Promise<unknown>
  timeoutMs?: number
}): Promise<AppHarnessPins | null> {
  const url = appHarnessPinsUrl(opts.appVersion, opts.baseUrl ?? HARNESS_CDN_BASE)
  const fetchJson =
    opts.fetchJson ??
    (async (u: string) => {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 15_000)
      try {
        const res = await fetch(u, {
          signal: ctrl.signal,
          headers: { accept: 'application/json' },
        })
        if (res.status === 404) return null
        if (!res.ok) throw new Error(`harness pins GET ${u} → ${res.status}`)
        return res.json()
      } finally {
        clearTimeout(timer)
      }
    })

  try {
    const raw = await fetchJson(url)
    if (raw == null) return null
    return parseAppHarnessPins(raw)
  } catch {
    return null
  }
}

/**
 * Resolve pins for a target app version: remote manifest if published, else
 * the running process pins (best-effort when the release did not upload pins).
 */
export async function resolveAppHarnessPins(opts: {
  appVersion: string
  baseUrl?: string
  fetchJson?: (url: string) => Promise<unknown>
}): Promise<AppHarnessPins> {
  const remote = await fetchAppHarnessPins(opts)
  if (remote) return remote
  return currentProcessAppHarnessPins(opts.appVersion)
}
