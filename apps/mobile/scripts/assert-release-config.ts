#!/usr/bin/env bun
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = join(mobileRoot, '../..')

const app = JSON.parse(readFileSync(join(mobileRoot, 'app.json'), 'utf8')) as {
  expo?: {
    runtimeVersion?: { policy?: string }
    ios?: { bundleIdentifier?: string }
    android?: { package?: string }
    owner?: string
    updates?: { url?: string }
    extra?: { eas?: { projectId?: string } }
  }
}
const eas = JSON.parse(readFileSync(join(mobileRoot, 'eas.json'), 'utf8')) as {
  cli?: { appVersionSource?: string }
  build?: Record<string, {
    bun?: string
    distribution?: string
    channel?: string
    autoIncrement?: boolean
    android?: { buildType?: string }
  }>
  submit?: { production?: { ios?: { ascAppId?: string } } }
}
const rootPackage = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
  packageManager?: string
}
const mobilePackage = JSON.parse(readFileSync(join(mobileRoot, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>
  scripts?: Record<string, string>
}
const gitignore = readFileSync(join(mobileRoot, '.gitignore'), 'utf8').split(/\r?\n/)

const bunVersion = rootPackage.packageManager?.match(/^bun@(.+)$/)?.[1]
if (!bunVersion || eas.build?.base?.bun !== bunVersion) {
  throw new Error('EAS Bun version must match the root packageManager')
}

if (eas.cli?.appVersionSource !== 'remote') {
  throw new Error('EAS build numbers must use the remote version source')
}

const internal = eas.build?.internal
if (
  internal?.distribution !== 'internal'
  || internal.channel !== 'internal'
  || internal.autoIncrement !== true
  || internal.android?.buildType !== 'apk'
) {
  throw new Error('internal profile must produce an auto-incremented Android APK on the internal channel')
}

const production = eas.build?.production
if (production?.channel !== 'production' || production.autoIncrement !== true) {
  throw new Error('production profile must auto-increment on the production channel')
}

if (!/^\d+$/.test(eas.submit?.production?.ios?.ascAppId ?? '')) {
  throw new Error('production submit profile must identify the App Store Connect app')
}

if (app.expo?.runtimeVersion?.policy !== 'appVersion') {
  throw new Error('EAS Update runtime compatibility must follow the native app version')
}

const easProjectId = app.expo?.extra?.eas?.projectId
if (
  app.expo?.owner !== 'wuhangqi25'
  || !easProjectId
  || app.expo.updates?.url !== `https://u.expo.dev/${easProjectId}`
) {
  throw new Error('Expo owner, EAS project ID, and EAS Update URL must stay linked')
}

if (!mobilePackage.dependencies?.['expo-updates']) {
  throw new Error('expo-updates must be installed before EAS Update can be configured')
}

if (
  mobilePackage.scripts?.['eas-build-pre-install'] !== 'bun scripts/prepare-eas-install.ts'
  || mobilePackage.scripts?.['eas-build-post-install'] !== 'bun run build:chat-view'
) {
  throw new Error('EAS hooks must isolate installs and generate ignored Chat View host modules')
}

if (!app.expo.ios?.bundleIdentifier || !app.expo.android?.package) {
  throw new Error('both native application identifiers are required for release builds')
}

if (!gitignore.includes('credentials.json')) {
  throw new Error('local EAS credentials must never be committed')
}

console.log('ok: EAS release profiles and runtime compatibility policy are consistent')
