#!/usr/bin/env bun
/**
 * Hand a locally built Android APK to release-mobile.yml.
 *
 * `eas build --local` writes the APK on this machine. EAS does not keep a URL
 * for it, and a draft asset URL 404s for anyone who is not this repo, so the
 * file goes up as a draft Release under `staging/android-apk/<id>` — never
 * `v*` (desktop) and never `mobile/*` (a published phone build). Creating the
 * Release as a draft does not create the git tag. The workflow downloads it
 * with `apk_url`, publishes through the same R2 path as an EAS build, and
 * deletes the draft afterwards. The APK is not committed and not attached to
 * the desktop Release.
 *
 *   bun scripts/stage-local-android-apk.ts --apk ./build.apk --profile alpha
 *   bun scripts/stage-local-android-apk.ts --fetch --apk-url gh-release:staging/android-apk/<id>/superone.apk --out superone.apk
 *   bun scripts/stage-local-android-apk.ts --delete --apk-url gh-release:staging/android-apk/<id>/superone.apk
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertApkMatchesCheckout, type AndroidApkProfile } from './android-apk-identity'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export const STAGING_TAG_PREFIX = 'staging/android-apk/'
export const STAGING_ASSET_NAME = 'superone.apk'

const MOBILE_TREE = [
  'apps/mobile',
  'packages/chat-view',
  'packages/chat-core',
  'packages/relay-client',
  'packages/shared',
]

export type LocalApkUrl =
  | { kind: 'https'; url: string }
  | { kind: 'github-release'; tag: string; asset: string }

/**
 * `gh-release:` tags have slashes, so the asset is the last segment and the
 * tag is only accepted inside the staging prefix. Anything else — a desktop
 * `v*` release, a `mobile/*` release — is refused before `gh` runs, which is
 * what makes the matching delete unable to remove a real release.
 */
export function parseLocalApkUrl(value: string): LocalApkUrl {
  const url = value.trim()
  if (url.startsWith('gh-release:')) {
    const spec = url.slice('gh-release:'.length)
    const slash = spec.lastIndexOf('/')
    const tag = slash >= 0 ? spec.slice(0, slash) : ''
    const asset = slash >= 0 ? spec.slice(slash + 1) : ''
    if (
      !tag.startsWith(STAGING_TAG_PREFIX) ||
      !/^staging\/android-apk\/[0-9]{8}T[0-9]{6}Z$/.test(tag) ||
      asset !== STAGING_ASSET_NAME
    ) {
      throw new Error(
        `apk_url must be gh-release:${STAGING_TAG_PREFIX}<YYYYMMDDTHHMMSSZ>/${STAGING_ASSET_NAME}`,
      )
    }
    return { kind: 'github-release', tag, asset }
  }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`apk_url must be https://… or gh-release:${STAGING_TAG_PREFIX}…/${STAGING_ASSET_NAME}`)
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('apk_url http URLs are refused; use https, or stage the file with this script')
  }
  return { kind: 'https', url }
}

function fail(message: string): never {
  console.error(message)
  if (process.env.GITHUB_ACTIONS) console.error(`::error::${message.split('\n')[0]}`)
  process.exit(1)
}

function gh(args: string[]): void {
  execFileSync('gh', args, { stdio: 'inherit', cwd: repoRoot })
}

