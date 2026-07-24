import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { UpdateChannel } from '@superone/shared/agent-types'
import { UPDATE_CHANNELS, UPDATE_CHANNEL_TO_YML, type YmlChannel } from '@superone/shared/update-channels'
import {
  artifactPathCandidates,
  cascadeTargets,
  fixedDownloadPath,
  fixedLinkName,
  nativeYmlChannel,
  prefixVersionPaths,
  shouldPublish,
  YML_TO_UPDATE_CHANNEL,
} from './lib/channels'

const INSTALLER_EXTS = ['.dmg', '.exe', '.appimage']

interface Platform {
  key: string
  ymlName: (channel: YmlChannel) => string
}

const PLATFORMS: Platform[] = [
  { key: 'mac', ymlName: (c) => `${c}-mac.yml` },
  { key: 'win', ymlName: (c) => `${c}.yml` },
  { key: 'linux', ymlName: (c) => `${c}-linux.yml` },
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
  const channel = process.argv[3] as UpdateChannel
  const force = (process.argv[4] ?? 'false') === 'true'
  const manifestsDir = process.argv[5] ?? 'manifests'
  const baseUrl = (process.argv[6] ?? 'https://dl.super-one.dev').replace(/\/+$/, '')
  const outDir = process.argv[7] ?? 'out'
  const planPath = process.argv[8] ?? 'fixed-copies.json'

  const version = tag.replace(/^v/, '')
  if (!version || !UPDATE_CHANNELS.includes(channel)) {
    console.error('usage: set-latest <tag> <alpha|beta|stable> [force] [manifestsDir] [baseUrl] [outDir] [planPath]')
    process.exit(1)
  }

  const nativeChannel = nativeYmlChannel(version)
  const targets = cascadeTargets(UPDATE_CHANNEL_TO_YML[channel])
  console.log(`set-latest version=${version} channel=${channel} force=${force} cascade=${targets.join(',')}`)

  mkdirSync(outDir, { recursive: true })
  const plan: CopyOp[] = []

  for (const platform of PLATFORMS) {
    const manifestPath = join(manifestsDir, platform.ymlName(nativeChannel))
    if (!existsSync(manifestPath)) {
      console.log(`skip ${platform.key}: ${platform.ymlName(nativeChannel)} not downloaded`)
      continue
    }
    const prefixed = await resolveArtifactPaths(
      prefixVersionPaths(readFileSync(manifestPath, 'utf8'), version),
      baseUrl,
    )
    const installerUrls = parseInstallerUrls(prefixed)

    for (const target of targets) {
      const targetName = platform.ymlName(target)
      if (!force) {
        const current = await fetchRemoteVersion(baseUrl, targetName)
        if (!shouldPublish(version, current)) {
          console.log(`hold ${targetName}: live ${current} is newer than ${version} (use force to override)`)
          continue
        }
      }
      writeFileSync(join(outDir, targetName), prefixed)
      console.log(`stage ${targetName} -> ${version}`)
      for (const url of installerUrls) {
        plan.push({
          src: url,
          dst: fixedDownloadPath(YML_TO_UPDATE_CHANNEL[target], fixedLinkName(basename(url), version)),
        })
      }
    }
  }

  writeFileSync(planPath, JSON.stringify(plan, null, 2))
  console.log(`wrote ${plan.length} fixed-link copy ops to ${planPath}`)
}

void main()
