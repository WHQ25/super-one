#!/usr/bin/env bun
/**
 * Publish a mobile native-binary update pointer to R2.
 *
 * Android gets a real artifact: the APK lands at an immutable versioned key and
 * `mobile/android/latest.json` points at it. iOS has no artifact -- TestFlight
 * owns installation -- so its manifest carries only the numbers the app needs
 * to nag or to block, plus the TestFlight link.
 *
 * `latest.json` is the only mutable object in the layout, which is what makes a
 * rollback a one-object re-point rather than a rebuild.
 *
 * Usage:
 *   bun scripts/publish-mobile-update.ts --platform android --version 1.0.0 \
 *     --build-code 42 --apk ./superone.apk
 *   bun scripts/publish-mobile-update.ts --platform android ... --upload
 *   bun scripts/publish-mobile-update.ts --platform android --track alpha ...
 *   bun scripts/publish-mobile-update.ts --check-stable-floor
 *   bun scripts/publish-mobile-update.ts --platform ios --version 1.0.0 \
 *     --build-code 42 --testflight-url https://testflight.apple.com/join/abcd
 *
 * --upload and --check-stable-floor require AWS_ACCESS_KEY_ID /
 * AWS_SECRET_ACCESS_KEY and R2_ACCOUNT_ID (or R2_ENDPOINT_URL), plus the aws CLI.
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import {
  androidApkObjectKey,
  androidApkUrl,
  MOBILE_UPDATE_SCHEMA_VERSION,
  mobileUpdateManifestObjectKey,
  mobileUpdateManifestUrl,
  parseMobileUpdateManifest,
  type MobileUpdateManifest,
  type MobileUpdatePlatform,
  type MobileUpdateTrack,
} from '../packages/shared/src/mobile-updates.ts'
import { DOWNLOAD_BASE_URL, MAC_UPDATE_MANIFEST } from '../packages/shared/src/download-links.ts'
import { compareCliVersions } from '../packages/shared/src/environment/cli-version.ts'
import { MIN_PHONE_DESKTOP_VERSION } from '../packages/relay-client/src/phone-version.ts'
import { awsEnv, R2_BUCKET as BUCKET, r2Endpoint, readR2Object, requireR2Credentials } from './lib/r2'

// The APK sits at a key that encodes its own build code, so it can never be
// replaced in place -- a year of browser/CDN caching is the correct answer.
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable'
// Pointer objects must never be served stale: a rollback the CDN keeps hidden
// for its TTL is not a rollback. Mirrors set-latest.yml.
const POINTER_CACHE_CONTROL = 'no-cache'

export type PublishArgs = {
  platform: MobileUpdatePlatform
  track: MobileUpdateTrack
  version: string
  buildCode: number
  apkPath: string | null
  testflightUrl: string | null
  minSupportedBuildCode: number | null
  outDir: string
  upload: boolean
  baseUrl: string
  rollback: boolean
}

export function parseArgs(argv: string[], repoRoot: string): PublishArgs {
  let platform: MobileUpdatePlatform | null = null
  let track: MobileUpdateTrack = 'stable'
  let version = ''
  let buildCode: number | null = null
  let apkPath: string | null = null
  let testflightUrl: string | null = null
  let minSupportedBuildCode: number | null = null
  let outDir = join(repoRoot, 'staging-mobile')
  let upload = false
  let baseUrl = DOWNLOAD_BASE_URL
  let rollback = false

  const intArg = (raw: string | undefined, flag: string): number => {
    const n = Number(raw)
    if (!raw || !Number.isSafeInteger(n)) throw new Error(`${flag} requires an integer (got ${raw})`)
    return n
  }

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--platform') {
      const v = argv[++i]
      if (v !== 'android' && v !== 'ios') throw new Error(`--platform must be android|ios (got ${v})`)
      platform = v
    } else if (a === '--track') {
      const v = argv[++i]
      if (v !== 'stable' && v !== 'alpha') throw new Error(`--track must be stable|alpha (got ${v})`)
      track = v
    } else if (a === '--version') {
      version = (argv[++i] ?? '').trim()
      if (!version) throw new Error('--version requires a value')
    } else if (a === '--build-code') {
      buildCode = intArg(argv[++i], '--build-code')
    } else if (a === '--apk') {
      apkPath = resolve(argv[++i] ?? '')
    } else if (a === '--testflight-url') {
      testflightUrl = (argv[++i] ?? '').trim()
    } else if (a === '--min-supported-build-code') {
      minSupportedBuildCode = intArg(argv[++i], '--min-supported-build-code')
    } else if (a === '--out') {
      outDir = resolve(argv[++i] ?? outDir)
    } else if (a === '--upload') {
      upload = true
    } else if (a === '--base-url') {
      baseUrl = (argv[++i] ?? baseUrl).replace(/\/+$/, '')
    } else if (a === '--rollback') {
      rollback = true
    } else if (a === '--help' || a === '-h') {
      console.log(
        'Usage: bun scripts/publish-mobile-update.ts --platform <android|ios> [--track stable|alpha] --version X.Y.Z ' +
          '--build-code N [--apk file.apk] [--testflight-url URL] ' +
          '[--min-supported-build-code N] [--out dir] [--upload] [--rollback]',
      )
      process.exit(0)
    } else {
      throw new Error(`unknown arg: ${a}`)
    }
  }

  if (!platform) throw new Error('--platform is required')
  if (!version) throw new Error('--version is required')
  if (buildCode === null) throw new Error('--build-code is required')
  if (buildCode <= 0) throw new Error(`--build-code must be positive (got ${buildCode})`)
  if (platform === 'android' && !apkPath) throw new Error('--apk is required for android')
  if (platform === 'ios' && !testflightUrl) {
    throw new Error('--testflight-url is required for ios')
  }

  return {
    platform,
    track,
    version,
    buildCode,
    apkPath,
    testflightUrl,
    minSupportedBuildCode,
    outDir,
    upload,
    baseUrl,
    rollback,
  }
}

export type PublishPlan = {
  buildCode: number
  minSupportedBuildCode: number
  previousBuildCode: number | null
  previousMinSupportedBuildCode: number | null
  /** Set when this publish raises the hard gate -- the one irreversible-ish move. */
  raisesFloor: boolean
  /** Set when `latest` is being pointed at an older build. */
  movesBackwards: boolean
}

