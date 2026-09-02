export type DesktopPlatform = "mac" | "win" | "linux"

export const PLATFORM_LABELS: Record<DesktopPlatform, string> = {
  mac: "macOS",
  win: "Windows",
  linux: "Linux",
}

export const ALL_PLATFORMS: DesktopPlatform[] = ["mac", "win", "linux"]

export function detectPlatform(
  userAgent: string | undefined,
): DesktopPlatform {
  const ua = (userAgent ?? "").toLowerCase()
  if (/windows|win32|win64/.test(ua)) return "win"
  if (/mac os x|macintosh|iphone|ipad/.test(ua)) return "mac"
  if (/linux|x11|cros/.test(ua)) return "linux"
  return "mac"
}
