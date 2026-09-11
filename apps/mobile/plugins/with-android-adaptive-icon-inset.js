'use strict'

const { join } = require('node:path')
const { withFinalizedMod } = require('expo/config-plugins')
const { applyAdaptiveIconInsetToRes } = require('./android-adaptive-icon-inset')

/**
 * Expo's icon writer emits a full-bleed adaptive foreground. Run after that
 * writer (`finalized`) so the 16% safe-zone inset survives prebuild.
 */
function withAndroidAdaptiveIconInset(config) {
  return withFinalizedMod(config, [
    'android',
    (mod) => {
      applyAdaptiveIconInsetToRes(join(mod.modRequest.platformProjectRoot, 'app/src/main/res'))
      return mod
    },
  ])
}

module.exports = withAndroidAdaptiveIconInset
