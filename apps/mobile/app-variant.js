'use strict'

/**
 * The one place that knows how the development variant differs.
 *
 * Two builds have to coexist on one phone: the locally built dev client, which
 * Metro serves and which is signed with the debug keystore, and the EAS
 * `internal` APK, which is signed with the project keystore and updates itself.
 * Android refuses to install one over the other -- same package name, different
 * signature -- so they need different application ids.
 *
 * CommonJS and not TypeScript because Expo's config loader `require()`s
 * `app.config.js` with Node, and there is no `ts-node` in this repo. Same
 * reason as `plugins/dev-client-updates.js`.
 *
 * `scripts/maestro.ts` reads this too. Re-deriving the suffix there would be a
 * second copy of the rule, and the symptom of drift is a UI suite that silently
 * drives the wrong app.
 */

/** Appended to the release identifiers. Also the launcher-visible difference. */
const DEV_SUFFIX = '.dev'

/**
 * The dev variant answers a scheme of its own.
 *
 * With both apps claiming `superone://`, every preview deep link would raise
 * an Android disambiguation chooser. Pairing does not care -- that path is the
 * in-app camera and the paste field -- but `superone://native-preview` is
 * automation, and automation cannot answer a chooser.
 */
const DEV_SCHEME = 'superone-dev'

function isDevVariant(env = process.env) {
  return env.APP_VARIANT === 'development'
}

function devApplicationId(releaseId) {
  return `${releaseId}${DEV_SUFFIX}`
}

/**
 * Apply the development identity to a resolved Expo config, or return it
 * untouched. Everything else -- updates URL, permissions, plugins, runtime
 * version policy -- is deliberately shared, so the dev client exercises the
 * same native surface the release build ships.
 */
function applyAppVariant(config, env = process.env) {
  if (!isDevVariant(env)) return config
  return {
    ...config,
    name: `${config.name} Dev`,
    scheme: DEV_SCHEME,
    ios: { ...config.ios, bundleIdentifier: devApplicationId(config.ios.bundleIdentifier) },
    android: { ...config.android, package: devApplicationId(config.android.package) },
  }
}

module.exports = { DEV_SCHEME, DEV_SUFFIX, applyAppVariant, devApplicationId, isDevVariant }
