/**
 * Self-hosted native-binary update manifests for the mobile app.
 *
 * The mobile app ships two update layers. EAS Update swaps the JS bundle, but
 * anything that changes the native runtime needs a new binary, and neither
 * store gives us a push. So we publish a pointer manifest next to the desktop
 * releases and let the app poll it:
 *
 *   https://dl.super-one.dev/mobile/android/latest.json
 *   https://dl.super-one.dev/mobile/ios/latest.json
 *
 * Android can act on it -- download the APK and hand it to the system
 * installer. iOS cannot install anything itself, so its manifest only carries
 * the numbers needed to nag or to block, plus a TestFlight link.
 *
 * The APK lives at an immutable versioned key and `latest.json` is the only
 * mutable object, which makes a rollback a one-object re-point.
 *
 * Both halves have to agree on the key layout -- the app reads these URLs and
 * `scripts/publish-mobile-update.ts` writes them -- so keep this the only copy.
 */

import { DOWNLOAD_BASE_URL } from './download-links'

export type MobileUpdatePlatform = 'android' | 'ios'

/** The only schema the current app understands. Bumping it is a breaking change. */
export const MOBILE_UPDATE_SCHEMA_VERSION = 1

export type MobileUpdateArtifact = {
  /** Always under `DOWNLOAD_BASE_URL`; see `isTrustedMobileUpdateUrl`. */
  url: string
  /** Lowercase hex MD5, matching `expo-file-system`'s `File.md5`. */
  md5: string
  sizeBytes: number
}

export type MobileUpdateManifest = {
  schemaVersion: typeof MOBILE_UPDATE_SCHEMA_VERSION
  platform: MobileUpdatePlatform
  /** Human-facing app version, e.g. `1.0.0`. Display only -- never compared. */
  version: string
  /**
   * The monotonic build counter: Android `versionCode`, iOS `CFBundleVersion`.
   *
   * One name for both platforms because every comparison below is
   * platform-agnostic, and a second spelling would mean a second parser.
   */
  buildCode: number
  /** Builds below this are refused service and must update to keep running. */
  minSupportedBuildCode: number
  releasedAt: string
  /** Android only -- the APK to download and install. */
  artifact?: MobileUpdateArtifact
  /** iOS only -- where a tester goes to update, since we cannot install. */
  testflightUrl?: string
}

export type MobileUpdateVerdict = 'none' | 'optional' | 'required'

/**
 * Pin updates to the release CDN by exact prefix rather than by parsing a URL.
 *
 * Prefix matching pins the scheme along with the host, and rejects the
 * lookalikes a naive hostname check invites: `https://dl.super-one.dev.evil.com/`
 * and `https://user@dl.super-one.dev/` both fail to start with
 * `https://dl.super-one.dev/`. It also keeps this module free of `URL`, whose
 * React Native implementation is a polyfill we would rather not depend on.
 */
export function isTrustedMobileUpdateUrl(url: string, base = DOWNLOAD_BASE_URL): boolean {
  if (typeof url !== 'string') return false
  if (!url.startsWith(`${base.replace(/\/+$/, '')}/`)) return false
  // Path traversal would let a manifest reach outside the `mobile/` prefix, and
  // whitespace is a smuggling vector once the string reaches a shell or intent.
  if (url.includes('..') || /\s/.test(url)) return false
  return true
}

function assertSafeKeySegment(value: string, label: string): string {
  const trimmed = value.trim()
  if (!trimmed || trimmed.includes('..') || trimmed.includes('/') || trimmed.includes('\\')) {
    throw new Error(`unsafe ${label} for mobile update key: ${value}`)
  }
  return trimmed
}

/** `mobile/<platform>/latest.json` -- the single mutable pointer object. */
export function mobileUpdateManifestObjectKey(platform: MobileUpdatePlatform): string {
  return `mobile/${platform}/latest.json`
}

export function mobileUpdateManifestUrl(
  platform: MobileUpdatePlatform,
  base = DOWNLOAD_BASE_URL,
): string {
  return `${base.replace(/\/+$/, '')}/${mobileUpdateManifestObjectKey(platform)}`
}

/** `mobile/android/v<version>-<buildCode>/superone-<buildCode>.apk` -- immutable. */
export function androidApkObjectKey(version: string, buildCode: number): string {
  const ver = assertSafeKeySegment(version, 'version')
  if (!Number.isSafeInteger(buildCode) || buildCode <= 0) {
    throw new Error(`unsafe build code for mobile update key: ${buildCode}`)
  }
  return `mobile/android/v${ver}-${buildCode}/superone-${buildCode}.apk`
}

export function androidApkUrl(
  version: string,
  buildCode: number,
  base = DOWNLOAD_BASE_URL,
): string {
  return `${base.replace(/\/+$/, '')}/${androidApkObjectKey(version, buildCode)}`
}

function positiveInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

