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
 *
 * Dependency-free on purpose. release.yml's plan job is a checkout and a
 * `node -e` with no install step -- it is the gate that runs before the
 * builds, so it stays fast. `require('semver')` there fails with
 * MODULE_NOT_FOUND, and the shapes involved are narrow enough to match
 * directly.
 */

const VARIANTS = require('./variants.json')

/** Plain `X.Y.Z` -- no prerelease, no build metadata. */
const PLAIN_VERSION = /^(\d+)\.(\d+)\.(\d+)$/
/** `X.Y.Z-<tag>` or `X.Y.Z-<tag>.<n>` -- every version this repo ships. */
const TAGGED_VERSION = /^(\d+)\.(\d+)\.(\d+)-([0-9A-Za-z-]+)(?:\.(\d+))?$/

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
  if (!PLAIN_VERSION.test(base)) {
    const tagged = TAGGED_VERSION.exec(base)
    if (!tagged) {
      throw new Error(`Base version "${base}" is not a valid semver version`)
    }
    throw new Error(
      `Base version "${base}" must be a plain release version — the variant adds ` +
        `its own prerelease tag. Pass "${base.slice(0, base.indexOf('-'))}" instead.`,
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
 * An alpha `build`: bump the latest shipped alpha's sequence, keeping
 * the X.Y.Z base. `0.63.0-alpha` → `.1`; `0.63.0-alpha.1` → `.2`.
 */
function nextAlphaBuild(packagedVersion) {
  const clean = String(packagedVersion).replace(/^v/i, '')
  const m = TAGGED_VERSION.exec(clean)
  if (!m) {
    if (PLAIN_VERSION.test(clean)) {
      throw new Error(`nextAlphaBuild expects an -alpha version, got "${packagedVersion}"`)
    }
    throw new Error(`"${packagedVersion}" is not a valid semver version`)
  }
  const [, major, minor, patch, tag, seq] = m
  if (tag !== 'alpha') {
    throw new Error(`nextAlphaBuild expects an -alpha version, got "${packagedVersion}"`)
  }
  const n = seq === undefined ? 1 : Number(seq) + 1
  const base = `${major}.${minor}.${patch}`
  return { base, prereleaseN: n, version: `${base}-alpha.${n}` }
}

/**
 * `/release alpha`: the next alpha, decided by where stable stands rather than
 * by commit types. While the latest stable is below the alpha's base, alpha
 * keeps iterating on that base (`build`), leaving X.Y.1 free to hotfix a
 * stable X.Y.0. Once stable has shipped the base, or a hotfix has moved past
 * it, alpha opens the next minor above both. `major` (a breaking change after
 * 1.0, or an explicit ask) opens the next major instead, whatever stable did.
 */
function nextAlphaRelease(latestAlpha, latestStable, options = {}) {
  const current = nextAlphaBuild(latestAlpha)
  const alphaBase = current.base.split('.').map(Number)
  let stable = null
  if (latestStable != null) {
    const m = PLAIN_VERSION.exec(String(latestStable).replace(/^v/i, ''))
    if (!m) throw new Error(`Latest stable "${latestStable}" must be a plain release version`)
    stable = m.slice(1).map(Number)
  }
  const compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
  const caughtUp = stable != null && compare(stable, alphaBase) >= 0
  if (!caughtUp && !options.major) return { bump: 'build', ...current }
  const [major, minor] = stable != null && compare(stable, alphaBase) > 0 ? stable : alphaBase
  const base = options.major ? `${major + 1}.0.0` : `${major}.${minor + 1}.0`
  return { bump: options.major ? 'major' : 'feature', base, prereleaseN: null, version: `${base}-alpha` }
}

module.exports = { parsePrereleaseN, resolvePackagedVersion, nextAlphaBuild, nextAlphaRelease }
