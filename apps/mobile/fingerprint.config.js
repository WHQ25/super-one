'use strict'

const { SourceSkips } = require('expo/fingerprint')

/**
 * Keep the build code out of the runtime version.
 *
 * `runtimeVersion.policy` is `fingerprint`, so the hash computed here is what
 * decides which installed binaries an `eas update` may reach. Since the build
 * code moved into the project (`appVersionSource: "local"`, see
 * `build-code.js`), two sources started reacting to a routine version bump:
 * the resolved Expo config, which now carries `android.versionCode` and
 * `ios.buildNumber`, and `build-code.js` itself, hashed as a config
 * dependency.
 *
 * Left alone, every release would land in a runtime version of its own and no
 * over-the-air update could ever reach an existing install -- the whole reason
 * for using Expo. None of those values describes the native runtime, so
 * excluding them is not a loosening of the policy.
 *
 * Both `expo-updates` (which stamps the runtime version into the binary) and
 * EAS load this file, so the two agree by construction.
 */
module.exports = {
  // `sourceSkips` from a config file REPLACES the default rather than adding
  // to it, so the default has to be repeated here or it is silently lost.
  sourceSkips:
    SourceSkips.PackageJsonAndroidAndIosScriptsIfNotContainRun | SourceSkips.ExpoConfigVersions,

  // `ignorePaths` does merge with the defaults. Only the file holding the
  // number is excluded -- `app.config.js` stays hashed, so real config logic
  // is still covered. Keep `build-code.js` free of anything but the constant
  // and its fan-out.
  ignorePaths: ['build-code.js', '**/node_modules/react-native-quick-crypto/ios/**/*'],
}
