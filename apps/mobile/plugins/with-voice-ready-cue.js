'use strict'
const { copyFile, mkdir } = require('node:fs/promises')
const { join } = require('node:path')
const { IOSConfig, withDangerousMod, withXcodeProject } = require('expo/config-plugins')

/** InCallManager plays this resource through the existing voice audio session. */
module.exports = function withVoiceReadyCue(config) {
  for (const platform of ['android', 'ios']) {
    config = withDangerousMod(config, [platform, async mod => {
      const directory = platform === 'android'
        ? join(mod.modRequest.platformProjectRoot, 'app/src/main/res/raw')
        : join(mod.modRequest.platformProjectRoot, mod.modRequest.projectName)
      await mkdir(directory, { recursive: true })
      await copyFile(join(mod.modRequest.projectRoot, 'assets/audio/incallmanager_ringback.mp3'), join(directory, 'incallmanager_ringback.mp3'))
      return mod
    }])
  }
  return withXcodeProject(config, mod => {
    IOSConfig.XcodeUtils.addResourceFileToGroup({ filepath: `${mod.modRequest.projectName}/incallmanager_ringback.mp3`,
      groupName: mod.modRequest.projectName, project: mod.modResults, isBuildFile: true })
    return mod
  })
}
