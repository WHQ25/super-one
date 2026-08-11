/**
 * Shared harness tarball acquisition: **R2/CDN first, npm registry fallback**.
 *
 * Used by desktop (stream + Range resume via host `downloadToFile`) and
 * available to CLI for the same pin path without spawning `npm install`.
 *
 * Artifacts on R2 are byte-exact npm pack mirrors — one SHA-256 validates both.
 */

import { createHash } from 'node:crypto'
import { existsSync, rmSync } from 'node:fs'
import type { ManagedArtifactPin } from './managed-release'

export const NPM_REGISTRY = 'https://registry.npmjs.org'

export interface NpmPackMeta {
  name: string
  version: string
  tarball: string
  /** npm `dist.integrity` — `sha512-<base64>` */
  integrity: string
}

export type HttpFetch = (input: string, init?: RequestInit) => Promise<Response>

export interface DownloadToFileResult {
  byteLength: number
  sha256Hex: string
  sha512Base64: string
}

/**
 * Host-supplied stream-to-disk. Must hash while writing so multi‑MB tarballs
 * never sit fully in heap. Desktop uses Chromium `net.fetch` + Range resume;
 * CLI/tests may use undici `fetch` or an in-memory adapter.
 */
export type DownloadToFile = (
  url: string,
  destPath: string,
  onProgress?: (received: number, total: number) => void,
) => Promise<DownloadToFileResult>

export type FetchJson = (url: string) => Promise<unknown>

export type TarballSource = 'r2-tarball' | 'npm-tarball'

export interface FetchTarballWithFallbackOptions {
  destPath: string
  npmName: string
  npmVersion: string
  /** Channel pin (url + digest). Null/undefined skips R2. */
  pin?: ManagedArtifactPin | null
  /** Skip R2 even when pin.url is set. */
  npmOnly?: boolean
  fetchJson: FetchJson
  downloadToFile: DownloadToFile
  onProgress?: (received: number, total: number) => void
  /** Optional log hooks (desktop logger / CLI stderr). */
  log?: {
    info?: (msg: string) => void
    warn?: (msg: string) => void
  }
}

export interface FetchTarballWithFallbackResult {
  from: TarballSource
  digests: DownloadToFileResult
  /** Present when npm fallback ran (for diagnostics). */
  npmMeta?: NpmPackMeta
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export function verifySha256(bytes: Uint8Array, expectedHex: string): void {
  const actual = sha256Hex(bytes)
  if (actual !== expectedHex.toLowerCase()) {
    throw new Error(`tarball sha256 mismatch: expected ${expectedHex}, got ${actual}`)
  }
}

export function verifyNpmIntegrity(bytes: Uint8Array, integrity: string): void {
  if (!integrity.startsWith('sha512-')) {
    throw new Error(`unsupported integrity algorithm: ${integrity.slice(0, 16)}`)
  }
  const expected = integrity.slice('sha512-'.length)
  const actual = createHash('sha512').update(bytes).digest('base64')
  if (actual !== expected) {
    throw new Error(`tarball integrity mismatch (sha512)`)
  }
}

export function assertSha256(actualHex: string, expectedHex: string): void {
  if (actualHex !== expectedHex.toLowerCase()) {
    throw new Error(`tarball sha256 mismatch: expected ${expectedHex}, got ${actualHex}`)
  }
}

export function assertSha512Integrity(actualBase64: string, integrity: string): void {
  if (!integrity.startsWith('sha512-')) {
    throw new Error(`unsupported integrity algorithm: ${integrity.slice(0, 16)}`)
  }
  const expected = integrity.slice('sha512-'.length)
  if (actualBase64 !== expected) {
    throw new Error(`tarball integrity mismatch (sha512)`)
  }
}

export function discardPartial(destPath: string): void {
  try {
    if (existsSync(destPath)) rmSync(destPath, { force: true })
  } catch {
    /* best-effort */
  }
}

export function createFetchJson(httpFetch: HttpFetch): FetchJson {
  return async (url: string) => {
    const res = await httpFetch(url, { headers: { accept: 'application/json' } })
    if (!res.ok) throw new Error(`registry GET ${url} → ${res.status}`)
    return res.json()
  }
}

/** GET npm pack metadata (`dist.tarball` + `dist.integrity`). */
export async function resolveNpmPackMeta(
  name: string,
  version: string,
  fetchJson: FetchJson,
): Promise<NpmPackMeta> {
  // Scoped packages: @scope/name → /@scope%2fname/version
  const encoded = name.startsWith('@')
    ? `/${name.replace('/', '%2f')}/${encodeURIComponent(version)}`
    : `/${name}/${encodeURIComponent(version)}`
  const url = `${NPM_REGISTRY}${encoded}`
  const raw = (await fetchJson(url)) as Record<string, unknown>
  const dist = raw.dist as { tarball?: string; integrity?: string } | undefined
  if (!dist?.tarball || !dist.integrity) {
    throw new Error(`npm package ${name}@${version} missing dist.tarball/integrity`)
  }
  if (!dist.integrity.startsWith('sha512-')) {
    throw new Error(`npm package ${name}@${version} integrity is not sha512: ${dist.integrity}`)
  }
  return {
    name,
    version: typeof raw.version === 'string' ? raw.version : version,
    tarball: dist.tarball,
    integrity: dist.integrity,
  }
}

/**
 * Download a harness tarball: try pin URL (R2/CDN), then npm registry.
 *
 * On R2 failure the partial is kept so npm can Range-resume the same path
 * (mirrors are byte-identical). Digest mismatch discards the partial.
 */
export async function fetchTarballWithFallback(
  opts: FetchTarballWithFallbackOptions,
): Promise<FetchTarballWithFallbackResult> {
  const {
    destPath,
    npmName,
    npmVersion,
    pin,
    npmOnly,
    fetchJson,
    downloadToFile,
    onProgress,
    log,
  } = opts
  const expectedSha = pin?.digestSha256

  // 1) R2 / CDN primary
  if (!npmOnly && pin?.url) {
    try {
      log?.info?.(`[harness] fetching R2 ${pin.url}`)
      const digests = await downloadToFile(pin.url, destPath, onProgress)
      if (expectedSha) assertSha256(digests.sha256Hex, expectedSha)
      return { from: 'r2-tarball', digests }
    } catch (err) {
      log?.warn?.(
        `[harness] R2 fetch failed (${err instanceof Error ? err.message : String(err)}); trying npm`,
      )
      if (err instanceof Error && /sha256 mismatch|integrity mismatch/i.test(err.message)) {
        discardPartial(destPath)
      }
    }
  }

  // 2) npm registry fallback
  log?.info?.(`[harness] fetching npm ${npmName}@${npmVersion}`)
  const meta = await resolveNpmPackMeta(npmName, npmVersion, fetchJson)
  try {
    const digests = await downloadToFile(meta.tarball, destPath, onProgress)
    if (expectedSha) {
      assertSha256(digests.sha256Hex, expectedSha)
    } else {
      assertSha512Integrity(digests.sha512Base64, meta.integrity)
    }
    return { from: 'npm-tarball', digests, npmMeta: meta }
  } catch (err) {
    if (err instanceof Error && /sha256 mismatch|integrity mismatch/i.test(err.message)) {
      discardPartial(destPath)
    }
    throw err
  }
}
