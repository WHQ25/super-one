import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import VARIANTS from '../apps/desktop/variants.json'
import {
  artifactPathCandidates,
  fixedDownloadPath,
  fixedLinkName,
  LEGACY_ROOT_YML_NAMES,
  prefixVersionPaths,
  rootRelativePaths,
  shouldPublish,
  versionedArtifactPath,
} from './lib/channels'

const INSTALLER_EXTS = ['.dmg', '.exe', '.appimage']

// Every build that predates the variant split carries this appId, so the
// variant that inherited it is the only one whose installer a legacy client may
// be handed -- any other would replace their app with a differently-identified
// bundle in place.
const LEGACY_APP_ID = 'com.superone.app'

interface Platform {
  key: string
  ymlName: string
}

// Every variant sets `publish.channel: latest` explicitly, so electron-builder
// emits the same manifest names for all of them and the variant lives in the
// R2 prefix instead of the file name.
const PLATFORMS: Platform[] = [
  { key: 'mac', ymlName: 'latest-mac.yml' },
  { key: 'win', ymlName: 'latest.yml' },
  { key: 'linux', ymlName: 'latest-linux.yml' },
]

interface CopyOp {
  src: string
  dst: string
}

function unquote(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, '')
}

/** Installer artifacts only -- these get a human-facing fixed download link. */
function parseInstallerUrls(text: string): string[] {
  return [...text.matchAll(/^\s*-?\s*url:\s*(.+)$/gm)]
    .map((m) => unquote(m[1]))
    .filter((u) => INSTALLER_EXTS.some((ext) => u.toLowerCase().endsWith(ext)))
}

/**
 * Every relative artifact the manifest points at, including the mac `.zip`.
 *
 * The zip is not an installer -- nobody downloads it by hand -- but it IS what
 * electron-updater fetches on macOS, so it has to survive the dotted-name
 * rescue below or a backfilled alpha release 404s on exactly the file the
 * updater needs.
 */
