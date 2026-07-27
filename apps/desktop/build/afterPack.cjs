'use strict'

const { readdirSync, statSync, rmSync, existsSync, cpSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')
const { execFileSync } = require('node:child_process')

const ARCH_NAMES = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal' }
const PLATFORM_MAP = { darwin: 'darwin', mac: 'darwin', win32: 'win32', windows: 'win32', linux: 'linux' }

// Named ELECTRON_RUN_AS_NODE sidecars (MCP stdio bridge, LLM proxy). Must run
// before electron-builder's codesign pass so the clones get signed with the rest
// of the app.
//
// Clone the MAIN app executable — NOT a Helper.app clone. Electron's
// MainApplicationBundlePath only treats paths ending in " Helper" /
// " Helper (GPU|Plugin|Renderer)" as helpers; a custom-named Helper.app takes
// the main-app path walk, resolves ICU against the nested Frameworks clone, and
// aborts with SIGTRAP (exit 133) under ELECTRON_RUN_AS_NODE. A main-stub clone
// placed under Contents/Resources walks up to SuperOne.app correctly and still
// shows a distinct name in Activity Monitor.
//
// Placement is Contents/Resources/node-runtime-stubs/ (NOT Contents/MacOS
// siblings). osx-sign sorts by path depth and only then preserves walk order;
// MacOS/SuperOne is always listed before MacOS/"SuperOne MCP Bridge", and
// signing the CFBundleExecutable requires every other MacOS binary to already
// be signed — so sibling stubs fail codesign with
// "code object is not signed at all / In subcomponent: … MCP Bridge". A deeper
// Resources path is signed first, then SuperOne succeeds.
// Keep these suffixes in sync with resolve-cli.ts's VARIANT_MAIN_SUFFIX.
const NODE_RUNTIME_VARIANTS = [
  { suffix: 'MCP Bridge' },
  { suffix: 'LLM Proxy' },
]
const NODE_RUNTIME_STUBS_DIR = 'node-runtime-stubs'

function cloneNamedNodeRuntimes(appOutDir, productFilename) {
  const contentsDir = join(appOutDir, `${productFilename}.app`, 'Contents')
  const macosDir = join(contentsDir, 'MacOS')
  const mainExec = join(macosDir, productFilename)
  if (!existsSync(mainExec)) {
    console.warn(`[afterPack] main executable not found at ${mainExec}, skipping named node runtimes`)
    return
  }

  const stubsDir = join(contentsDir, 'Resources', NODE_RUNTIME_STUBS_DIR)
  mkdirSync(stubsDir, { recursive: true })

  for (const { suffix } of NODE_RUNTIME_VARIANTS) {
    const variantName = `${productFilename} ${suffix}`
    const dest = join(stubsDir, variantName)
    rmSync(dest, { force: true })
    cpSync(mainExec, dest)
    // Ad-hoc sign so SuperOne can still codesign if discovery order ever
    // interleaves; osx-sign later re-signs with the real Developer ID identity.
    try {
      execFileSync('codesign', ['--force', '--sign', '-', '--timestamp=none', '--options', 'runtime', dest], {
        stdio: 'pipe',
      })
    } catch (err) {
      console.warn(`[afterPack] ad-hoc codesign failed for ${variantName}:`, err.message)
    }
    console.log(`[afterPack] cloned named node runtime: Resources/${NODE_RUNTIME_STUBS_DIR}/${variantName}`)
  }

  // Drop legacy MacOS-sibling stubs and Helper.app clones from older builds that
  // may still be present when iterating packaging scripts against a non-clean
  // output dir.
  for (const { suffix } of NODE_RUNTIME_VARIANTS) {
    const legacySibling = join(macosDir, `${productFilename} ${suffix}`)
    if (existsSync(legacySibling)) {
      rmSync(legacySibling, { force: true })
      console.log(`[afterPack] removed legacy MacOS sibling stub: ${productFilename} ${suffix}`)
    }
    const legacyHelper = join(contentsDir, 'Frameworks', `${productFilename} ${suffix}.app`)
    if (existsSync(legacyHelper)) {
      rmSync(legacyHelper, { recursive: true, force: true })
      console.log(`[afterPack] removed legacy helper clone: ${productFilename} ${suffix}.app`)
    }
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
    cloneNamedNodeRuntimes(context.appOutDir, context.packager.appInfo.productFilename)
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
