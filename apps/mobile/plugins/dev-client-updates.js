'use strict'

/**
 * Expo's plugin resolver `require()`s this file with Node, not bun, so it
 * cannot be TypeScript.
 *
 * Local debug/dev-client binaries must not boot expo-updates against the
 * `file:fingerprint` sentinel.
 *
 * Android's UpdatesConfiguration.getRuntimeVersion() opens assets/fingerprint
 * with no try/catch. iOS returns nil. The Gradle task that is supposed to
 * write that asset does not take app.json as an input, so switching the
 * runtimeVersion policy to fingerprint leaves an empty UP-TO-DATE output and
 * Application.onCreate dies with FileNotFoundException: fingerprint.
 *
 * Debug never loads an EAS Update (Metro serves JS), so disable the native
 * module there — getIsEnabled is checked before the file open. Release still
 * needs the asset, so the Gradle hook refuses to be up-to-date without it.
 */

const UPDATES_ENABLED_META_NAME = 'expo.modules.updates.ENABLED'

const UPDATES_DISABLED_META =
  `<meta-data android:name="${UPDATES_ENABLED_META_NAME}" android:value="false" tools:replace="android:value"/>`

const FINGERPRINT_GRADLE_MARKER =
  '// superone: recreate expo-updates fingerprint resources when the asset is missing'

const FINGERPRINT_GRADLE_SNIPPET = `
${FINGERPRINT_GRADLE_MARKER}
tasks.configureEach { task ->
  if (task.name ==~ /create.*UpdatesResources/) {
    task.inputs.file(new File(rootProject.projectDir.parentFile, "app.json"))
    task.outputs.upToDateWhen {
      def outputDir = task.outputs.files.files.find { it.directory }
      outputDir != null && new File(outputDir, "fingerprint").isFile()
    }
  }
}
`

const TOOLS_XMLNS = 'xmlns:tools="http://schemas.android.com/tools"'

function disableUpdatesInDebugManifest(xml) {
  if (
    xml.includes(`android:name="${UPDATES_ENABLED_META_NAME}"`)
    && /android:value="false"/.test(xml)
  ) {
    return xml
  }

  let next = xml
  if (!next.includes('xmlns:tools=')) {
    next = next.replace(/<manifest\b/, `<manifest ${TOOLS_XMLNS}`)
  }

  if (/<application\b[^>]*\/>/.test(next)) {
    return next.replace(
      /<application\b([^>]*)\/>/,
      `<application$1>\n        ${UPDATES_DISABLED_META}\n    </application>`,
    )
  }

  if (/<application\b[^>]*>/.test(next)) {
    return next.replace(
      /<application\b[^>]*>/,
      (open) => `${open}\n        ${UPDATES_DISABLED_META}`,
    )
  }

  return next.replace(
    '</manifest>',
    `    <application>\n        ${UPDATES_DISABLED_META}\n    </application>\n</manifest>`,
  )
}

function ensureFingerprintResourcesTaskInvalidWhenMissing(gradle) {
  if (gradle.includes(FINGERPRINT_GRADLE_MARKER)) return gradle
  return `${gradle.trimEnd()}\n${FINGERPRINT_GRADLE_SNIPPET}`
}

module.exports = {
  UPDATES_ENABLED_META_NAME,
  UPDATES_DISABLED_META,
  FINGERPRINT_GRADLE_MARKER,
  FINGERPRINT_GRADLE_SNIPPET,
  disableUpdatesInDebugManifest,
  ensureFingerprintResourcesTaskInvalidWhenMissing,
}
