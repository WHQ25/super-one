'use strict'

/**
 * The one place that knows how the non-release variants differ.
 *
 * Several builds have to coexist on one phone, and Android refuses to install
 * one over another unless they share an application id and a signature:
 *
 *   - `development`: the locally built dev client, which Metro serves and which
 *     is signed with the debug keystore.
 *   - `alpha`: the build that tracks the alpha desktop (a self-updating APK on
 *     Android, a TestFlight-only app on iOS). It ships protocol changes before
 *     any stable desktop can serve them, so it must never reach a stable
 *     install -- a separate id is what keeps the two update pointers, the two
 *     OTA channels and the two pairings apart, and lets one phone hold both.
 *
 * Everything else -- the stable APK, the stable TestFlight app and the store
 * builds -- runs the release identity from `app.json` unchanged.
 *
 * CommonJS and not TypeScript because Expo's config loader `require()`s
 * `app.config.js` with Node, and there is no `ts-node` in this repo. Same
 * reason as `plugins/dev-client-updates.js`.
 *
 * `scripts/maestro.ts` reads this too. Re-deriving the suffix there would be a
 * second copy of the rule, and the symptom of drift is a UI suite that silently
 * drives the wrong app.
 */

/**
 * Each variant answers a scheme of its own.
 *
 * With two installed apps claiming `superone://`, every deep link raises an
 * Android disambiguation chooser. Pairing does not care -- that path is the
 * in-app camera and the paste field -- but `superone://native-preview` is
 * automation, and automation cannot answer a chooser.
 */
const VARIANTS = {
  development: { suffix: '.dev', scheme: 'superone-dev', label: 'Dev' },
  // The desktop alpha's badged icon, so the two installs differ at a glance.
  // A 1024 LANCZOS downscale of docs/logo/app-icon-alpha.png, the same way
  // assets/icon.png comes from docs/logo/app-icon.png.
  alpha: { suffix: '.alpha', scheme: 'superone-alpha', label: 'Alpha', icon: './assets/icon-alpha.png' },
}

const DEV_SUFFIX = VARIANTS.development.suffix
const DEV_SCHEME = VARIANTS.development.scheme

function isDevVariant(env = process.env) {
  return env.APP_VARIANT === 'development'
}

function devApplicationId(releaseId) {
  return `${releaseId}${DEV_SUFFIX}`
}

/**
 * Apply the variant identity to a resolved Expo config, or return it
 * untouched. Everything else -- updates URL, permissions, plugins, runtime
 * version policy -- is deliberately shared, so every variant exercises the
 * same native surface the release build ships.
 */
function applyAppVariant(config, env = process.env) {
  const variant = Object.hasOwn(VARIANTS, env.APP_VARIANT ?? '') ? VARIANTS[env.APP_VARIANT] : null
  if (!variant) return config
  return {
    ...config,
    name: `${config.name} ${variant.label}`,
    scheme: variant.scheme,
    ...(variant.icon && { icon: variant.icon }),
    ios: { ...config.ios, bundleIdentifier: `${config.ios.bundleIdentifier}${variant.suffix}` },
    android: {
      ...config.android,
      package: `${config.android.package}${variant.suffix}`,
      ...(variant.icon && {
        adaptiveIcon: { ...config.android.adaptiveIcon, foregroundImage: variant.icon },
      }),
    },
  }
}

module.exports = { DEV_SCHEME, DEV_SUFFIX, applyAppVariant, devApplicationId, isDevVariant }
