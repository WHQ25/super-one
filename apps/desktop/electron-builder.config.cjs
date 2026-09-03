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
 * Effective packaging version = base version + the variant's prerelease tag.
 *
 * The base is the plain release number ("0.61.0"); the variant decides whether
 * it ships as that or as "0.61.0-alpha". Deriving rather than asserting is what
 * makes a mismatch impossible instead of merely caught: there is no input that
 * expresses "stable build carrying an -alpha version".
 *
 * Note the direction. Identity is never read off the version anywhere in this
 * app -- that coupling is exactly what the variant split removed. This is the
 * inverse and is sound: the variant is authoritative, and the version string is
 * one of its outputs.
 *
 * SUPERONE_VERSION overrides the BASE, so cutting stable from a validated alpha
 * commit needs no bump commit -- otherwise the stable binary would be "the
 * validated tree plus a commit nobody ran". It lives here rather than on the
 * command line (`-c.extraMetadata.version`) because electron-builder merges CLI
 * `-c` overrides *after* this config returns, which would let a caller bypass
 * the derivation.
 */
function resolveVersion(packageVersion, id) {
  const base = process.env.SUPERONE_VERSION?.trim() || packageVersion
  if (!semver.valid(base)) {
    throw new Error(`Base version "${base}" is not a valid semver version`)
  }
  if (semver.prerelease(base)) {
    throw new Error(
      `Base version "${base}" must be a plain release version — the variant adds ` +
        `its own prerelease tag. Pass "${semver.coerce(base)?.version ?? base}" instead.`,
    )
  }
  const tag = VARIANTS[id].prereleaseTag
  return tag ? `${base}-${tag}` : base
}

const variantId = resolveVariantId()
const variant = VARIANTS[variantId]

const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8'))
const version = resolveVersion(pkg.version, variantId)

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
