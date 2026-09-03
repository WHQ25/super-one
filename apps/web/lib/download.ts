import type { DesktopPlatform } from "./platform"

const BASE = (
  process.env.NEXT_PUBLIC_DOWNLOAD_BASE_URL ?? "https://dl.super-one.dev"
).replace(/\/+$/, "")

/**
 * Which side-by-side app the site offers. Ordinary visitors get `stable`.
 *
 * The installer names are derived from each variant's `productName` -- they
 * are what `fixedLinkName` in `scripts/lib/channels.ts` produces, so the two
 * must stay in step. The source of truth is `apps/desktop/variants.json`;
 * this app cannot import across the workspace boundary, so it mirrors the two
 * product names and nothing else.
 */
export type DownloadVariant = "stable" | "alpha"

const PRODUCT_NAME: Record<DownloadVariant, string> = {
  stable: "SuperOne",
  alpha: "SuperOne Alpha",
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

function fixedFileName(
  variant: DownloadVariant,
  platform: DesktopPlatform,
  arch?: DownloadArch,
): string {
  const product = PRODUCT_NAME[variant]
  if (platform === "mac") return arch === "x64" ? `${product}.dmg` : `${product}-arm64.dmg`
  if (platform === "win") return `${product} Setup.exe`
  return `${product}.AppImage`
}

export function downloadUrl(
  platform: DesktopPlatform,
  arch?: DownloadArch,
  variant: DownloadVariant = DEFAULT_VARIANT,
): string {
  const name = encodeURIComponent(fixedFileName(variant, platform, arch))
  return `${BASE}/${variant}/latest/${name}`
}

export function isTarget(
  target: DownloadTarget,
  platform: DesktopPlatform,
  arch?: DownloadArch,
): boolean {
  return target.platform === platform && target.arch === arch
}
