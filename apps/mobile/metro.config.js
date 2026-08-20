const path = require('node:path')
const { getDefaultConfig } = require('expo/metro-config')

const projectRoot = __dirname
const monorepoRoot = path.resolve(projectRoot, '../..')

const config = getDefaultConfig(projectRoot)

config.watchFolders = [monorepoRoot]
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
]
config.resolver.unstable_enableSymlinks = true
config.resolver.unstable_enablePackageExports = true
config.resolver.disableHierarchicalLookup = true

// Node-only @superone/shared leaves. Importing these in RN is a bug.
const block = config.resolver.blockList
const extraBlock = [
  /packages[/\\]shared[/\\]src[/\\]attachment-store\.ts$/,
  /packages[/\\]shared[/\\]src[/\\]git-clone\.ts$/,
]
config.resolver.blockList = Array.isArray(block) ? [...block, ...extraBlock] : extraBlock

module.exports = config
