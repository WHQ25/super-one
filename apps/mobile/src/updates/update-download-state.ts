/**
 * Pure decisions around downloading an update APK.
 *
 * Kept free of React Native so the rules that matter -- when to refuse before
 * spending a user's bandwidth, and what a failure should say -- are testable
 * under vitest. The native calls live in `update-ports.ts`.
 */

/**
 * Refuse anything larger than this outright.
 *
 * Deliberately not `MAX_DOWNLOAD_BYTES` from `@superone/relay-client`: that is
 * a 100 MB cap on chat attachments, and a release APK carrying Skia,
 * Reanimated and a WebView runs close enough to it that reusing it would start
 * rejecting legitimate builds. This is a sanity bound against a corrupt
 * manifest, not a policy.
 */
export const MAX_UPDATE_APK_BYTES = 400 * 1024 * 1024

/** Leave the phone room to unpack and install, not just to store, the APK. */
export const DISK_HEADROOM_MULTIPLIER = 2.5

export type DownloadFailure =
  | 'too-large'
  | 'disk-space'
  | 'network'
  | 'checksum'
  | 'cancelled'
  | 'unknown'

/**
 * How far along the download is, or `null` when it cannot be known.
 *
 * `expo-file-system` reports `totalBytesExpectedToWrite: -1` when the server
 * omits `Content-Length`. R2 always sends it, but the manifest carries the size
 * anyway, so fall back to that rather than dropping to an indeterminate bar.
 */
export function downloadFraction(
  written: number,
  expected: number,
  manifestSizeBytes: number,
): number | null {
  const total = expected > 0 ? expected : manifestSizeBytes
  if (!Number.isFinite(written) || written < 0) return null
  if (!Number.isFinite(total) || total <= 0) return null
  return Math.min(1, written / total)
}

/**
 * Decide whether the download is worth starting.
 *
 * Both checks exist to fail before the download rather than after: a phone that
 * runs out of space mid-write leaves a partial APK behind on Android, and an
 * absurd size is the shape a corrupt manifest takes.
 */
export function checkDownloadPreconditions(input: {
  sizeBytes: number
  availableBytes: number | null
}): DownloadFailure | null {
  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0) return 'unknown'
  if (input.sizeBytes > MAX_UPDATE_APK_BYTES) return 'too-large'
  // An unreadable free-space figure must not block the download; the OS will
  // fail the write on its own if it really is full.
  if (input.availableBytes === null || !Number.isFinite(input.availableBytes)) return null
  if (input.availableBytes < input.sizeBytes * DISK_HEADROOM_MULTIPLIER) return 'disk-space'
  return null
}

/**
 * Verify what came down against what the manifest promised.
 *
 * The signing key is the real barrier -- Android will not install an APK signed
 * by anyone else over ours -- so this is about catching a truncated or swapped
 * file early, with a message that says so, rather than handing the installer a
 * broken package.
 */
export function verifyDownload(input: {
  expectedMd5: string
  expectedSizeBytes: number
  actualMd5: string | null | undefined
  actualSizeBytes: number
}): DownloadFailure | null {
  if (input.actualSizeBytes !== input.expectedSizeBytes) return 'checksum'
  // A missing hash means the platform did not compute one; size already
  // matched, so treat it as good rather than refusing to ever update.
  if (!input.actualMd5) return null
  return input.actualMd5.toLowerCase() === input.expectedMd5.toLowerCase() ? null : 'checksum'
}

export function classifyDownloadError(error: unknown): DownloadFailure {
  const message = error instanceof Error ? error.message : String(error ?? '')
  if (/abort|cancel/i.test(message)) return 'cancelled'
  if (/no space|enospc|storage/i.test(message)) return 'disk-space'
  if (/network|timeout|timed out|unreachable|connection|dns|socket|econn|failed to download/i.test(message)) {
    return 'network'
  }
  return 'unknown'
}

/**
 * A download that failed for a reason the UI has wording for.
 *
 * Lives here rather than beside the ports so `use-update-check` can catch it
 * with a type-only import of `UpdatePorts` -- pulling a *value* out of
 * `update-ports.ts` would drag `expo-updates` and friends into jest, where a
 * suite that cannot load reports as missing tests rather than failing ones.
 */
export class UpdateDownloadError extends Error {
  constructor(readonly failure: DownloadFailure) {
    super(`update download failed: ${failure}`)
    this.name = 'UpdateDownloadError'
  }
}
