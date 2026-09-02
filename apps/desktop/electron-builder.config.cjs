'use strict'

/**
 * Build-variant entry point for electron-builder.
 *
 * SuperOne ships as two side-by-side apps built from one codebase: `stable`
 * and `alpha`. They must be installable together, so every identity the OS
 * keys on has to differ. Those identities are NOT one field — electron-builder
 * splits them across three independent chains:
 *
 *   - `appId`      → macOS bundle id, TCC, Windows registry keys / AUMID
 *   - `productName`→ .app name, Electron `app.name` (logs, safeStorage keychain)
 *   - package.json `name` → NSIS install dir and the electron-updater cache dir
 *     (`getWindowsInstallationDirName` and `updaterCacheDirName` both derive
 *     from `appInfo.sanitizedName`, never from appId/productName)
 *
 * All three come from `variants.json` so they can never drift apart.
 *
 * `extends` is deliberately not used: electron-builder unions arrays when
 * merging configs, so a variant could never drop a base `mac.target` /
 * `extraResources` entry. Loading the base yml here and overriding explicit
 * keys keeps "child wins" predictable.
 */

const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const yaml = require('js-yaml')
const semver = require('semver')

const VARIANTS = require('./variants.json')
const VARIANT_IDS = Object.keys(VARIANTS)

function resolveVariantId() {
  const id = process.env.SUPERONE_VARIANT
  if (!id) {
    throw new Error(
      `SUPERONE_VARIANT is required (one of: ${VARIANT_IDS.join(', ')}). ` +
        'There is no default on purpose — a silent default ships a build under the wrong identity.',
    )
  }
  if (!VARIANTS[id]) {
    throw new Error(`Unknown SUPERONE_VARIANT "${id}" (expected one of: ${VARIANT_IDS.join(', ')})`)
  }
  return id
}

/**
 * Effective packaging version.
 *
 * Cutting stable from a validated alpha commit must not require a bump commit,
 * or the stable binary is "the validated tree plus a commit nobody ran". The
 * override lives here rather than on the command line (`-c.extraMetadata.version`)
 * because electron-builder merges CLI `-c` overrides *after* this config
 * returns, which would let a caller bypass the variant assertion below.
 */
function resolveVersion(packageVersion) {
  const override = process.env.SUPERONE_VERSION?.trim()
  if (!override) return packageVersion
  if (!semver.valid(override)) {
    throw new Error(`SUPERONE_VERSION "${override}" is not a valid semver version`)
  }
  return override
}

/**
 * The desktop variant is explicit, but `@super-one/cli`, the harness manifest
 * channel and the GitHub prerelease flag all still derive from the version
 * string. Assert the two agree so those derivations stay consistent, and so a
 * stable-numbered build can never be packaged with the alpha identity.
 */
function assertVersionMatchesVariant(version, id) {
  const prerelease = semver.prerelease(version)
  const tag = prerelease && prerelease.length > 0 ? String(prerelease[0]) : null
  const expected = VARIANTS[id].prereleaseTag
  if (tag !== expected) {
    throw new Error(
      `Version "${version}" does not match variant "${id}": ` +
        `expected prerelease tag ${expected === null ? '<none>' : `"${expected}"`}, got ${tag === null ? '<none>' : `"${tag}"`}.`,
    )
  }
}

const variantId = resolveVariantId()
const variant = VARIANTS[variantId]

const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8'))
const version = resolveVersion(pkg.version)
assertVersionMatchesVariant(version, variantId)

const base = yaml.load(readFileSync(join(__dirname, 'electron-builder.yml'), 'utf8'))

module.exports = {
  ...base,
  appId: variant.appId,
  productName: variant.productName,
  icon: variant.icon,
  // Both variants are packaged from one `out/`; separate output dirs keep the
  // two runs' channel manifests (both named `latest-*.yml`) from overwriting
  // each other when they happen on the same machine.
  directories: { ...base.directories, output: `dist/${variantId}` },
  linux: {
    ...base.linux,
    // electron-builder would derive this from package.json `name`; pin it so
    // the .desktop entry, hicolor icon paths and the appimagekit resource name
    // differ per variant instead of colliding on one slot.
    executableName: variant.executableName,
  },
  publish: {
    provider: 'generic',
    url: `https://dl.super-one.dev/${variant.downloadPrefix}`,
    // Explicit channel suppresses electron-builder's prerelease-derived
    // channel, so every variant publishes `latest-*.yml` under its own prefix
    // and "update channel" stops existing as a wire-level concept.
    channel: 'latest',
  },
  extraMetadata: {
    ...base.extraMetadata,
    name: variant.packageName,
    productName: variant.productName,
    variant: variantId,
    // Merged into the packaged package.json before AppInfo is built, so this
    // drives artifact filenames, app.getVersion() and the update manifest.
    version,
  },
}