function parseArtifactPaths(text: string): string[] {
  return [...text.matchAll(/^\s*-?\s*(?:url|path):\s*(.+)$/gm)]
    .map((m) => unquote(m[1]))
    .filter((u) => !/^https?:\/\//.test(u))
}

function replaceManifestPath(text: string, current: string, replacement: string): string {
  return text
    .split('\n')
    .map((line) => {
      const match = line.match(/^(\s*-?\s*(?:url|path):\s*)(.+?)\s*$/)
      if (!match || unquote(match[2]) !== current) return line
      const quote = match[2].trim().match(/^['"]/)?.[0] ?? ''
      return `${match[1]}${quote}${replacement}${quote}`
    })
    .join('\n')
}

const BUCKET = process.env.R2_BUCKET ?? 'super-one-releases'

/**
 * Ask the BUCKET what is live, never the public URL.
 *
 * What every caller below actually needs is a three-state answer -- "this
 * version", "never published", "I do not know" -- and the third has to be
 * fatal, because treating it as "never published" bypasses the semver guard and
 * silently skips the legacy bridge.
 *
 * The public URL cannot give that answer. `dl.super-one.dev` returns 404 for a
 * missing object to some clients and 403 to others (GitHub runners get 403,
 * reproducibly), so the "definitively absent" branch was unreachable from CI
 * and the first publish to any new variant prefix failed -- exactly the path
 * the stable cutover takes. A 403 from a CDN edge says nothing about the
 * bucket's contents, so widening the check to accept it would have thrown away
 * the guard rather than fixed it.
 *
 * s3api distinguishes the two properly: a missing key is `(404) Not Found` /
 * `NoSuchKey`, a credentials problem is `(403) Forbidden` / `AccessDenied`. It
 * also reads through no CDN cache, so a 200 here is the authoritative state
 * rather than whatever the edge last stored.
 */
function awsS3Api(args: string[]): { status: number; stdout: string; stderr: string } {
  const endpoint = process.env.R2_ENDPOINT_URL
  if (!endpoint) {
    throw new Error('R2_ENDPOINT_URL is required — reads go to the bucket, not the public URL')
  }
  const res = spawnSync('aws', ['s3api', ...args, '--endpoint-url', endpoint], {
    encoding: 'utf8',
  })
  if (res.error) throw new Error(`aws s3api failed to run: ${res.error.message}`)
  return { status: res.status ?? 1, stdout: res.stdout ?? '', stderr: (res.stderr ?? '').trim() }
}

/** True only for "this key is not in the bucket". Any other failure throws. */
function isMissingKeyError(stderr: string): boolean {
  return /\(404\)|NoSuchKey|Not Found/i.test(stderr)
}

function objectExists(key: string): boolean {
  const res = awsS3Api(['head-object', '--bucket', BUCKET, '--key', key])
  if (res.status === 0) return true
  if (isMissingKeyError(res.stderr)) return false
  throw new Error(`could not stat s3://${BUCKET}/${key}: ${res.stderr || `aws exited ${res.status}`}`)
}

/** Object body, or null when the key is definitively absent. */
function readObject(key: string): string | null {
  const out = join(mkdtempSync(join(tmpdir(), 'set-latest-')), 'object')
  const res = awsS3Api(['get-object', '--bucket', BUCKET, '--key', key, out])
  if (res.status === 0) return readFileSync(out, 'utf8')
  if (isMissingKeyError(res.stderr)) return null
  throw new Error(`could not read s3://${BUCKET}/${key}: ${res.stderr || `aws exited ${res.status}`}`)
}

function resolveArtifactPaths(text: string, variant: string): string {
  let resolved = text
  for (const path of [...new Set(parseArtifactPaths(text))]) {
    const candidates = artifactPathCandidates(path)
    if (candidates.length === 1 || objectExists(`${variant}/${path}`)) continue
    for (const candidate of candidates.slice(1)) {
      if (objectExists(`${variant}/${candidate}`)) {
        console.log(`resolve legacy artifact ${path} -> ${candidate}`)
        resolved = replaceManifestPath(resolved, path, candidate)
        break
      }
    }
  }
  return resolved
}

/** Version a manifest key currently names, or null when it was never published. */
function remoteVersion(key: string): string | null {
  const body = readObject(key)
  if (body === null) return null
  const match = body.match(/^version:\s*(.+)$/m)
  if (!match) throw new Error(`no version field in s3://${BUCKET}/${key}`)
  return unquote(match[1])
}

// Refresh the manifests a pre-variant client polls at the bucket root. Only
// names that already exist are rewritten: a missing one means no installed
// build ever read it, and creating it would leave an orphan that
// prune-releases (which scans `<variant>/`) cannot see.
function stageLegacyRoot(
  platform: Platform,
  prefixed: string,
  variant: string,
  version: string,
  outDir: string,
  force: boolean,
): void {
  const rooted = rootRelativePaths(prefixed, variant)
  for (const name of LEGACY_ROOT_YML_NAMES[platform.key] ?? []) {
    // Legacy names live at the bucket ROOT, so the key is the bare filename.
    const current = remoteVersion(name)
    if (current === null) {
      console.log(`skip legacy root ${name}: not published, no client reads it`)
      continue
    }
    if (!force && !shouldPublish(version, current)) {
      console.log(`hold legacy root ${name}: live ${current} is newer than ${version}`)
      continue
    }
    writeFileSync(join(outDir, name), rooted)
    console.log(`stage legacy root ${name} -> ${version} (${variant}/v${version}/)`)
  }
}

async function main(): Promise<void> {
  const tag = process.argv[2] ?? ''
  const variant = process.argv[3] ?? ''
  const force = (process.argv[4] ?? 'false') === 'true'
  const manifestsDir = process.argv[5] ?? 'manifests'
  const rootUrl = (process.argv[6] ?? 'https://dl.super-one.dev').replace(/\/+$/, '')
  const outDir = process.argv[7] ?? 'out'
  const planPath = process.argv[8] ?? 'fixed-copies.json'
  const legacyRoot = (process.argv[9] ?? 'false') === 'true'

  const version = tag.replace(/^v/, '')
  // A variant with no download prefix publishes nothing and has no R2 layout,
  // so it is not a thing this script can be pointed at.
  const variantIds = Object.entries(VARIANTS as Record<string, { downloadPrefix: string | null }>)
    .filter(([, v]) => v.downloadPrefix !== null)
    .map(([id]) => id)
  if (!version || !variantIds.includes(variant)) {
    console.error(`usage: set-latest <tag> <${variantIds.join('|')}> [force] [manifestsDir] [baseUrl] [outDir] [planPath] [legacyRoot]`)
    process.exit(1)
  }

  // Each variant is a separate app: its manifests, binaries and fixed links all
  // live under its own prefix, and nothing cascades between them. `rootUrl` is
  // where clients will READ this; every check below reads the bucket instead.
  console.log(`set-latest version=${version} variant=${variant} force=${force} legacyRoot=${legacyRoot}`)
  console.log(`bucket=s3://${BUCKET}/${variant}/  public=${rootUrl}/${variant}/`)

  const legacyAppId = (VARIANTS as Record<string, { appId: string }>)[variant].appId
  if (legacyRoot && legacyAppId !== LEGACY_APP_ID) {
    console.error(
      `refusing legacyRoot for variant "${variant}" (appId ${legacyAppId}): pre-variant clients are ` +
        `${LEGACY_APP_ID} and must only ever be offered that app's builds`,
    )
    process.exit(1)
  }

  const variantOutDir = join(outDir, variant)
  mkdirSync(variantOutDir, { recursive: true })
  const plan: CopyOp[] = []

  for (const platform of PLATFORMS) {
    const manifestPath = join(manifestsDir, platform.ymlName)
    if (!existsSync(manifestPath)) {
      console.log(`skip ${platform.key}: ${platform.ymlName} not downloaded`)
      continue
    }
    const prefixed = resolveArtifactPaths(
      prefixVersionPaths(readFileSync(manifestPath, 'utf8'), version),
      variant,
    )

    if (!force) {
      const current = remoteVersion(`${variant}/${platform.ymlName}`)
      if (!shouldPublish(version, current)) {
        console.log(`hold ${variant}/${platform.ymlName}: live ${current} is newer than ${version} (use force to override)`)
        continue
      }
    }
    writeFileSync(join(variantOutDir, platform.ymlName), prefixed)
    console.log(`stage ${variant}/${platform.ymlName} -> ${version}`)

    if (legacyRoot) stageLegacyRoot(platform, prefixed, variant, version, outDir, force)

    for (const url of parseInstallerUrls(prefixed)) {
      const fileName = basename(url)
      plan.push({
        src: versionedArtifactPath(variant, version, fileName),
        dst: fixedDownloadPath(variant, fixedLinkName(fileName, version)),
      })
    }
  }

  writeFileSync(planPath, JSON.stringify(plan, null, 2))
  console.log(`wrote ${plan.length} fixed-link copy ops to ${planPath}`)
}

void main()
