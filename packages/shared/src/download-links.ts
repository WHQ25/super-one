/**
 * Human-facing download links for a packaged variant.
 *
 * `set-latest` copies each release's installers to `<variant>/latest/<name>`,
 * where `<name>` is the artifact name with its version stripped. Stripping the
 * version out of electron-builder's default artifact names leaves a pure
 * function of the variant's `productName`, which is what this file encodes --
 * see `fixedLinkName` in `scripts/lib/channels.ts` for the producing half.
 *
 * Both halves have to agree, so keep this the only copy: the desktop app (for
 * the Alpha link in Settings) and the marketing site both read it.
 */

export type DownloadPlatform = 'mac' | 'win' | 'linux'
export type DownloadArch = 'arm64' | 'x64'

export const DOWNLOAD_BASE_URL = 'https://dl.super-one.dev'

/** Map a Node `process.platform` onto the three platforms we publish for. */
export function downloadPlatformFor(nodePlatform: string): DownloadPlatform {
  if (nodePlatform === 'darwin') return 'mac'
  if (nodePlatform === 'win32') return 'win'
  return 'linux'
}

/**
 * The version-less installer name published under `<variant>/latest/`.
 *
 * Only macOS ships two architectures; the Windows and Linux fixed links are
 * single files, matching what electron-builder emits for those targets.
 */
export function fixedInstallerName(
  productName: string,
  platform: DownloadPlatform,
  arch?: DownloadArch,
): string {
  if (platform === 'mac') {
    return arch === 'x64' ? `${productName}.dmg` : `${productName}-arm64.dmg`
  }
  if (platform === 'win') return `${productName} Setup.exe`
  return `${productName}.AppImage`
}

export interface FixedDownloadUrlOptions {
  /** The variant's R2 prefix (`variants.json` → `downloadPrefix`). */
  downloadPrefix: string
  /** The variant's `productName`; the installer name derives from it. */
  productName: string
  platform: DownloadPlatform
  arch?: DownloadArch
  baseUrl?: string
}

export function fixedDownloadUrl(options: FixedDownloadUrlOptions): string {
  const base = (options.baseUrl ?? DOWNLOAD_BASE_URL).replace(/\/+$/, '')
  // The product name can contain a space ("SuperOne Alpha"), so the last
  // segment has to be encoded or the URL breaks for exactly the variant this
  // link exists to offer.
  const name = encodeURIComponent(
    fixedInstallerName(options.productName, options.platform, options.arch),
  )
  return `${base}/${options.downloadPrefix}/latest/${name}`
}