function repoName(): string {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY
  return execFileSync('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim()
}

function assertCleanMobileTree(): void {
  const status = execFileSync(
    'git',
    ['status', '--porcelain', '--untracked-files=all', '--', ...MOBILE_TREE],
    { cwd: repoRoot, encoding: 'utf8' },
  )
  if (status.trim()) {
    throw new Error(
      'Refusing to stage a local APK from a dirty mobile tree. The workflow checks the APK against the commit you dispatch, so these paths have to match HEAD:\n' +
        status,
    )
  }
}

export function stagingTag(now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  return `${STAGING_TAG_PREFIX}${stamp}`
}

function stage(apkPath: string, profile: AndroidApkProfile, target: string | null): void {
  const absolute = resolve(apkPath)
  const info = statSync(absolute, { throwIfNoEntry: false })
  if (!info?.isFile()) throw new Error(`APK not found: ${apkPath}`)
  assertCleanMobileTree()
  const identity = assertApkMatchesCheckout(absolute, profile)
  const sha = target ?? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim()
  const tag = stagingTag()
  const repo = repoName()
  // Draft, so GitHub does not create the tag. make_latest=false keeps the
  // desktop Latest badge where it is even if a client publishes this by mistake.
  gh([
    'api', '--method', 'POST', `repos/${repo}/releases`,
    '-f', `tag_name=${tag}`,
    '-f', `target_commitish=${sha}`,
    '-f', `name=Android APK staging ${identity.versionName} (${identity.versionCode})`,
    '-f', 'body=Temporary file for release-mobile.yml apk_url. Not a desktop or mobile release. Deleted after publish.',
    '-F', 'draft=true',
    '-F', 'prerelease=true',
    '-f', 'make_latest=false',
  ])
  const scratch = mkdtempSync(join(tmpdir(), 'stage-android-apk-'))
  try {
    const staged = join(scratch, STAGING_ASSET_NAME)
    copyFileSync(absolute, staged)
    try {
      gh(['release', 'upload', tag, staged, '--repo', repo])
    } catch (error) {
      spawnSync('gh', ['release', 'delete', tag, '--yes', '--repo', repo], { cwd: repoRoot, stdio: 'inherit' })
      throw error
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
  const apkUrl = `gh-release:${tag}/${STAGING_ASSET_NAME}`
  console.log(`apk_url=${apkUrl}`)
  console.log(`ref=${sha}`)
  console.log(`android_profile=${profile}`)
  console.log(`package=${identity.packageName}`)
  console.log(`version=${identity.versionName}`)
  console.log(`build_code=${identity.versionCode}`)
}

function fetchApk(apkUrl: string, out: string): void {
  const parsed = parseLocalApkUrl(apkUrl)
  mkdirSync(dirname(resolve(out)), { recursive: true })
  if (parsed.kind === 'https') {
    execFileSync('curl', ['-fSL', '--retry', '3', '--retry-delay', '5', '-o', out, parsed.url], {
      stdio: 'inherit',
    })
    return
  }
  // Draft asset URLs 404 without a token. `gh release download` uses GH_TOKEN
  // on the runner and the user's gh login locally.
  gh([
    'release', 'download', parsed.tag,
    '--pattern', parsed.asset,
    '--output', resolve(out),
    '--clobber',
  ])
}

function deleteStaging(apkUrl: string): void {
  const parsed = parseLocalApkUrl(apkUrl)
  if (parsed.kind === 'https') {
    console.log('https apk_url has no staging draft to delete')
    return
  }
  const repo = repoName()
  const view = spawnSync('gh', ['release', 'view', parsed.tag, '--repo', repo], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  if (view.status === 0) gh(['release', 'delete', parsed.tag, '--yes', '--repo', repo])
  else console.log(`staging release ${parsed.tag} is already gone`)
  // A draft does not create the tag. Delete one anyway if some client did.
  const probe = spawnSync('gh', ['api', `repos/${repo}/git/ref/tags/${parsed.tag}`], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  if (probe.status === 0) {
    gh(['api', '--method', 'DELETE', `repos/${repo}/git/refs/tags/${parsed.tag}`])
  }
  console.log(`deleted staging draft ${parsed.tag}`)
}

function take(argv: string[], i: number, flag: string): string {
  const value = argv[i + 1]
  if (!value || value.startsWith('--')) throw new Error(`${flag} needs a value`)
  return value
}

function main(): void {
  const argv = process.argv.slice(2)
  let fetchMode = false
  let deleteMode = false
  let apk: string | null = null
  let profile: string | null = null
  let apkUrl: string | null = null
  let out: string | null = null
  let target: string | null = null
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--fetch') fetchMode = true
    else if (arg === '--delete') deleteMode = true
    else if (arg === '--apk') {
      apk = take(argv, i, arg)
      i++
    } else if (arg === '--profile') {
      profile = take(argv, i, arg)
      i++
    } else if (arg === '--apk-url') {
      apkUrl = take(argv, i, arg)
      i++
    } else if (arg === '--out') {
      out = take(argv, i, arg)
      i++
    } else if (arg === '--target') {
      target = take(argv, i, arg)
      i++
    } else if (arg === '--help' || arg === '-h') {
      console.log('usage: bun scripts/stage-local-android-apk.ts --apk <file.apk> --profile <alpha|internal>')
      console.log('       bun scripts/stage-local-android-apk.ts --fetch --apk-url <url> --out <file.apk>')
      console.log('       bun scripts/stage-local-android-apk.ts --delete --apk-url <url>')
      return
    } else {
      throw new Error(`unknown argument ${arg}`)
    }
  }
  if (fetchMode && deleteMode) throw new Error('--fetch and --delete are mutually exclusive')
  if (fetchMode) {
    if (!apkUrl || !out) throw new Error('--fetch needs --apk-url and --out')
    fetchApk(apkUrl, out)
    return
  }
  if (deleteMode) {
    if (!apkUrl) throw new Error('--delete needs --apk-url')
    deleteStaging(apkUrl)
    return
  }
  if (!apk || !profile) throw new Error('--apk and --profile are required')
  stage(apk, profile as AndroidApkProfile, target)
}

if (import.meta.main) {
  try {
    main()
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error))
  }
}