/**
 * Validate a fetched manifest, or return `null`.
 *
 * This never throws and never partially accepts. A manifest we cannot fully
 * understand -- including one from a future `schemaVersion` -- has to read as
 * "no update available", because the alternative is that publishing a new
 * schema bricks every already-installed build.
 */
export function parseMobileUpdateManifest(
  raw: unknown,
  expectedPlatform?: MobileUpdatePlatform,
  base = DOWNLOAD_BASE_URL,
): MobileUpdateManifest | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>

  if (o.schemaVersion !== MOBILE_UPDATE_SCHEMA_VERSION) return null

  const platform = o.platform === 'android' || o.platform === 'ios' ? o.platform : null
  if (!platform) return null
  if (expectedPlatform && platform !== expectedPlatform) return null

  const version = nonEmptyString(o.version)
  const releasedAt = nonEmptyString(o.releasedAt)
  const buildCode = positiveInt(o.buildCode)
  if (!version || !releasedAt || buildCode === null) return null

  const minSupportedBuildCode =
    typeof o.minSupportedBuildCode === 'number' && Number.isSafeInteger(o.minSupportedBuildCode)
      ? o.minSupportedBuildCode
      : null
  // A floor above the newest build would strand every user on a hard gate they
  // cannot clear. `evaluateMobileUpdate` relies on this to order its checks.
  if (minSupportedBuildCode === null || minSupportedBuildCode < 0) return null
  if (minSupportedBuildCode > buildCode) return null

  const manifest: MobileUpdateManifest = {
    schemaVersion: MOBILE_UPDATE_SCHEMA_VERSION,
    platform,
    version,
    buildCode,
    minSupportedBuildCode,
    releasedAt,
  }

  if (platform === 'android') {
    const artifactRaw = o.artifact
    if (!artifactRaw || typeof artifactRaw !== 'object') return null
    const a = artifactRaw as Record<string, unknown>
    const url = nonEmptyString(a.url)
    const md5 = nonEmptyString(a.md5)
    const sizeBytes = positiveInt(a.sizeBytes)
    if (!url || !md5 || sizeBytes === null) return null
    if (!isTrustedMobileUpdateUrl(url, base)) return null
    if (!/^[0-9a-f]{32}$/.test(md5.toLowerCase())) return null
    manifest.artifact = { url, md5: md5.toLowerCase(), sizeBytes }
  } else {
    const testflightUrl = nonEmptyString(o.testflightUrl)
    if (!testflightUrl || !testflightUrl.startsWith('https://testflight.apple.com/')) return null
    manifest.testflightUrl = testflightUrl
  }

  return manifest
}

export type EvaluateMobileUpdateInput = {
  manifest: MobileUpdateManifest | null
  /** The running binary's build counter, or `null` when it cannot be read. */
  currentBuildCode: number | null
  /** The newest build the user has explicitly said "later" to. */
  dismissedBuildCode?: number | null
}

/**
 * Decide what to show the user.
 *
 * The hard gate is checked before the dismissal so that saying "later" once can
 * never buy past a `minSupportedBuildCode` bump -- that bump is how a breaking
 * protocol change stops old clients from connecting at all.
 */
export function evaluateMobileUpdate(input: EvaluateMobileUpdateInput): MobileUpdateVerdict {
  const { manifest, currentBuildCode } = input
  if (!manifest) return 'none'
  // An unreadable build counter must not trigger the gate: we would be locking
  // the user out on the strength of a value we failed to read.
  if (currentBuildCode === null || !Number.isSafeInteger(currentBuildCode)) return 'none'

  if (currentBuildCode < manifest.minSupportedBuildCode) return 'required'
  if (currentBuildCode >= manifest.buildCode) return 'none'
  if (input.dismissedBuildCode === manifest.buildCode) return 'none'
  return 'optional'
}

export type FetchMobileUpdateManifestOptions = {
  platform: MobileUpdatePlatform
  baseUrl?: string
  fetchJson?: (url: string) => Promise<unknown>
  timeoutMs?: number
}

/**
 * Fetch and validate the manifest, or resolve `null`.
 *
 * Every failure -- offline, 404 on a prefix we have not published yet, garbage
 * body -- collapses to `null` on purpose. The update checker runs on every
 * foreground, so a transient failure must be silent rather than an error the
 * user has to dismiss.
 */
export async function fetchMobileUpdateManifest(
  opts: FetchMobileUpdateManifestOptions,
): Promise<MobileUpdateManifest | null> {
  const base = opts.baseUrl ?? DOWNLOAD_BASE_URL
  const url = mobileUpdateManifestUrl(opts.platform, base)
  const fetchJson =
    opts.fetchJson ??
    (async (u: string) => {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 15_000)
      try {
        const res = await fetch(u, { signal: ctrl.signal, headers: { accept: 'application/json' } })
        if (!res.ok) return null
        return await res.json()
      } finally {
        clearTimeout(timer)
      }
    })

  try {
    const raw = await fetchJson(url)
    if (raw == null) return null
    return parseMobileUpdateManifest(raw, opts.platform, base)
  } catch {
    return null
  }
}
