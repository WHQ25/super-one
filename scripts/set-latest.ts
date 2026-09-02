import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import VARIANTS from '../apps/desktop/variants.json'
import {
  artifactPathCandidates,
  fixedDownloadPath,
  fixedLinkName,
  prefixVersionPaths,
  shouldPublish,
  versionedArtifactPath,
} from './lib/channels'

const INSTALLER_EXTS = ['.dmg', '.exe', '.appimage']

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
  try {
    const res = await fetch(`${baseUrl}/${ymlName}`, { cache: 'no-store' })
    if (!res.ok) return null
    const match = (await res.text()).match(/^version:\s*(.+)$/m)
    return match ? unquote(match[1]) : null
  } catch {
    return null
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

  const version = tag.replace(/^v/, '')
  const variantIds = Object.keys(VARIANTS)
  if (!version || !variantIds.includes(variant)) {
    console.error(`usage: set-latest <tag> <${variantIds.join('|')}> [force] [manifestsDir] [baseUrl] [outDir] [planPath]`)
    process.exit(1)
  }

  // Each variant is a separate app: its manifests, binaries and fixed links all
  // live under its own prefix, and nothing cascades between them.
  const baseUrl = `${rootUrl}/${variant}`
  console.log(`set-latest version=${version} variant=${variant} force=${force}`)

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
