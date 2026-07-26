'use strict'

const { readdirSync, statSync, rmSync, existsSync, cpSync, renameSync } = require('node:fs')
const { join } = require('node:path')
const { execFileSync } = require('node:child_process')

const ARCH_NAMES = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal' }
const PLATFORM_MAP = { darwin: 'darwin', mac: 'darwin', win32: 'win32', windows: 'win32', linux: 'linux' }

// Gives the two node-runtime child processes we own (MCP stdio bridge, LLM proxy
// sidecar) a distinct name in Activity Monitor, by cloning the plain Helper.app
// bundle under a new name — the same trick Electron itself uses for its own
// Helper (Renderer)/(GPU)/(Plugin) variants. Must run before electron-builder's
// codesign pass (afterPack always precedes it) so the clones get properly signed
// like everything else — see apps/desktop/src/main/agent/resolve-cli.ts for the
// runtime lookup, and superone-mcp-stdio-state.ts / llm-proxy-manager.ts for the
// two consumers. Keep these names in sync with resolve-cli.ts's variant map.
const HELPER_VARIANTS = [
  { suffix: 'MCP Bridge', bundleIdSuffix: 'mcpbridge' },
  { suffix: 'LLM Proxy', bundleIdSuffix: 'llmproxy' },
]

function cloneHelperVariants(appOutDir, productFilename) {
  const frameworksDir = join(appOutDir, `${productFilename}.app`, 'Contents', 'Frameworks')
  const baseName = `${productFilename} Helper`
  const baseDir = join(frameworksDir, `${baseName}.app`)
  if (!existsSync(baseDir)) {
    console.warn(`[afterPack] base helper bundle not found at ${baseDir}, skipping variant clone`)
    return
  }
  for (const { suffix, bundleIdSuffix } of HELPER_VARIANTS) {
    const variantName = `${productFilename} ${suffix}`
    const variantDir = join(frameworksDir, `${variantName}.app`)
    rmSync(variantDir, { recursive: true, force: true })
    cpSync(baseDir, variantDir, { recursive: true })
    renameSync(join(variantDir, 'Contents', 'MacOS', baseName), join(variantDir, 'Contents', 'MacOS', variantName))

    const plistPath = join(variantDir, 'Contents', 'Info.plist')
    const setPlist = (key, value) => execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${value}`, plistPath])
    setPlist('CFBundleExecutable', variantName)
    setPlist('CFBundleDisplayName', variantName)
    setPlist('CFBundleName', `Electron Helper (${suffix})`)
    setPlist('CFBundleIdentifier', `com.superone.app.helper.${bundleIdSuffix}`)

    console.log(`[afterPack] cloned helper variant: ${variantName}`)
  }
}

const PRUNE_PARENTS = [
  'node_modules/@anthropic-ai',
  'node_modules/@openai',
]
const PRUNE_PREFIXES = [
  'claude-agent-sdk-',
  'codex-',
]

module.exports = async function afterPack(context) {
  const archName = ARCH_NAMES[context.arch]
  if (!archName || archName === 'universal') return

  const platformKey = (context.packager.platform.nodeName || context.packager.platform.name || '').toLowerCase()
  const osName = PLATFORM_MAP[platformKey]
  if (!osName) return

  const resourcesRoot = osName === 'darwin'
    ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources', 'app.asar.unpacked')
    : join(context.appOutDir, 'resources', 'app.asar.unpacked')

  if (osName === 'darwin') {
    cloneHelperVariants(context.appOutDir, context.packager.appInfo.productFilename)
  }

  const keepSuffix = `${osName}-${archName}`

  let totalFreed = 0
  let removedCount = 0

  for (const parent of PRUNE_PARENTS) {
    const parentDir = join(resourcesRoot, parent)
    let entries
    try { entries = readdirSync(parentDir) } catch { continue }

    for (const entry of entries) {
      const matchesPrefix = PRUNE_PREFIXES.some((p) => entry.startsWith(p))
      if (!matchesPrefix) continue
      if (!entry.includes('-')) continue
      if (entry.endsWith(`-${keepSuffix}`) || entry.endsWith(`-${keepSuffix}-musl`)) continue
      const looksLikeArchPkg = /-(darwin|win32|linux)-/.test(entry) || /-(darwin|win32|linux)-[a-z0-9_]+$/.test(entry)
      if (!looksLikeArchPkg) continue

      const full = join(parentDir, entry)
      try {
        const size = dirSize(full)
        rmSync(full, { recursive: true, force: true })
        totalFreed += size
        removedCount += 1
        console.log(`[afterPack] pruned ${entry} (${(size / 1024 / 1024).toFixed(1)} MB)`)
      } catch (err) {
        console.warn(`[afterPack] failed to prune ${entry}:`, err.message)
      }
    }
  }

  console.log(`[afterPack] removed ${removedCount} wrong-arch packages, freed ${(totalFreed / 1024 / 1024).toFixed(1)} MB for ${osName}-${archName}`)
}

function dirSize(dir) {
  let total = 0
  const stack = [dir]
  while (stack.length) {
    const cur = stack.pop()
    let st
    try { st = statSync(cur) } catch { continue }
    if (st.isDirectory()) {
      let kids
      try { kids = readdirSync(cur) } catch { continue }
      for (const k of kids) stack.push(join(cur, k))
    } else {
      total += st.size
    }
  }
  return total
}
