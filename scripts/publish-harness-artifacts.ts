#!/usr/bin/env bun
/**
 * Pack pinned harness runtime tarballs, compute SHA-256, stage for R2, and
 * write harness/manifest/<channel>.json.
 *
 * Pins are read from @superone/runtime source constants — never free-form CLI
 * version args — so the manifest cannot drift from the code (design §4).
 *
 * Usage:
 *   bun scripts/publish-harness-artifacts.ts --channel alpha
 *   bun scripts/publish-harness-artifacts.ts --channel alpha --out staging
 *   bun scripts/publish-harness-artifacts.ts --channel alpha --upload
 *
 * --upload requires AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / R2_ACCOUNT_ID
 * (same secrets as promote.yml) and aws CLI.
 */

import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  OFFICIAL_CLAUDE_SDK_VERSION,
  OFFICIAL_CODEX_NPM_VERSION,
  OFFICIAL_CODEX_PACKAGE,
} from '../packages/runtime/src/harness/managed-official.ts'
import type {
  HarnessReleaseManifest,
  HostArch,
  HostPlatform,
  ManagedArtifactPin,
  ManagedHarnessId,
} from '../packages/runtime/src/harness/managed-release.ts'
import {
  HARNESS_CDN_BASE,
  harnessArtifactObjectKey,
  harnessArtifactPublicUrl,
  harnessChannelManifestObjectKey,
  isHarnessManifestChannel,
  type HarnessManifestChannel,
} from '../packages/runtime/src/harness/cdn.ts'

const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')

interface PlatformTarget {
  platform: HostPlatform
  arch: HostArch
  /** npm package name to pack */
  npmName: string
  /** Exact npm version (codex includes platform suffix) */
  npmVersion: string
}

function claudeTargets(version: string): PlatformTarget[] {
  const platforms: Array<{ platform: HostPlatform; arch: HostArch; suffix: string }> = [
    { platform: 'darwin', arch: 'arm64', suffix: 'darwin-arm64' },
    { platform: 'darwin', arch: 'x64', suffix: 'darwin-x64' },
    { platform: 'linux', arch: 'x64', suffix: 'linux-x64' },
    { platform: 'linux', arch: 'arm64', suffix: 'linux-arm64' },
    { platform: 'windows', arch: 'x64', suffix: 'win32-x64' },
    { platform: 'windows', arch: 'arm64', suffix: 'win32-arm64' },
  ]
  return platforms.map((p) => ({
    platform: p.platform,
    arch: p.arch,
    npmName: `@anthropic-ai/claude-agent-sdk-${p.suffix}`,
    npmVersion: version,
  }))
}

function codexTargets(baseVersion: string): PlatformTarget[] {
  const platforms: Array<{ platform: HostPlatform; arch: HostArch; suffix: string }> = [
    { platform: 'darwin', arch: 'arm64', suffix: 'darwin-arm64' },
    { platform: 'darwin', arch: 'x64', suffix: 'darwin-x64' },
    { platform: 'linux', arch: 'x64', suffix: 'linux-x64' },
    { platform: 'linux', arch: 'arm64', suffix: 'linux-arm64' },
    { platform: 'windows', arch: 'x64', suffix: 'win32-x64' },
    { platform: 'windows', arch: 'arm64', suffix: 'win32-arm64' },
  ]
  return platforms.map((p) => ({
    platform: p.platform,
    arch: p.arch,
    npmName: OFFICIAL_CODEX_PACKAGE,
    npmVersion: `${baseVersion}-${p.suffix}`,
  }))
}

function sha256File(path: string): string {
  const hash = createHash('sha256')
  hash.update(readFileSync(path))
  return hash.digest('hex')
}

function readRootVersion(): string {
  const raw = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
    version?: string
  }
  if (!raw.version?.trim()) throw new Error('root package.json missing version')
  return raw.version.trim()
}

/** `npm pack name@version` → absolute path to the produced .tgz */
function npmPack(npmName: string, npmVersion: string, cwd: string): string {
  const spec = `${npmName}@${npmVersion}`
  const before = new Set(readdirSync(cwd).filter((f) => f.endsWith('.tgz')))
  execFileSync('npm', ['pack', spec, '--pack-destination', cwd], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, npm_config_update_notifier: 'false' },
  })
  const after = readdirSync(cwd).filter((f) => f.endsWith('.tgz'))
  const created = after.filter((f) => !before.has(f))
  if (created.length !== 1) {
    // npm pack prints the filename; fall back to newest tgz
    const candidates = after.map((f) => join(cwd, f))
    if (candidates.length === 0) throw new Error(`npm pack produced no tarball for ${spec}`)
    candidates.sort((a, b) => readFileSync(b).length - readFileSync(a).length)
    return candidates[0]!
  }
  return join(cwd, created[0]!)
}

