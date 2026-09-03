// Release-manifest helpers.
//
// There is no channel cascade any more: stable and alpha are separate apps
// with separate bundle identities, so offering a stable build to the alpha
// app would hand it an installer whose appId does not match. Each variant owns
// one prefix on R2 and publishes a single `latest-*.yml` inside it.

interface ParsedVersion {
  core: [number, number, number]
  pre: string[]
}

function parseVersion(version: string): ParsedVersion {
  const clean = version.trim().replace(/^v/i, '').split('+')[0]
  const dash = clean.indexOf('-')
  const coreStr = dash === -1 ? clean : clean.slice(0, dash)
  const preStr = dash === -1 ? '' : clean.slice(dash + 1)
  const parts = coreStr.split('.').map((n) => Number(n) || 0)
  return {
    core: [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0],
    pre: preStr ? preStr.split('.') : [],
  }
}

// SemVer precedence: returns -1 | 0 | 1. A release with a prerelease tag ranks
// below the same core version without one (1.0.0-alpha < 1.0.0).
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  for (let i = 0; i < 3; i++) {
    if (pa.core[i] !== pb.core[i]) return pa.core[i] < pb.core[i] ? -1 : 1
  }
  if (pa.pre.length === 0 && pb.pre.length === 0) return 0
  if (pa.pre.length === 0) return 1
  if (pb.pre.length === 0) return -1
  const n = Math.min(pa.pre.length, pb.pre.length)
  for (let i = 0; i < n; i++) {
    const x = pa.pre[i]
    const y = pb.pre[i]
    const xn = /^\d+$/.test(x)
    const yn = /^\d+$/.test(y)
    if (xn && yn) {
      const dx = Number(x)
      const dy = Number(y)
      if (dx !== dy) return dx < dy ? -1 : 1
    } else if (xn !== yn) {
      return xn ? -1 : 1
    } else if (x !== y) {
      return x < y ? -1 : 1
    }
  }
  if (pa.pre.length !== pb.pre.length) return pa.pre.length < pb.pre.length ? -1 : 1
  return 0
}

// Whether `next` should overwrite a channel currently pointing at `current`.
// Equal versions re-publish (idempotent); older versions never clobber newer.
export function shouldPublish(next: string, current: string | null): boolean {
  return current === null || compareVersions(next, current) >= 0
}

function prefixManifestPaths(ymlText: string, prefix: string): string {
  return ymlText.replace(/^(\s*-?\s*(?:url|path):\s+)(.+?)\s*$/gm, (_m, head: string, value: string) => {
    if (value.startsWith(prefix) || /^https?:\/\//.test(value)) return `${head}${value}`
    return `${head}${prefix}${value}`
  })
}

// Prefix every `url:` / `path:` value in a channel manifest with `v${version}/`,
// matching the R2 layout (binaries live under the version subdir). Leaves values
// already prefixed or absolute untouched. Relocates the flat manifests archived
// on the GitHub Release onto R2's versioned layout.
export function prefixVersionPaths(ymlText: string, version: string): string {
  return prefixManifestPaths(ymlText, `v${version}/`)
}

// Re-root a variant's manifest for a client that resolves relative paths against
// the bucket root rather than the variant prefix: `v1.2.3/x.dmg` -> `stable/v1.2.3/x.dmg`.
export function rootRelativePaths(ymlText: string, variant: string): string {
  return prefixManifestPaths(ymlText, `${variant}/`)
}

// The manifest names pre-variant clients poll at the BUCKET ROOT. Those builds
// baked in `url: https://dl.super-one.dev` with no variant segment and derived
// the channel from their own version, so they will never look inside a variant
// prefix. Refreshing these is the only way to reach an installed legacy client.
export const LEGACY_ROOT_YML_NAMES: Record<string, string[]> = {
  mac: ['alpha-mac.yml', 'beta-mac.yml', 'latest-mac.yml'],
  win: ['alpha.yml', 'beta.yml', 'latest.yml'],
  linux: ['alpha-linux.yml', 'beta-linux.yml', 'latest-linux.yml'],
}

// Strip the release number (and its leading separator) from an artifact
// filename to produce a stable "latest" download name.
// "SuperOne-0.61.0-alpha-arm64.dmg" -> "SuperOne-alpha-arm64.dmg"
// "SuperOne-0.62.0-arm64.dmg"       -> "SuperOne-arm64.dmg"
//
// Only the semver CORE goes. The prerelease tag stays, and that is what keeps
// the two variants' fixed links apart: both build their installers from the
// same base name now, so stripping the whole version would publish
// `stable/latest/SuperOne-arm64.dmg` and `alpha/latest/SuperOne-arm64.dmg` --
// identical filenames, distinguished only by a prefix the browser drops. Two
// downloads in one folder would then be `SuperOne-arm64.dmg` and
// `SuperOne-arm64 (1).dmg` with nothing to tell them apart.
//
// The consuming half is `fixedInstallerName` in
// `@superone/shared/download-links`, which the desktop app and the marketing
// site both read. Change one and the other 404s with nothing failing in CI.
export function fixedLinkName(filename: string, version: string): string {
  const core = version.trim().replace(/^v/i, '').split('-')[0]
  const escaped = core.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const withoutVersion = filename.replace(new RegExp(`[ ._-]?${escaped}`), '')
  if (!withoutVersion.toLowerCase().endsWith('.exe')) return withoutVersion
  const stem = withoutVersion.slice(0, -'.exe'.length).replaceAll('.', ' ')
  return `${stem}.exe`
}

// Stable, version-less download URL path for a variant's newest build, e.g.
// fixedDownloadPath('alpha', 'SuperOne Alpha.dmg') -> 'alpha/latest/SuperOne Alpha.dmg'.
export function fixedDownloadPath(variant: string, fileName: string): string {
  return `${variant}/latest/${fileName}`
}

// GitHub normalizes spaces in release asset names to dots, so a version
// backfilled from a Release can sit on R2 under a dotted key while the manifest
// still spells it with spaces.
//
// This is keyed on the space, not on the extension: the alpha variant's
// productName contains one, which puts a space in EVERY one of its artifacts --
// including the mac `.zip`, which is the file the updater actually downloads.
// A name with no space produces an identical candidate and is filtered out.
export function artifactPathCandidates(path: string): string[] {
  const slash = path.lastIndexOf('/') + 1
  const dotted = `${path.slice(0, slash)}${path.slice(slash).replaceAll(' ', '.')}`
  return dotted === path ? [path] : [path, dotted]
}

// Where promote.yml archives a build's binaries. The update manifest lives at
// `<variant>/latest-*.yml` and its urls are relative, so they resolve here.
export function versionedArtifactPath(variant: string, version: string, fileName: string): string {
  return `${variant}/v${version}/${fileName}`
}
