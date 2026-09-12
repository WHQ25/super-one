'use strict'

/**
 * The one build code, shared by both platforms.
 *
 * EAS stores its remote version counter per `(project, platform,
 * applicationId)`, so `appVersionSource: "remote"` cannot hold the two
 * platforms together -- and it did not: Android reached 5 while iOS reached 21,
 * because Android is built far more often. The manifest published to R2 carries
 * a single `buildCode` field that the app compares against
 * `Application.nativeBuildVersion`, so the number has to mean the same thing on
 * both platforms or the hard gate reads differently depending on the phone.
 *
 * Bump this by hand in the release commit. `autoIncrement` is deliberately off:
 * with a local version source EAS bumps the number by rewriting `app.json` on
 * the builder, where the edit is discarded when the job ends. A forgotten bump
 * is caught rather than silent -- `resolveMobileUpdatePlan` refuses a build code
 * that does not advance the published one, and App Store Connect rejects a
 * duplicate `CFBundleVersion`.
 *
 * CommonJS for the same reason as `app-variant.js`: Expo's config loader
 * `require()`s `app.config.js` with plain Node.
 */

/**
 * Started at 22 rather than 6: iOS had already uploaded build 21 under version
 * 1.0.0, and App Store Connect will not accept a `CFBundleVersion` it has seen.
 * Android only requires that the code increase, so it absorbs the jump.
 */
const BUILD_CODE = 24

/**
 * Write the shared build code into both platform blocks.
 *
 * `android.versionCode` is an integer and `ios.buildNumber` is a string; that
 * asymmetry is Expo's, and hiding it here is the whole point of the function.
 */
function applyBuildCode(config, buildCode = BUILD_CODE) {
  if (!Number.isSafeInteger(buildCode) || buildCode <= 0) {
    throw new Error(`build code must be a positive integer (got ${buildCode})`)
  }
  return {
    ...config,
    ios: { ...config.ios, buildNumber: String(buildCode) },
    android: { ...config.android, versionCode: buildCode },
  }
}

module.exports = { BUILD_CODE, applyBuildCode }
