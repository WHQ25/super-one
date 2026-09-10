#!/usr/bin/env bun
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
// Explicit extension: without it bun resolves the sibling `.d.ts` first and
// erases the import as type-only, leaving the binding undefined at runtime.
import { applyAppVariant } from '../app-variant.js'

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = join(mobileRoot, '../..')

const app = JSON.parse(readFileSync(join(mobileRoot, 'app.json'), 'utf8')) as {
  expo?: {
    scheme?: string
    runtimeVersion?: { policy?: string }
    ios?: { bundleIdentifier?: string }
    android?: { package?: string; permissions?: string[]; blockedPermissions?: string[] }
    owner?: string
    updates?: { url?: string }
    extra?: { eas?: { projectId?: string } }
    plugins?: Array<string | [string, unknown]>
  }
}
const eas = JSON.parse(readFileSync(join(mobileRoot, 'eas.json'), 'utf8')) as {
  cli?: { appVersionSource?: string }
  build?: Record<string, {
    bun?: string
    distribution?: string
    channel?: string
    autoIncrement?: boolean
    env?: Record<string, string>
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

// `appVersion` would pin every build to the hand-written `version` field, which
// `autoIncrement` never touches -- so a build with new native modules would keep
// serving updates to binaries that cannot run them. `fingerprint` derives the
// runtime version from everything that shapes the native runtime instead.
if (app.expo?.runtimeVersion?.policy !== 'fingerprint') {
  throw new Error('EAS Update runtime compatibility must follow the native fingerprint')
}

const pluginNames = (app.expo?.plugins ?? []).map((plugin) => (
  typeof plugin === 'string' ? plugin : plugin[0]
))
if (
  !pluginNames.includes('./plugins/with-dev-client-updates.js')
  || !existsSync(join(mobileRoot, 'plugins/with-dev-client-updates.js'))
) {
  throw new Error('debug builds must disable expo-updates so a missing fingerprint asset cannot crash launch')
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

// The self-hosted APK updater needs all three of these, and every one of them
// fails silently: without the packages the ports module will not build, and
// without the permission the install intent lands on a system dialog the user
// cannot clear from inside the app.
//
// Note that `android.permissions` is additive across every Android profile,
// so REQUEST_INSTALL_PACKAGES also rides along in the `production` AAB. That is
// acceptable only while `production` is TestFlight-only -- Google Play requires
// a policy declaration for it and rejects most apps that ask. Revisit here
// before the first Play submission.
for (const dep of ['expo-intent-launcher', 'expo-application']) {
  if (!mobilePackage.dependencies?.[dep]) {
    throw new Error(`${dep} must be installed for the self-hosted binary updater`)
  }
}

if (!app.expo.android?.permissions?.includes('android.permission.REQUEST_INSTALL_PACKAGES')) {
  throw new Error('Android must request REQUEST_INSTALL_PACKAGES to install its own updates')
}

if (app.expo.android?.blockedPermissions?.includes('android.permission.REQUEST_INSTALL_PACKAGES')) {
  throw new Error('REQUEST_INSTALL_PACKAGES is both requested and blocked')
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

// The dev client and the EAS `internal` APK live on the same phone, and Android
// refuses to install one over the other because their signing keys differ. The
// only thing keeping them apart is a distinct application id, so assert that
// the split is still wired -- if it silently collapses, the symptom is an
// INSTALL_FAILED_UPDATE_INCOMPATIBLE that reads like a broken build.
if (!existsSync(join(mobileRoot, 'app.config.js'))) {
  throw new Error('app.config.js must apply the development variant on top of app.json')
}

if (eas.build?.development?.env?.APP_VARIANT !== 'development') {
  throw new Error('the development profile must build the development variant')
}

const release = app.expo ?? {}
const dev = applyAppVariant(release, { APP_VARIANT: 'development' })
if (
  dev.android?.package === release.android?.package
  || dev.ios?.bundleIdentifier === release.ios?.bundleIdentifier
) {
  throw new Error('the development variant must not share the release application id')
}
// Two builds answering one scheme raise an Android chooser on every preview
// deep link, which the Maestro suite cannot answer.
if (dev.scheme === release.scheme) {
  throw new Error('the development variant must not share the release URL scheme')
}

console.log('ok: EAS release profiles and runtime compatibility policy are consistent')
