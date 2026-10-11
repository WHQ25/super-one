'use strict'
const { withAppBuildGradle, withInfoPlist } = require('expo/config-plugins')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
module.exports = function withVoiceAudio(config) {
  config = withInfoPlist(config, mod => {
    mod.modResults.UIBackgroundModes = [...new Set([...(mod.modResults.UIBackgroundModes || []), 'audio'])]
    return mod
  })
  return withAppBuildGradle(config, mod => {
    // Compile in the app script's AGP classloader, rather than an applied script
    // with a separate classpath. No duplicate Android plugin version is pinned.
    const marker = '// SuperOne voice audio instrumentation'
    let source = mod.modResults.contents.replace('\napply from: "../../plugins/voice-audio-instrumentation.gradle"\n', '\n')
    if (source.includes(marker)) source = source.slice(0, source.indexOf(marker))
    mod.modResults.contents = `${source}\n${marker}\n${readFileSync(join(__dirname, 'voice-audio-instrumentation.gradle'), 'utf8')}\n`
    return mod
  })
}
