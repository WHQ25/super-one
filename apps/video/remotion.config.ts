import { Config } from '@remotion/cli/config'
import { enableTailwind } from '@remotion/tailwind-v4'

Config.setVideoImageFormat('jpeg')

Config.overrideWebpackConfig((currentConfiguration) => {
  return enableTailwind(currentConfiguration)
})