/**
 * Reconcile the requested numbers against what is already published.
 *
 * Two rules, and both of them keep an escape hatch on purpose:
 *
 *   - `latest` normally has to move forward. Pointing it back is the documented
 *     rollback, so it is allowed behind `--rollback` rather than forbidden.
 *   - `minSupportedBuildCode` is inherited unless asked to change. Raising it
 *     locks out every older build with no client-side way out, so it is only
 *     ever raised on an explicit request. Lowering it is how you *recover* from
 *     a floor set too high, so lowering stays available -- refusing it would
 *     leave hand-editing R2 as the only way back.
 */
export function resolveMobileUpdatePlan(input: {
  buildCode: number
  requestedMinSupportedBuildCode: number | null
  current: MobileUpdateManifest | null
  rollback: boolean
}): PublishPlan {
  const { buildCode, requestedMinSupportedBuildCode: requested, current, rollback } = input

  const previousBuildCode = current?.buildCode ?? null
  const movesBackwards = previousBuildCode !== null && buildCode <= previousBuildCode
  if (movesBackwards && !rollback) {
    throw new Error(
      `build code ${buildCode} does not advance the published ${previousBuildCode}; ` +
        'pass --rollback to point latest.json at an older build on purpose',
    )
  }

  const previousMin = current?.minSupportedBuildCode ?? null
  const minSupportedBuildCode = requested ?? previousMin ?? 0
  if (minSupportedBuildCode < 0) {
    throw new Error(`minimum supported build code must not be negative (got ${minSupportedBuildCode})`)
  }
  if (minSupportedBuildCode > buildCode) {
    throw new Error(
      `minimum supported build code ${minSupportedBuildCode} is above the published build ` +
        `${buildCode}; that would hard-gate every user onto a build that does not exist`,
    )
  }

  return {
    buildCode,
    minSupportedBuildCode,
    previousBuildCode,
    previousMinSupportedBuildCode: previousMin,
    raisesFloor: previousMin !== null && minSupportedBuildCode > previousMin,
    movesBackwards,
  }
}

