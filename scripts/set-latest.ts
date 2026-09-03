import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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

function parseInstallerUrls(text: string): string[] {
  return [...text.matchAll(/^\s*-?\s*url:\s*(.+)$/gm)]
    .map((m) => unquote(m[1]))
    .filter((u) => INSTALLER_EXTS.some((ext) => u.toLowerCase().endsWith(ext)))
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

async function artifactExists(baseUrl: string, path: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/${path}`, {
      method: 'HEAD',
      cache: 'no-store',
    })
    return res.ok
  } catch {
    return false
  }
}

async function resolveArtifactPaths(text: string, baseUrl: string): Promise<string> {
  let resolved = text
  for (const path of [...new Set(parseInstallerUrls(text))]) {
    const candidates = artifactPathCandidates(path)
    if (candidates.length === 1 || (await artifactExists(baseUrl, path))) continue
    for (const candidate of candidates.slice(1)) {
      if (await artifactExists(baseUrl, candidate)) {
        console.log(`resolve legacy artifact ${path} -> ${candidate}`)
        resolved = replaceManifestPath(resolved, path, candidate)
        break
      }
    }
  }
  return resolved
}

async function fetchRemoteVersion(baseUrl: string, ymlName: string): Promise<string | null> {
  const url = `${baseUrl}/${ymlName}`
  let res: Response
  try {
    res = await fetch(url, { cache: 'no-store' })
  } catch (err) {
    throw new Error(`could not reach ${url}: ${err instanceof Error ? err.message : String(err)}`)
  }
  // null means "definitively not published", and nothing else. Treating an
  // unreachable manifest as an empty channel would bypass the semver guard and
  // silently skip the legacy bridge, so anything but a 404 fails the run.
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`unexpected ${res.status} fetching ${url}`)
  const match = (await res.text()).match(/^version:\s*(.+)$/m)
  if (!match) throw new Error(`no version field in ${url}`)
  return unquote(match[1])
}

// Refresh the manifests a pre-variant client polls at the bucket root. Only
// names that already exist are rewritten: a missing one means no installed
// build ever read it, and creating it would leave an orphan that
// prune-releases (which scans `<variant>/`) cannot see.
async function stageLegacyRoot(
  platform: Platform,
  prefixed: string,
  variant: string,
  version: string,
  rootUrl: string,
  outDir: string,
  force: boolean,
): Promise<void> {
  const rooted = rootRelativePaths(prefixed, variant)
  for (const name of LEGACY_ROOT_YML_NAMES[platform.key] ?? []) {
    const current = await fetchRemoteVersion(rootUrl, name)
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
  const variantIds = Object.keys(VARIANTS)
  if (!version || !variantIds.includes(variant)) {
    console.error(`usage: set-latest <tag> <${variantIds.join('|')}> [force] [manifestsDir] [baseUrl] [outDir] [planPath] [legacyRoot]`)
    process.exit(1)
  }

  // Each variant is a separate app: its manifests, binaries and fixed links all
  // live under its own prefix, and nothing cascades between them.
  const baseUrl = `${rootUrl}/${variant}`
  console.log(`set-latest version=${version} variant=${variant} force=${force} legacyRoot=${legacyRoot}`)

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
    const prefixed = await resolveArtifactPaths(
      prefixVersionPaths(readFileSync(manifestPath, 'utf8'), version),
      baseUrl,
    )

    if (!force) {
      const current = await fetchRemoteVersion(baseUrl, platform.ymlName)
      if (!shouldPublish(version, current)) {
        console.log(`hold ${variant}/${platform.ymlName}: live ${current} is newer than ${version} (use force to override)`)
        continue
      }
    }
    writeFileSync(join(variantOutDir, platform.ymlName), prefixed)
    console.log(`stage ${variant}/${platform.ymlName} -> ${version}`)

    if (legacyRoot) await stageLegacyRoot(platform, prefixed, variant, version, rootUrl, outDir, force)

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
