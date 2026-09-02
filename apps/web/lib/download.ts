import type { DesktopPlatform } from "./platform"

const BASE = (
  process.env.NEXT_PUBLIC_DOWNLOAD_BASE_URL ?? "https://dl.super-one.dev"
).replace(/\/+$/, "")

const CHANNEL = process.env.NEXT_PUBLIC_DOWNLOAD_CHANNEL ?? "alpha"

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

function fixedFileName(platform: DesktopPlatform, arch?: DownloadArch): string {
  if (platform === "mac") return arch === "x64" ? "SuperOne.dmg" : "SuperOne-arm64.dmg"
  if (platform === "win") return "SuperOne Setup.exe"
  return "SuperOne.AppImage"
}

export function downloadUrl(platform: DesktopPlatform, arch?: DownloadArch): string {
  return `${BASE}/${CHANNEL}/latest/${encodeURIComponent(fixedFileName(platform, arch))}`
}

export function isTarget(
  target: DownloadTarget,
  platform: DesktopPlatform,
  arch?: DownloadArch,
): boolean {
  return target.platform === platform && target.arch === arch
}
