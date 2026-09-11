'use strict'

/**
 * Packaged version = base + the variant's prerelease tag + optional sequence.
 *
 * package.json holds the plain release number ("0.63.0"). The variant decides
 * whether that ships as "0.63.0" or "0.63.0-alpha". A `build` bump then adds a
 * sequence so the next alpha on the same base is "0.63.0-alpha.1" without
 * spending 0.63.1 (kept for a stable hotfix of 0.63.0).
 *
 * Deriving rather than asserting is what makes "stable build carrying an
 * -alpha version" inexpressible. Identity is never read off the version.
 *
 * Shared by electron-builder.config.cjs and release.yml's plan job so the
 * tag, the installer and the npm package cannot disagree.
 */

const semver = require('semver')
const VARIANTS = require('./variants.json')

function parsePrereleaseN(raw) {
  if (raw == null) return null
  const s = String(raw).trim()
  if (s === '' || s === '0') return null
  if (!/^[1-9]\d*$/.test(s)) {
    throw new Error(
      `SUPERONE_PRERELEASE_N must be a positive integer (or blank/0 for no suffix), got ${JSON.stringify(raw)}`,
    )
  }
  return Number(s)
}

function resolvePackagedVersion(packageVersion, variantId, options = {}) {
  if (!VARIANTS[variantId]) {
    throw new Error(`Unknown variant "${variantId}"`)
  }
  const override =
    typeof options.versionOverride === 'string' ? options.versionOverride.trim() : ''
  const base = override || packageVersion
  if (!semver.valid(base)) {
    throw new Error(`Base version "${base}" is not a valid semver version`)
  }
  if (semver.prerelease(base)) {
    throw new Error(
      `Base version "${base}" must be a plain release version — the variant adds ` +
        `its own prerelease tag. Pass "${semver.coerce(base)?.version ?? base}" instead.`,
    )
  }
  const tag = VARIANTS[variantId].prereleaseTag
  const n = parsePrereleaseN(options.prereleaseN)
  if (!tag) {
    if (n != null) {
      throw new Error(
        `SUPERONE_PRERELEASE_N is only valid for prerelease variants, not "${variantId}"`,
      )
    }
    return base
  }
  return n == null ? `${base}-${tag}` : `${base}-${tag}.${n}`
}

/**
 * `/release alpha build`: bump the latest shipped alpha's sequence, keeping
 * the X.Y.Z base. `0.63.0-alpha` → `.1`; `0.63.0-alpha.1` → `.2`.
 */
function nextAlphaBuild(packagedVersion) {
  const parsed = semver.parse(String(packagedVersion).replace(/^v/i, ''))
  if (!parsed) {
    throw new Error(`"${packagedVersion}" is not a valid semver version`)
  }
  if (parsed.prerelease[0] !== 'alpha') {
    throw new Error(`nextAlphaBuild expects an -alpha version, got "${packagedVersion}"`)
  }
  const seq = parsed.prerelease[1]
  if (parsed.prerelease.length > 2 || (seq !== undefined && typeof seq !== 'number')) {
    throw new Error(`unsupported alpha prerelease "${packagedVersion}"`)
  }
  const n = typeof seq === 'number' ? seq + 1 : 1
  const base = `${parsed.major}.${parsed.minor}.${parsed.patch}`
  return { base, prereleaseN: n, version: `${base}-alpha.${n}` }
}

module.exports = { parsePrereleaseN, resolvePackagedVersion, nextAlphaBuild }
