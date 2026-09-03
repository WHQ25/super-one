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
 * The arch suffixes are what electron-builder actually emits for each target,
 * which is not uniform and is not guessable:
 *
 *   - mac  `-x64` / `-arm64`. An EXPLICIT artifactName does not collapse
 *          `${arch}` on x64 the way the built-in default does.
 *   - win  none. The workflow builds only the host arch and NSIS emits one
 *          installer, so the template carries no `${arch}` to render.
 *   - linux `x86_64`, not `x64` — electron-builder spells an AppImage's arch
 *          the AppImage way.
 *
 * Every one of these was wrong on first guess. Read a build log before
 * changing them; nothing here fails until a download 404s.
 */
const APPIMAGE_ARCH: Record<DownloadArch, string> = { x64: 'x86_64', arm64: 'arm64' }

export function fixedInstallerName(
  artifactBaseName: string,
  platform: DownloadPlatform,
  arch?: DownloadArch,
  prereleaseTag?: string | null,
): string {
  const stem = prereleaseTag ? `${artifactBaseName}-${prereleaseTag}` : artifactBaseName
  if (platform === 'mac') return `${stem}-${arch ?? 'arm64'}.dmg`
  if (platform === 'win') return `${stem}-Setup.exe`
  return `${stem}-${APPIMAGE_ARCH[arch ?? 'x64']}.AppImage`
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
