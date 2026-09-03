import {
  type DownloadArch as SharedDownloadArch,
  fixedDownloadUrl,
} from "@superone/shared/download-links"
import type { DesktopPlatform } from "./platform"

const BASE = (
  process.env.NEXT_PUBLIC_DOWNLOAD_BASE_URL ?? "https://dl.super-one.dev"
).replace(/\/+$/, "")

/**
 * Which side-by-side app the site offers. Ordinary visitors get `stable`.
 *
 * Both variants name their installers "SuperOne"; the prerelease tag is what
 * separates the two fixed links. Mirrored here because this app cannot import
 * `apps/desktop/variants.json` -- the names they imply come from
 * `@superone/shared/download-links`, which the desktop app reads too.
 */
export type DownloadVariant = "stable" | "alpha"

const ARTIFACT_BASE_NAME = "SuperOne"

const PRERELEASE_TAG: Record<DownloadVariant, string | null> = {
  stable: null,
  alpha: "alpha",
}

const DEFAULT_VARIANT = (process.env.NEXT_PUBLIC_DOWNLOAD_CHANNEL ??
  "stable") as DownloadVariant

export type DownloadArch = "arm64" | "x64"

export interface DownloadTarget {
  platform: DesktopPlatform
  arch?: DownloadArch
  archLabel?: string
}

export const DOWNLOAD_TARGETS: DownloadTarget[] = [
  { platform: "mac", arch: "arm64", archLabel: "Apple Silicon" },
  { platform: "mac", arch: "x64", archLabel: "Intel" },
  { platform: "win" },
  { platform: "linux" },
]

export function downloadUrl(
  platform: DesktopPlatform,
  arch?: DownloadArch,
  variant: DownloadVariant = DEFAULT_VARIANT,
): string {
  return fixedDownloadUrl({
    baseUrl: BASE,
    downloadPrefix: variant,
    artifactBaseName: ARTIFACT_BASE_NAME,
    prereleaseTag: PRERELEASE_TAG[variant],
    platform,
    arch: arch as SharedDownloadArch | undefined,
  })
}

export function isTarget(
  target: DownloadTarget,
  platform: DesktopPlatform,
  arch?: DownloadArch,
): boolean {
  return target.platform === platform && target.arch === arch
}
