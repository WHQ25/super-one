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
 * The release-number-less installer name published under `<variant>/latest/`.
 *
 * Built from the variant's `artifactBaseName` and `prereleaseTag`, NOT its
 * `productName`: both variants now name their installers "SuperOne", and the
 * tag is the only thing keeping `stable/latest/` and `alpha/latest/` from
 * handing out byte-different files under one filename.
 *
 * Only macOS ships two architectures, and `${arch}` collapses to nothing on
 * x64, so only arm64 carries a suffix. The Windows and Linux fixed links are
 * single files, matching what electron-builder emits for those targets.
 */
export function fixedInstallerName(
  artifactBaseName: string,
  platform: DownloadPlatform,
  arch?: DownloadArch,
  prereleaseTag?: string | null,
): string {
  const stem = prereleaseTag ? `${artifactBaseName}-${prereleaseTag}` : artifactBaseName
  if (platform === 'mac') {
    return arch === 'x64' ? `${stem}.dmg` : `${stem}-arm64.dmg`
  }
  if (platform === 'win') return `${stem}-Setup.exe`
  return `${stem}.AppImage`
}

export interface FixedDownloadUrlOptions {
  /** The variant's R2 prefix (`variants.json` → `downloadPrefix`). */
  downloadPrefix: string
  /** The variant's `artifactBaseName`; the installer name derives from it. */
  artifactBaseName: string
  /** The variant's `prereleaseTag`, or null for the variant that has none. */
  prereleaseTag?: string | null
  platform: DownloadPlatform
  arch?: DownloadArch
  baseUrl?: string
}

export function fixedDownloadUrl(options: FixedDownloadUrlOptions): string {
  const base = (options.baseUrl ?? DOWNLOAD_BASE_URL).replace(/\/+$/, '')
  // No current installer name contains a space, but encoding the last segment
  // costs nothing and keeps a rollback to a historical, spaced artifact name
  // from producing a broken URL.
  const name = encodeURIComponent(
    fixedInstallerName(
      options.artifactBaseName,
      options.platform,
      options.arch,
      options.prereleaseTag,
    ),
  )
  return `${base}/${options.downloadPrefix}/latest/${name}`
}
