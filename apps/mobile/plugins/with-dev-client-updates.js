'use strict'

const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { dirname, join } = require('node:path')
const { withAppBuildGradle, withDangerousMod } = require('expo/config-plugins')
const {
  disableUpdatesInDebugManifest,
  ensureFingerprintResourcesTaskInvalidWhenMissing,
} = require('./dev-client-updates')

const EMPTY_DEBUG_MANIFEST = `<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:tools="http://schemas.android.com/tools">
    <application />
</manifest>
`

function withDevClientUpdates(config) {
  config = withDangerousMod(config, [
    'android',
    (mod) => {
      const manifestPath = join(
        mod.modRequest.platformProjectRoot,
        'app/src/debug/AndroidManifest.xml',
      )
      mkdirSync(dirname(manifestPath), { recursive: true })
      const current = existsSync(manifestPath)
        ? readFileSync(manifestPath, 'utf8')
        : EMPTY_DEBUG_MANIFEST
      writeFileSync(manifestPath, disableUpdatesInDebugManifest(current))
      return mod
    },
  ])

  config = withAppBuildGradle(config, (mod) => {
    if (mod.modResults.language !== 'groovy') {
      throw new Error('with-dev-client-updates expects Groovy app/build.gradle')
    }
    mod.modResults.contents = ensureFingerprintResourcesTaskInvalidWhenMissing(
      mod.modResults.contents,
    )
    return mod
  })

  return config
}

module.exports = withDevClientUpdates
