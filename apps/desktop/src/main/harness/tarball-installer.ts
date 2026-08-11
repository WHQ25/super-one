/**
 * Desktop ManagedRuntimeInstaller — thin host over the shared kernel.
 *
 * Shared (CLI + desktop) in `@superone/runtime`:
 * - R2 → npm tarball (`fetchTarballWithFallback`)
 * - Range-resumable download (`downloadResumableToFile`)
 * - versioned layout under `~/.superone/harness`
 *
 * Desktop-only: inject Chromium `net.fetch` (system proxy) via `httpFetch`.
 */

import { createHash } from 'node:crypto'
import { createWriteStream, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { app } from 'electron'
import {
  createFetchJson,
  createManagedTarballInstaller,
  createResumableDownloadToFile,
  createThrottledProgress as createThrottledProgressShared,
  downloadResumableToFile as downloadResumableToFileShared,
  extractTgzWithSystemTar as extractTgzShared,
  harnessArtifactDownloadKey as harnessArtifactDownloadKeyShared,
  harnessDownloadDir as harnessDownloadDirShared,
  harnessPartialPath as harnessPartialPathShared,
  hashExistingFile as hashExistingFileShared,
  HARNESS_PROGRESS_THROTTLE_MS as HARNESS_PROGRESS_THROTTLE_MS_SHARED,
  managedHarnessPrefix,
  managedPackagePins,
  codexPlatformVersion as codexPlatformVersionShared,
  parseContentRange as parseContentRangeShared,
  resetDestPathLocksForTests as resetDestPathLocksForTestsShared,
  resolveHarnessManifestChannel as resolveHarnessManifestChannelShared,
  resolveManagedTarballBinary,
  resolveManagedTarballBinaryFromPrefix,
  resolveNpmPackMeta,
  readRuntimeVersion as readRuntimeVersionShared,
  sha256Hex,
  streamResponseToFile as streamResponseToFileShared,
  verifyNpmIntegrity,
  verifySha256,
  type DownloadToFileResult,
  type HarnessManifestChannel,
  type HttpFetch,
  type ManagedArtifactPin,
  type ManagedHarnessId,
  type ManagedRuntimeInstaller,
  type NpmPackMeta,
  type StreamToFileOptions as StreamToFileOptionsShared,
} from '@superone/runtime/harness'
import log from '../logger'

// ── re-exports (shared kernel) ──────────────────────────────────────────────

export const extractTgzWithSystemTar = extractTgzShared
export const harnessDownloadDir = harnessDownloadDirShared
export const harnessArtifactDownloadKey = harnessArtifactDownloadKeyShared
export const harnessPartialPath = harnessPartialPathShared
export const codexPlatformVersion = codexPlatformVersionShared
export const resolveHarnessManifestChannel = resolveHarnessManifestChannelShared
export const readRuntimeVersion = readRuntimeVersionShared
export const desktopPackagePins = managedPackagePins
export const HARNESS_PROGRESS_THROTTLE_MS = HARNESS_PROGRESS_THROTTLE_MS_SHARED
export const createThrottledProgress = createThrottledProgressShared
export const parseContentRange = parseContentRangeShared
export const hashExistingFile = hashExistingFileShared
export const streamResponseToFile = streamResponseToFileShared
export const resetDestPathLocksForTests = resetDestPathLocksForTestsShared
export type StreamToFileOptions = StreamToFileOptionsShared

export type { HttpFetch, DownloadToFileResult, NpmPackMeta }
export { resolveNpmPackMeta, sha256Hex, verifyNpmIntegrity, verifySha256 }
export { installPackageDir } from '@superone/runtime/harness'

export interface TarballFetchFns {
  fetchJson: (url: string) => Promise<unknown>
  downloadToFile: (
    url: string,
    destPath: string,
    onProgress?: (received: number, total: number) => void,
  ) => Promise<DownloadToFileResult>
  fetchBinary?: (
    url: string,
    onProgress?: (received: number, total: number) => void,
  ) => Promise<Uint8Array>
  extractTgz: (tgzPath: string, destDir: string) => Promise<void>
}

export interface DesktopInstallerOptions extends Partial<TarballFetchFns> {
  httpFetch?: HttpFetch
  channel?: HarnessManifestChannel
  cdnBase?: string
  npmOnly?: boolean
  artifactPin?: ManagedArtifactPin | null
}

function defaultHttpFetch(): HttpFetch {
  return (input, init) => globalThis.fetch(input, init)
}

const hostLog = {
  info: (m: string) => log.info(m),
  warn: (m: string) => log.warn(m),
}

/** Range-resumable download (shared with CLI). */
export function createDownloadToFile(httpFetch: HttpFetch): TarballFetchFns['downloadToFile'] {
  return createResumableDownloadToFile(httpFetch, hostLog)
}

export async function downloadResumableToFile(
  httpFetch: HttpFetch,
  url: string,
  destPath: string,
  onProgress?: (received: number, total: number) => void,
): Promise<DownloadToFileResult> {
  return downloadResumableToFileShared(httpFetch, url, destPath, onProgress, hostLog)
}

async function writeBytes(path: string, bytes: Uint8Array): Promise<void> {
  mkdirSync(dirname(path), { recursive: true })
  await pipeline(Readable.from([bytes]), createWriteStream(path))
}

function wrapFetchBinaryAsDownload(
  fetchBinary: NonNullable<TarballFetchFns['fetchBinary']>,
): TarballFetchFns['downloadToFile'] {
  return async (url, destPath, onProgress) => {
    const bytes = await fetchBinary(url, onProgress)
    mkdirSync(dirname(destPath), { recursive: true })
    await writeBytes(destPath, bytes)
    return {
      byteLength: bytes.byteLength,
      sha256Hex: sha256Hex(bytes),
      sha512Base64: createHash('sha512').update(bytes).digest('base64'),
    }
  }
}

/**
 * Desktop installer = shared kernel + optional Chromium `httpFetch`.
 * Resume/R2/npm/layout all come from `@superone/runtime`.
 */
export function createDesktopTarballInstaller(
  opts: DesktopInstallerOptions = {},
): ManagedRuntimeInstaller {
  const httpFetch = opts.httpFetch ?? defaultHttpFetch()
  const fetchJson = opts.fetchJson ?? createFetchJson(httpFetch)
  const downloadToFile =
    opts.downloadToFile ??
    (opts.fetchBinary
      ? wrapFetchBinaryAsDownload(opts.fetchBinary)
      : createDownloadToFile(httpFetch))
  const extractTgz = opts.extractTgz ?? extractTgzWithSystemTar

  let releaseVersion: string | undefined
  try {
    releaseVersion = app.getVersion()
  } catch {
    releaseVersion = process.env.SUPERONE_CLI_VERSION?.trim()
  }

  return createManagedTarballInstaller({
    httpFetch,
    fetchJson,
    downloadToFile,
    extractTgz,
    channel: opts.channel,
    releaseVersion,
    cdnBase: opts.cdnBase,
    npmOnly: opts.npmOnly,
    artifactPin: opts.artifactPin,
    log: hostLog,
  })
}

export function isDesktopManagedPinAligned(
  id: ManagedHarnessId,
  homeRoot: string,
): boolean {
  const prefix = managedHarnessPrefix(homeRoot, id)
  const pin = desktopPackagePins(id).runtimeVersion
  const bin = resolveDesktopManagedBinary(id, prefix)
  const ver = readRuntimeVersion(id, prefix)
  return Boolean(bin && ver === pin)
}

export function resolveDesktopManagedBinary(
  id: ManagedHarnessId,
  prefix: string,
): string | null {
  return resolveManagedTarballBinaryFromPrefix(id, prefix)
}

export function resolveDesktopManagedBinaryInRoot(
  id: ManagedHarnessId,
  installRoot: string,
): string | null {
  return resolveManagedTarballBinary(id, installRoot)
}