function parseArgs(argv: string[]): {
  channel: HarnessManifestChannel
  outDir: string
  upload: boolean
  baseUrl: string
  skipPack: boolean
} {
  let channel: HarnessManifestChannel | null = null
  let outDir = join(REPO_ROOT, 'staging-harness')
  let upload = false
  let baseUrl = HARNESS_CDN_BASE
  let skipPack = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--channel') {
      const v = argv[++i]
      if (!v || !isHarnessManifestChannel(v)) {
        throw new Error(`--channel must be alpha|beta|stable (got ${v})`)
      }
      channel = v
    } else if (a === '--out') {
      outDir = resolve(argv[++i] ?? outDir)
    } else if (a === '--upload') {
      upload = true
    } else if (a === '--base-url') {
      baseUrl = (argv[++i] ?? baseUrl).replace(/\/+$/, '')
    } else if (a === '--skip-pack') {
      // Rebuild manifest from already-staged artifacts (dev only).
      skipPack = true
    } else if (a === '--help' || a === '-h') {
      console.log(`Usage: bun scripts/publish-harness-artifacts.ts --channel <alpha|beta|stable> [--out dir] [--upload]`)
      process.exit(0)
    } else {
      throw new Error(`unknown arg: ${a}`)
    }
  }
  if (!channel) throw new Error('--channel is required')
  return { channel, outDir, upload, baseUrl, skipPack }
}

function packHarness(
  id: ManagedHarnessId,
  targets: PlatformTarget[],
  packCwd: string,
  outDir: string,
  baseUrl: string,
  runtimeVersion: string,
  artifactVersion: string,
): { pin: HarnessReleaseManifest['managedHarnesses'][ManagedHarnessId]; files: string[] } {
  const artifacts: ManagedArtifactPin[] = []
  const files: string[] = []
  for (const t of targets) {
    process.stdout.write(`  pack ${t.npmName}@${t.npmVersion} … `)
    const tgz = npmPack(t.npmName, t.npmVersion, packCwd)
    const digest = sha256File(tgz)
    const objectKey = harnessArtifactObjectKey(t.npmName, t.npmVersion)
    const dest = join(outDir, objectKey)
    mkdirSync(join(dest, '..'), { recursive: true })
    copyFileSync(tgz, dest)
    files.push(dest)
    const url = harnessArtifactPublicUrl(t.npmName, t.npmVersion, baseUrl)
    artifacts.push({
      platform: t.platform,
      arch: t.arch,
      digestSha256: digest,
      fileName: basename(tgz),
      url,
      npmName: t.npmName,
      npmVersion: t.npmVersion,
    })
    console.log(`${(readFileSync(tgz).byteLength / 1024 / 1024).toFixed(1)} MB  sha256=${digest.slice(0, 12)}…`)
  }
  return {
    pin: { runtimeVersion, artifactVersion, artifacts },
    files,
  }
}

function uploadToR2(outDir: string): void {
  const accountId = process.env.R2_ACCOUNT_ID?.trim()
  if (!accountId) throw new Error('R2_ACCOUNT_ID required for --upload')
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    throw new Error('AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY required for --upload')
  }
  const endpoint = `https://${accountId}.r2.cloudflarestorage.com`
  console.log(`Uploading ${outDir}/ → s3://super-one-releases/ via ${endpoint}`)
  execFileSync(
    'aws',
    [
      's3',
      'sync',
      `${outDir}/`,
      's3://super-one-releases/',
      '--endpoint-url',
      endpoint,
      '--no-progress',
    ],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        AWS_DEFAULT_REGION: process.env.AWS_DEFAULT_REGION ?? 'auto',
      },
    },
  )
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const cliVersion = readRootVersion()
  // Path segment safety: root versions like 0.52.0-alpha are fine.
  console.log(`channel=${args.channel} cliVersion=${cliVersion}`)
  console.log(`claude pin = ${OFFICIAL_CLAUDE_SDK_VERSION}`)
  console.log(`codex  pin = ${OFFICIAL_CODEX_NPM_VERSION}`)
  console.log(`out = ${args.outDir}`)

  if (existsSync(args.outDir)) {
    rmSync(args.outDir, { recursive: true, force: true })
  }
  mkdirSync(args.outDir, { recursive: true })

  const packCwd = mkdtempSync(join(tmpdir(), 'superone-harness-pack-'))
  try {
    if (args.skipPack) {
      throw new Error('--skip-pack is not implemented; always pack from npm pins')
    }

    console.log('\n[claude]')
    const claude = packHarness(
      'claude',
      claudeTargets(OFFICIAL_CLAUDE_SDK_VERSION),
      packCwd,
      args.outDir,
      args.baseUrl,
      OFFICIAL_CLAUDE_SDK_VERSION,
      OFFICIAL_CLAUDE_SDK_VERSION,
    )

    console.log('\n[codex]')
    const codex = packHarness(
      'codex',
      codexTargets(OFFICIAL_CODEX_NPM_VERSION),
      packCwd,
      args.outDir,
      args.baseUrl,
      OFFICIAL_CODEX_NPM_VERSION,
      OFFICIAL_CODEX_NPM_VERSION,
    )

    const manifest: HarnessReleaseManifest = {
      cliVersion,
      managedHarnesses: {
        claude: claude.pin,
        codex: codex.pin,
      },
    }

    const manifestKey = harnessChannelManifestObjectKey(args.channel)
    const manifestPath = join(args.outDir, manifestKey)
    mkdirSync(join(manifestPath, '..'), { recursive: true })
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    console.log(`\nmanifest → ${manifestPath}`)
    console.log(
      `artifacts: claude=${claude.files.length} codex=${codex.files.length} total=${claude.files.length + codex.files.length}`,
    )

    if (args.upload) {
      uploadToR2(args.outDir)
      console.log(`Published ${args.baseUrl}/${manifestKey}`)
    } else {
      console.log('\nDry stage only. Pass --upload to sync to R2.')
    }
  } finally {
    rmSync(packCwd, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
