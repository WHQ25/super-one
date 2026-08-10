/**
 * R2 / CDN layout for on-demand harness runtimes (design §4).
 *
 * Public base: https://dl.super-one.dev
 *   harness/manifest/<channel>.json
 *   harness/artifacts/<npm-name-sanitized>/<version>.tgz
 *
 * Artifacts are byte-exact mirrors of npm pack tarballs so one SHA-256 validates
 * both the R2 primary path and the npm registry fallback.
 */

import type { HarnessReleaseManifest, HostArch, HostPlatform, ManagedHarnessId } from './managed-release'
import { parseHarnessReleaseManifest } from './managed-release'

export const HARNESS_CDN_BASE = 'https://dl.super-one.dev'
export const HARNESS_CDN_BUCKET_PREFIX = 'harness'

/** Channel keys used for harness/manifest/<channel>.json (matches UpdateChannel). */
export type HarnessManifestChannel = 'alpha' | 'beta' | 'stable'

export const HARNESS_MANIFEST_CHANNELS: readonly HarnessManifestChannel[] = [
  'alpha',
  'beta',
  'stable',
]

export function isHarnessManifestChannel(value: string): value is HarnessManifestChannel {
  return value === 'alpha' || value === 'beta' || value === 'stable'
}

/**
 * Sanitize an npm package name for use as a single R2 path segment.
 * `@anthropic-ai/claude-agent-sdk-darwin-arm64` → `anthropic-ai--claude-agent-sdk-darwin-arm64`
 */
export function npmNameToArtifactDir(npmName: string): string {
  const n = npmName.trim()
  if (!n) throw new Error('npmName must be non-empty')
  if (n.includes('..') || n.includes('\\') || n.includes('\0')) {
    throw new Error(`unsafe npmName: ${npmName}`)
  }
  return n.replace(/^@/, '').replace(/\//g, '--')
}

/** Object key under the releases bucket (no leading slash). */
export function harnessArtifactObjectKey(npmName: string, npmVersion: string): string {
  const dir = npmNameToArtifactDir(npmName)
  const ver = npmVersion.trim()
  if (!ver || ver.includes('/') || ver.includes('\\') || ver.includes('..')) {
    throw new Error(`unsafe npmVersion for object key: ${npmVersion}`)
  }
  return `${HARNESS_CDN_BUCKET_PREFIX}/artifacts/${dir}/${ver}.tgz`
}

export function harnessArtifactPublicUrl(
  npmName: string,
  npmVersion: string,
  base = HARNESS_CDN_BASE,
): string {
  return `${base.replace(/\/+$/, '')}/${harnessArtifactObjectKey(npmName, npmVersion)}`
}

export function harnessChannelManifestObjectKey(channel: HarnessManifestChannel): string {
  return `${HARNESS_CDN_BUCKET_PREFIX}/manifest/${channel}.json`
}

export function harnessChannelManifestUrl(
  channel: HarnessManifestChannel,
  base = HARNESS_CDN_BASE,
): string {
  return `${base.replace(/\/+$/, '')}/${harnessChannelManifestObjectKey(channel)}`
}

export interface FetchChannelManifestOptions {
  channel: HarnessManifestChannel
  baseUrl?: string
  /** Injectable for tests. */
  fetchJson?: (url: string) => Promise<unknown>
  /** Optional timeout (ms). Default 15s. */
  timeoutMs?: number
}

/**
 * Download and parse a channel harness release manifest from the CDN.
 * Throws on network/parse errors — callers decide whether to fall back to npm-only.
 */
export async function fetchHarnessChannelManifest(
  opts: FetchChannelManifestOptions,
): Promise<HarnessReleaseManifest> {
  const url = harnessChannelManifestUrl(opts.channel, opts.baseUrl ?? HARNESS_CDN_BASE)
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
        if (!res.ok) throw new Error(`manifest GET ${u} → ${res.status}`)
        return res.json()
      } finally {
        clearTimeout(timer)
      }
    })
  return parseHarnessReleaseManifest(await fetchJson(url))
}

/** Look up the pin for a harness on the current (or given) platform/arch. */
export function selectHarnessArtifact(
  manifest: HarnessReleaseManifest,
  harnessId: ManagedHarnessId,
  platform: HostPlatform,
  arch: HostArch,
): import('./managed-release').ManagedArtifactPin | null {
  const pin = manifest.managedHarnesses[harnessId]
  if (!pin) return null
  return pin.artifacts.find((a) => a.platform === platform && a.arch === arch) ?? null
}