/**
 * Refuse a stable phone that the stable desktop cannot serve.
 *
 * The phone refuses any desktop below `MIN_PHONE_DESKTOP_VERSION`, and stable
 * phones update themselves. Shipping one whose floor is above the released
 * stable desktop strands every stable user who updates -- an Android
 * `versionCode` cannot be downgraded, and TestFlight auto-updates. Such a build
 * belongs on the alpha track until a stable desktop catches up.
 *
 * `--check-stable-floor` runs this alone. The release workflow calls it before
 * building a stable binary: iOS hands the build to TestFlight before any
 * manifest is published, so a check at publish time would come too late.
 */
export function assertStableDesktopServesPhone(
  stableDesktopVersion: string,
  minDesktopVersion = MIN_PHONE_DESKTOP_VERSION,
): void {
  if (compareCliVersions(stableDesktopVersion, minDesktopVersion) < 0) {
    throw new Error(
      `this phone requires desktop ${minDesktopVersion} but stable desktop is ` +
        `${stableDesktopVersion}; publish it on the alpha track, or release a stable desktop first`,
    )
  }
}

/** `version:` of the stable variant's macOS update feed, the released stable desktop. */
function fetchStableDesktopVersion(): string {
  requireR2Credentials()
  const key = `stable/${MAC_UPDATE_MANIFEST}`
  const body = readR2Object(key)
  if (body === null) throw new Error(`s3://${BUCKET}/${key} is not published`)
  const version = /^version:\s*['"]?([^'"\s]+)/m.exec(body)?.[1]
  if (!version) throw new Error(`s3://${BUCKET}/${key} carries no version`)
  return version
}

export function buildManifest(input: {
  platform: MobileUpdatePlatform
  version: string
  plan: PublishPlan
  releasedAt: string
  artifact?: { url: string; md5: string; sizeBytes: number }
  testflightUrl?: string
}): MobileUpdateManifest {
  const manifest: MobileUpdateManifest = {
    schemaVersion: MOBILE_UPDATE_SCHEMA_VERSION,
    platform: input.platform,
    version: input.version,
    buildCode: input.plan.buildCode,
    minSupportedBuildCode: input.plan.minSupportedBuildCode,
    releasedAt: input.releasedAt,
  }
  if (input.artifact) manifest.artifact = input.artifact
  if (input.testflightUrl) manifest.testflightUrl = input.testflightUrl
  return manifest
}

/**
 * Read the live manifest through the S3 API, not the public URL.
 *
 * The CDN is allowed to be a moment behind; the monotonicity check is not.
 */
function fetchPublishedManifest(
  platform: MobileUpdatePlatform,
  track: MobileUpdateTrack,
): MobileUpdateManifest | null {
  requireR2Credentials()
  const key = mobileUpdateManifestObjectKey(platform, track)
  const body = readR2Object(key)
  // Nothing published for this platform and track yet is the expected first run.
  return body === null ? null : parseMobileUpdateManifest(JSON.parse(body), platform)
}

function putObject(localPath: string, key: string, cacheControl: string): void {
  execFileSync(
    'aws',
    [
      's3',
      'cp',
      localPath,
      `s3://${BUCKET}/${key}`,
      '--endpoint-url',
      r2Endpoint(),
      '--cache-control',
      cacheControl,
      '--no-progress',
    ],
    { stdio: 'inherit', env: awsEnv() },
  )
}

function stage(outDir: string, key: string, write: (path: string) => void): string {
  const path = join(outDir, key)
  mkdirSync(dirname(path), { recursive: true })
  write(path)
  return path
}

function md5File(path: string): string {
  return createHash('md5').update(readFileSync(path)).digest('hex')
}

function summarize(plan: PublishPlan, platform: MobileUpdatePlatform, track: MobileUpdateTrack): string[] {
  const lines = [
    `platform: ${platform} (${track})`,
    `build code: ${plan.previousBuildCode ?? '(none)'} → ${plan.buildCode}`,
    `min supported: ${plan.previousMinSupportedBuildCode ?? '(none)'} → ${plan.minSupportedBuildCode}`,
  ]
  if (plan.movesBackwards) {
    lines.push('ROLLBACK: latest.json will point at an older build than the one published now.')
  }
  if (plan.raisesFloor) {
    lines.push(
      `HARD GATE RAISED: every build below ${plan.minSupportedBuildCode} will be blocked on ` +
        'launch with no way to continue except updating.',
    )
  }
  return lines
}

async function main(): Promise<void> {
  if (process.argv[2] === '--check-stable-floor') {
    const stable = fetchStableDesktopVersion()
    assertStableDesktopServesPhone(stable)
    console.log(`ok: stable desktop ${stable} serves phones requiring ${MIN_PHONE_DESKTOP_VERSION}`)
    return
  }

  const repoRoot = resolve(import.meta.dirname, '..')
  const args = parseArgs(process.argv.slice(2), repoRoot)


  // Reading the live manifest needs credentials, so a pure staging run without
  // them starts from "nothing published" -- enough to eyeball the output.
  const current =
    args.upload || process.env.AWS_ACCESS_KEY_ID ? fetchPublishedManifest(args.platform, args.track) : null

  const plan = resolveMobileUpdatePlan({
    buildCode: args.buildCode,
    requestedMinSupportedBuildCode: args.minSupportedBuildCode,
    current,
    rollback: args.rollback,
  })

  rmSync(args.outDir, { recursive: true, force: true })
  mkdirSync(args.outDir, { recursive: true })

  let artifact: { url: string; md5: string; sizeBytes: number } | undefined
  let apkKey: string | null = null
  let stagedApk: string | null = null

  if (args.platform === 'android') {
    const apkPath = args.apkPath!
    if (!existsSync(apkPath)) throw new Error(`APK not found: ${apkPath}`)
    apkKey = androidApkObjectKey(args.version, args.buildCode, args.track)
    stagedApk = stage(args.outDir, apkKey, (path) => copyFileSync(apkPath, path))
    artifact = {
      url: androidApkUrl(args.version, args.buildCode, args.baseUrl, args.track),
      md5: md5File(stagedApk),
      sizeBytes: statSync(stagedApk).size,
    }
  }

  const manifest = buildManifest({
    platform: args.platform,
    version: args.version,
    plan,
    releasedAt: new Date().toISOString(),
    artifact,
    testflightUrl: args.testflightUrl ?? undefined,
  })

  // Round-trip through the shared parser so a manifest that the app would
  // reject can never reach the bucket.
  if (!parseMobileUpdateManifest(manifest, args.platform, args.baseUrl)) {
    throw new Error('refusing to publish a manifest the app would reject')
  }

  const manifestKey = mobileUpdateManifestObjectKey(args.platform, args.track)
  const stagedManifest = stage(args.outDir, manifestKey, (path) =>
    writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`),
  )

  for (const line of summarize(plan, args.platform, args.track)) console.log(line)
  if (artifact) console.log(`apk: ${artifact.sizeBytes} bytes, md5 ${artifact.md5}`)
  console.log(`staged → ${args.outDir}`)

  if (!args.upload) {
    console.log('\nDry stage only. Pass --upload to publish to R2.')
    return
  }

  requireR2Credentials()
  // Artifact first, pointer second: a reader that catches us mid-publish must
  // never see a manifest whose APK is not there yet.
  if (stagedApk && apkKey) putObject(stagedApk, apkKey, IMMUTABLE_CACHE_CONTROL)
  putObject(stagedManifest, manifestKey, POINTER_CACHE_CONTROL)
  console.log(`Published ${mobileUpdateManifestUrl(args.platform, args.baseUrl, args.track)}`)
  if (artifact) console.log(`Published ${artifact.url}`)
}

// Guarded so the pure helpers above stay importable from a test, matching
// publish-harness-artifacts.ts.
if (process.argv[1]?.endsWith('publish-mobile-update.ts')) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
